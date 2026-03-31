/**
 * useCronEngine — OpenClaw-inspired Cron Scheduler for NovaClaw
 *
 * Manages a list of CronJob entries stored in IndexedDB.
 * On each tick (every 60s), checks all enabled jobs against the current time.
 * When a job fires, it silently sends the job's `prompt` to the LLM
 * and pushes the response to the chat as an assistant message.
 *
 * Supports three schedule kinds (mirroring OpenClaw):
 *   - 'every': fires every N minutes/hours
 *   - 'at': one-shot at a specific datetime
 *   - 'cron': standard cron expression (simplified matcher)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { CronJob, APIConfig } from '../types';
import { DB } from '../utils/db';
import { resolveApiEndpoint } from '../utils/apiResolver';

// --- Simple Cron Expression Matcher ---
// Supports: minute hour dayOfMonth month dayOfWeek  (5-field, * and numbers only)
function matchesCronExpr(expr: string, date: Date): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return false;
    const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;
    const fields = [
        { expr: minExpr, value: date.getMinutes() },
        { expr: hourExpr, value: date.getHours() },
        { expr: domExpr, value: date.getDate() },
        { expr: monExpr, value: date.getMonth() + 1 },
        { expr: dowExpr, value: date.getDay() },
    ];
    return fields.every(({ expr: e, value: v }) => {
        if (e === '*') return true;
        // Support comma-separated values: "0,30"
        return e.split(',').some(part => parseInt(part, 10) === v);
    });
}

// --- Check if a job should fire right now ---
function shouldFire(job: CronJob, now: Date): boolean {
    if (!job.enabled) return false;

    switch (job.scheduleKind) {
        case 'every': {
            if (!job.everyAmount) return false;
            const intervalMs = job.everyAmount * (job.everyUnit === 'hours' ? 3600000 : 60000);
            const lastRun = job.lastRunAt || job.createdAt;
            return (now.getTime() - lastRun) >= intervalMs;
        }
        case 'at': {
            if (!job.scheduleAt) return false;
            const target = new Date(job.scheduleAt);
            // Fire if we're past the target and haven't run yet (or ran before target)
            return now >= target && (!job.lastRunAt || job.lastRunAt < target.getTime());
        }
        case 'cron': {
            if (!job.cronExpr) return false;
            // Only fire once per minute: check if last run was in a different minute
            const lastRunMin = job.lastRunAt ? Math.floor(job.lastRunAt / 60000) : 0;
            const nowMin = Math.floor(now.getTime() / 60000);
            if (lastRunMin === nowMin) return false;
            return matchesCronExpr(job.cronExpr, now);
        }
        default:
            return false;
    }
}

export interface UseCronEngineOptions {
    apiConfig: APIConfig;
    agentName: string;
    userName: string;
    onCronMessage: (content: string, meta?: Record<string, unknown>) => void;
    enabled: boolean;
}

export function useCronEngine(opts: UseCronEngineOptions) {
    const [jobs, setJobs] = useState<CronJob[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const optsRef = useRef(opts);
    optsRef.current = opts;

    // Load jobs from DB
    const loadJobs = useCallback(async () => {
        const loaded = await DB.getAllCronJobs();
        setJobs(loaded);
        return loaded;
    }, []);

    // Add or update a job
    const saveJob = useCallback(async (job: CronJob) => {
        await DB.saveCronJob(job);
        await loadJobs();
    }, [loadJobs]);

    // Delete a job
    const deleteJob = useCallback(async (id: string) => {
        await DB.deleteCronJob(id);
        await loadJobs();
    }, [loadJobs]);

    // Execute a job: send its prompt to LLM silently
    const executeJob = useCallback(async (job: CronJob) => {
        const { apiConfig, agentName, userName } = optsRef.current;
        if (!apiConfig.apiKey) return;

        try {
            const now = new Date();
            const systemPrompt = `You are ${agentName}. Current time: ${now.toLocaleString()}. The user is ${userName}. You are executing a scheduled task. Respond naturally as if you are the AI companion proactively reaching out.`;

            const resolved = resolveApiEndpoint(apiConfig);
            let requestBody: any = {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `[CRON TASK: ${job.name}]\n${job.prompt}` },
                ],
                temperature: 0.7,
            };
            if (resolved.transformBody) requestBody = resolved.transformBody(requestBody);
            const response = await fetch(resolved.chatUrl, {
                method: 'POST',
                headers: resolved.headers,
                body: JSON.stringify(requestBody),
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.choices?.[0]?.message?.content?.trim();
                if (text) {
                    optsRef.current.onCronMessage(text, { triggerSource: `cron:${job.id}`, cronJobName: job.name });
                }
            }

            // Update lastRunAt
            const updated: CronJob = { ...job, lastRunAt: Date.now() };
            // For one-shot 'at' jobs, disable after firing
            if (job.scheduleKind === 'at') {
                updated.enabled = false;
            }
            await DB.saveCronJob(updated);
        } catch (err) {
            console.error(`[CronEngine] Failed to execute job ${job.name}:`, err);
        }
    }, []);

    // Tick: check all jobs
    const tick = useCallback(async () => {
        if (!optsRef.current.enabled || isRunning) return;
        setIsRunning(true);
        try {
            const currentJobs = await loadJobs();
            const now = new Date();
            for (const job of currentJobs) {
                if (shouldFire(job, now)) {
                    console.log(`[CronEngine] Firing job: ${job.name}`);
                    await executeJob(job);
                }
            }
        } finally {
            setIsRunning(false);
        }
    }, [loadJobs, executeJob, isRunning]);

    // Timer: tick every 60 seconds
    useEffect(() => {
        if (!opts.enabled) return;
        loadJobs();
        const interval = setInterval(tick, 60_000);
        // Initial check after 5s delay
        const initialTimeout = setTimeout(tick, 5_000);
        return () => {
            clearInterval(interval);
            clearTimeout(initialTimeout);
        };
    }, [opts.enabled, tick, loadJobs]);

    // Seed the default "memory fold" system cron if missing
    const seedSystemCrons = useCallback(async () => {
        const existing = await DB.getAllCronJobs();
        const hasMemoryFold = existing.some(j => j.id === 'system-memory-fold');
        if (!hasMemoryFold) {
            await DB.saveCronJob({
                id: 'system-memory-fold',
                name: '每日记忆归档',
                description: '每天凌晨2点自动提炼昨日对话为记忆摘要',
                enabled: true,
                type: 'system',
                scheduleKind: 'cron',
                cronExpr: '0 2 * * *',
                prompt: '[System Cron: Memory Archival] Please review all chat logs from the past 24 hours and generate a structured daily memory summary following the L3 format (Atmosphere, Core Events, Dynamic Layer Update, Core Layer Proposals, Search Index). Keep under 300 characters. Output in Chinese.',
                createdAt: Date.now(),
            });
            await loadJobs();
        }
    }, [loadJobs]);

    useEffect(() => {
        seedSystemCrons();
    }, [seedSystemCrons]);

    return { jobs, saveJob, deleteJob, loadJobs, executeJob };
}
