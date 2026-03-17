/**
 * useHeartbeat — OpenClaw-inspired silent Agent heartbeat for NovaClaw
 *
 * Every `intervalMinutes` (default 30, configurable by user or agent),
 * sends a hidden system prompt to the LLM asking if the agent has
 * anything to say or any deferred tasks to handle.
 *
 * If the LLM returns [SILENT], nothing happens.
 * If it returns text, it's pushed to the chat and a browser notification fires.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { HeartbeatConfig, APIConfig } from '../types';
import { resolveApiEndpoint } from '../utils/apiResolver';

export interface UseHeartbeatOptions {
    config: HeartbeatConfig;
    apiConfig: APIConfig;
    agentName: string;
    userName: string;
    lastMsgTimestamp: number | undefined;
    onHeartbeatMessage: (content: string) => void;
    onUpdateConfig: (config: HeartbeatConfig) => void;
    enabled: boolean;
}

const SILENT_TOKEN = '[SILENT]';

const DEFAULT_HEARTBEAT_PROMPT = `[System: Heartbeat Check]
You are {agentName}. Current time: {time}.
Check if there are any deferred tasks, scheduled reminders, or if you simply have something caring/warm to say to {userName} right now.

Rules:
- If there is NOTHING to say, respond ONLY with: [SILENT]
- If you want to send a proactive message (caring, reminder, fun fact, etc.), just write it naturally. Keep it short (1-2 sentences max).
- Do NOT explain that this is a heartbeat. Just be natural.`;

export function useHeartbeat(opts: UseHeartbeatOptions) {
    const [lastBeat, setLastBeat] = useState<number>(opts.config.lastBeatAt || 0);
    const [isBusy, setIsBusy] = useState(false);
    const optsRef = useRef(opts);
    optsRef.current = opts;

    const beat = useCallback(async () => {
        const { config, apiConfig, agentName, userName, onHeartbeatMessage, onUpdateConfig } = optsRef.current;
        if (!config.enabled || !apiConfig.apiKey || isBusy) return;

        setIsBusy(true);
        try {
            const now = new Date();
            const prompt = (config.prompt || DEFAULT_HEARTBEAT_PROMPT)
                .replace(/\{agentName\}/g, agentName)
                .replace(/\{userName\}/g, userName)
                .replace(/\{time\}/g, now.toLocaleString());

            const resolved = resolveApiEndpoint(apiConfig);
            let requestBody: any = {
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.6,
                    max_tokens: 200,
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

                if (text && !text.includes(SILENT_TOKEN)) {
                    onHeartbeatMessage(text);

                    // Browser notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification(agentName, { body: text, icon: '/favicon.ico' });
                    }
                }
            }

            // Update lastBeatAt
            const newBeat = Date.now();
            setLastBeat(newBeat);
            onUpdateConfig({ ...config, lastBeatAt: newBeat });
        } catch (err) {
            console.error('[Heartbeat] Error:', err);
        } finally {
            setIsBusy(false);
        }
    }, [isBusy]);

    // Timer
    useEffect(() => {
        if (!opts.enabled || !opts.config.enabled) return;

        const intervalMs = (opts.config.intervalMinutes || 30) * 60_000;

        // Check if we should fire immediately (enough time passed since last beat)
        const timeSinceLastBeat = Date.now() - (opts.config.lastBeatAt || 0);
        const initialDelay = timeSinceLastBeat >= intervalMs ? 10_000 : (intervalMs - timeSinceLastBeat);

        const initialTimeout = setTimeout(() => {
            beat();
        }, initialDelay);

        const interval = setInterval(beat, intervalMs);

        return () => {
            clearTimeout(initialTimeout);
            clearInterval(interval);
        };
    }, [opts.enabled, opts.config.enabled, opts.config.intervalMinutes, beat]);

    // Request notification permission on mount
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    return { lastBeat, isBusy, manualBeat: beat };
}
