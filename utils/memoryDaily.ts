/**
 * memoryDaily.ts — L3 Summary Generator
 *
 * Generates daily / weekly / monthly L3 summary artifacts from L2 clean sessions
 * and behavior indexes. Rule-based extraction; LLM enhancement is optional via
 * the `callLLM` callback parameter.
 *
 * Output paths:
 *   memory/summaries/daily/YYYY/YYYY-MM/YYYY-MM-DD.daily.json
 *   memory/summaries/weekly/YYYY/YYYY-Www.weekly.json
 *   memory/summaries/monthly/YYYY/YYYY-MM.monthly.json
 *   memory/summaries/indexes/catalog.json
 */

import { fsBridge } from './fsBridge';
import {
    LLM_SESSION_SYSTEM,
    LLM_CHUNK_COMBINE_SYSTEM,
    LLM_MEMORY_DAILY_SYSTEM,
    LLM_MEMORY_WEEKLY_SYSTEM,
    LLM_MEMORY_MONTHLY_SYSTEM,
    LLM_MEMORY_YEARLY_SYSTEM,
} from './chatPrompts';
import {
    L2CleanSession,
    L2DayManifest,
    BehaviorDayIndex,
    L3DailySummary,
    L3WeeklySummary,
    L3MonthlySummary,
    L3YearlySummary,
    L3SummaryCatalog,
    L3CatalogItem,
    L3CoreProposalDraft,
    L3DynamicLayerSnapshot,
    L3SearchIndex,
    L3SummaryStats,
    L3SourcePointer,
    MemorySummaryLevel,
    DayKey,
    WeekKey,
    MonthKey,
    YearKey,
    CoreProposal,
    CoreProposalCategory,
    DynamicMemory,
    L3ProposalAuditRecord,
    L3KeywordIndex,
} from '../types';

// ── Path helpers ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export const toDayKey = (ts: number): DayKey => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const dayFolder = (dayKey: string) => {
    const [year, month] = dayKey.split('-');
    return `${year}/${year}-${month}/${dayKey}`;
};

const toMonthKey = (dayKey: string): MonthKey => dayKey.substring(0, 7);

const getDaysForISOWeek = (year: number, weekNum: number): DayKey[] => {
    // Get Monday of the given ISO week
    const simple = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
    const dow = simple.getUTCDay();
    const monday = new Date(simple);
    monday.setUTCDate(simple.getUTCDate() - ((dow + 6) % 7));
    const days: DayKey[] = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        days.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    }
    return days;
};

export const toISOWeekKey = (dayKey: DayKey): WeekKey => {
    const d = new Date(dayKey + 'T12:00:00Z');
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${thursday.getUTCFullYear()}-W${pad(weekNum)}`;
};

// ── FS helpers ────────────────────────────────────────────────────────────────

const readJsonSafe = async <T>(
    rootPath: string,
    path: string,
    allowGlobal: boolean,
    fallback: T,
): Promise<T> => {
    try {
        const raw = await fsBridge.readFile(rootPath, path, allowGlobal);
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const writeJsonSafe = async (
    rootPath: string,
    path: string,
    allowGlobal: boolean,
    data: unknown,
): Promise<void> => {
    // Ensure parent directory exists
    const parts = path.split('/');
    parts.pop();
    const folder = parts.join('/');
    if (folder) {
        await fsBridge.createFolder(rootPath, folder, allowGlobal).catch(() => { });
    }
    await fsBridge.writeFile(rootPath, path, JSON.stringify(data, null, 2), allowGlobal);
};

// ── L2 readers ────────────────────────────────────────────────────────────────

const readL2CleanForDay = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: DayKey,
): Promise<L2CleanSession[]> => {
    const manifest = await readJsonSafe<L2DayManifest>(
        rootPath,
        `memory/sessions/${dayFolder(dayKey)}/manifest.json`,
        allowGlobal,
        { version: 1, dayKey, updatedAt: 0, parts: [] },
    );
    const sessions: L2CleanSession[] = [];
    for (const entry of manifest.parts) {
        if (!entry.cleanFile) continue;
        const clean = await readJsonSafe<L2CleanSession | null>(
            rootPath,
            entry.cleanFile,
            allowGlobal,
            null,
        );
        if (clean) sessions.push(clean);
    }
    return sessions;
};

const readBehaviorIndex = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: DayKey,
): Promise<BehaviorDayIndex | null> =>
    readJsonSafe<BehaviorDayIndex | null>(
        rootPath,
        `memory/indexes/behavior/${dayKey}.index.json`,
        allowGlobal,
        null,
    );

// ── Rule-based extractors ─────────────────────────────────────────────────────

const STOPWORDS = new Set([
    '就是', '这个', '那个', '然后', '你们', '我们', '自己', '已经', '因为', '但是',
    '还是', '一个', '一些', '一下', '现在', '今天', '刚才', '可以', '需要', '如果',
    '什么', '怎么', '为什么', '哪里', '这样', '那样', '知道', '觉得', '感觉',
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'your',
    'about', 'into', 'then', 'just', 'there', 'what', 'when', 'where', 'which',
]);

const tokenize = (text: string): string[] => {
    const matches = text.match(/[\u4e00-\u9fa5]{2,6}|[a-zA-Z]{3,}/g);
    return matches ? matches.map(x => x.toLowerCase()) : [];
};

const pickTopKeywords = (texts: string[], maxCount = 12): string[] => {
    const freq = new Map<string, number>();
    for (const t of texts) {
        for (const token of tokenize(t)) {
            if (STOPWORDS.has(token)) continue;
            freq.set(token, (freq.get(token) || 0) + 1);
        }
    }
    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCount)
        .map(([k]) => k);
};

const buildHighlights = (sessions: L2CleanSession[]): string[] => {
    const highlights: string[] = [];
    for (const session of sessions) {
        for (const seg of session.segments) {
            // Use first user message in segment as a highlight anchor
            const firstUser = seg.messages?.find(m => m.role === 'user');
            if (firstUser && firstUser.text.length > 10) {
                const excerpt = firstUser.text.substring(0, 80).replace(/\n/g, ' ');
                if (!highlights.some(h => h.includes(excerpt.substring(0, 20)))) {
                    highlights.push(excerpt);
                }
            }
        }
    }
    return highlights.slice(0, 8);
};

const buildSearchIndex = (
    sessions: L2CleanSession[],
    behaviorIdx: BehaviorDayIndex | null,
): L3SearchIndex => {
    const allText: string[] = [];

    for (const session of sessions) {
        for (const seg of session.segments) {
            for (const msg of seg.messages ?? []) {
                allText.push(msg.text);
            }
        }
    }

    const refs: L3SearchIndex['refs'] = [];
    if (behaviorIdx) {
        for (const [appId] of Object.entries(behaviorIdx.appOpenCount)) {
            allText.push(appId);
        }
        for (const ref of (behaviorIdx.highValueRefs || [])) {
            refs.push({
                appId: ref.appId,
                refType: ref.refType,
                refId: ref.refId,
                score: ref.score,
                lastTs: ref.lastTs,
            });
        }
    }

    return {
        keywords: pickTopKeywords(allText),
        refs: refs.slice(0, 20),
    };
};

const buildDynamicLayer = (
    sessions: L2CleanSession[],
    behaviorIdx: BehaviorDayIndex | null,
): L3DynamicLayerSnapshot => {
    const currentState: string[] = [];
    const purposeContext: string[] = [];
    const onTheHorizon: string[] = [];
    const others: string[] = [];

    for (const session of sessions) {
        for (const seg of session.segments) {
            const msgs = seg.messages ?? [];
            const allText = msgs.map(m => m.text).join(' ');
            if (!allText) continue;
            const text = allText;

            const toolsLower = (seg.toolCalls ?? []).map(t => t.toolName.toLowerCase());
            const hasSchedule = toolsLower.some(t => t.includes('schedule') || t.includes('reminder') || t.includes('task'));
            const hasSearch = toolsLower.some(t => t.includes('search') || t.includes('browse') || t.includes('fetch'));

            // Derive semantic signals from actual message text
            const userMsg = msgs.find(m => m.role === 'user')?.text || '';
            const PLANNING_RE = /计划|打算|准备|想做|打算|安排|下周|明天|之后|以后/;
            const DOING_RE = /正在|现在|刚|今天|马上|立刻|已经在/;

            if (hasSchedule || PLANNING_RE.test(userMsg)) {
                purposeContext.push(text.substring(0, 100));
            } else if (DOING_RE.test(userMsg)) {
                currentState.push(text.substring(0, 100));
            } else if (hasSearch) {
                others.push(text.substring(0, 100));
            }
        }
    }

    // Use behavior for current state signal
    if (behaviorIdx) {
        const topApps = Object.entries(behaviorIdx.appOpenCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([appId, count]) => `${appId}×${count}`);
        if (topApps.length > 0) {
            currentState.push(`今日活跃: ${topApps.join(', ')}`);
        }
        const totalDwell = Object.values(behaviorIdx.totalDwellMsByApp || {}).reduce((s, v) => s + v, 0);
        if (totalDwell > 10 * 60 * 1000) {
            const hours = (totalDwell / 3600000).toFixed(1);
            currentState.push(`今日使用时长约 ${hours} 小时`);
        }
    }

    return {
        currentState: [...new Set(currentState)].slice(0, 3),
        purposeContext: [...new Set(purposeContext)].slice(0, 3),
        onTheHorizon: [...new Set(onTheHorizon)].slice(0, 3),
        others: [...new Set(others)].slice(0, 3),
    };
};

// Keyword-based signals for proposal drafts
const PREFERENCE_RE = /喜欢|偏好|习惯|总是|经常|不喜欢|讨厌|抗拒|不想|一直都/;
const RELATIONSHIP_RE = /我们俩|一起|关系|感情|你和我|之间|陪|想你|好想|在意/;
const NOVA_TRAIT_RE = /希望你|你应该|你能不能|如果你|你比较|你最好|你的方式|你对我/;

const buildProposalDrafts = (
    sessions: L2CleanSession[],
    dayKey: DayKey,
): L3CoreProposalDraft[] => {
    const drafts: L3CoreProposalDraft[] = [];
    const now = Date.now();

    for (const session of sessions) {
        for (const seg of session.segments) {
            // Run regex on actual user messages (not stats summaries)
            const userTexts = (seg.messages ?? []).filter(m => m.role === 'user').map(m => m.text);
            const text = userTexts.join(' ');
            if (text.length < 12) continue;

            if (PREFERENCE_RE.test(text)) {
                drafts.push({
                    id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    category: 'user_profile',
                    proposal: text.substring(0, 150),
                    reason: `从 ${dayKey} 对话中检测到用户偏好/习惯信号`,
                    confidence: 0.4,
                    status: 'pending',
                });
            }

            if (RELATIONSHIP_RE.test(text)) {
                drafts.push({
                    id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    category: 'relationship_core',
                    proposal: text.substring(0, 150),
                    reason: `从 ${dayKey} 对话中检测到关系状态相关信号`,
                    confidence: 0.35,
                    status: 'pending',
                });
            }

            if (NOVA_TRAIT_RE.test(text)) {
                drafts.push({
                    id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    category: 'about_agent',
                    proposal: text.substring(0, 150),
                    reason: `从 ${dayKey} 对话中检测到用户对 Agent 行为的期望`,
                    confidence: 0.38,
                    status: 'pending',
                });
            }
        }
    }

    // De-duplicate by proposal text prefix, limit to 5
    const seen = new Set<string>();
    return drafts.filter(d => {
        const key = d.proposal.substring(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 5);
};

// ── LLM summarization support ─────────────────────────────────────────────────

export interface LLMSummaryCallConfig {
    /** Lightweight model callback — used for daily summaries */
    callLLM: (systemPrompt: string, userPrompt: string) => Promise<string>;
    /** Strong model callback — used for weekly/monthly; falls back to callLLM if absent */
    callLLMStrong?: (systemPrompt: string, userPrompt: string) => Promise<string>;
    /** Character's display name — used in prompts to maintain persona */
    charName?: string;
    /** User's display name — used in prompts */
    userName?: string;
}

interface LLMDailySummaryOutput {
    highlights: string[];
    dynamicLayer: {
        currentState: string[];
        purposeContext: string[];
        onTheHorizon: string[];
        others: string[];
    };
    coreProposalDrafts: Array<{
        category: CoreProposalCategory;
        proposal: string;
        reason: string;
        confidence: number;
    }>;
    /** Weekly LLM output: observed trends */
    trendNotes?: string[];
    /** Monthly LLM output: stable behavior patterns */
    stablePatterns?: string[];
}

/**
 * Compiles L2 sessions + behavior index into a ~2500-char text block for the daily LLM prompt.
 */
/**
 * P2: Read file activity events for a given day from the file index event log.
 * Returns compact summary lines like "created: workspace/notes.md".
 */
const readFileActivityLines = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: DayKey,
): Promise<string[]> => {
    const [year, month] = dayKey.split('-');
    const path = `memory/indexes/files/events/${year}/${year}-${month}/${dayKey}.events.jsonl`;
    try {
        const raw = await fsBridge.readFile(rootPath, path, allowGlobal);
        const lines: string[] = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const ev = JSON.parse(trimmed) as {
                    eventType: string; path?: string; toPath?: string; fromPath?: string;
                    scope: string; actor?: string;
                };
                // Only workspace and gallery carry memory value
                if (ev.scope !== 'workspace' && ev.scope !== 'gallery') continue;
                // Skip system housekeeping (scan_backfill, reconciliation)
                if (ev.actor === 'system') continue;

                const filePath = ev.toPath ?? ev.path ?? '';
                const name = filePath.split('/').pop() || filePath;
                if (!name) continue;

                const scopeTag = ev.scope === 'gallery' ? '相册' : '工作区';
                const actorTag = ev.actor === 'agent' ? '[agent]' : ev.actor === 'user' ? '[用户]' : '';
                const fromName = ev.fromPath ? ev.fromPath.split('/').pop() : '';
                const detail = ev.eventType === 'moved' && fromName ? `${fromName} → ${name}` : name;
                // Priority: delete/move events first (pushed to front)
                const entry = `${actorTag}${scopeTag} ${ev.eventType}: ${detail}`;
                if (ev.eventType === 'deleted' || ev.eventType === 'moved') {
                    lines.unshift(entry);
                } else {
                    lines.push(entry);
                }
            } catch { /* malformed line */ }
        }
        return lines.slice(0, 30);
    } catch {
        return [];
    }
};

/**
 * Reads dynamic app lifecycle events (create/delete) for a given day.
 * These are tracked separately from file activity because dynamic_app scope
 * is filtered out of readFileActivityLines (correct — file ops on internal app
 * code aren't meaningful for memory). But the semantic fact "created/deleted an app"
 * IS meaningful.
 */
const readAppLifecycleLines = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: DayKey,
): Promise<string[]> => {
    const [year, month] = dayKey.split('-');
    const path = `memory/indexes/files/events/${year}/${year}-${month}/${dayKey}.events.jsonl`;
    try {
        const raw = await fsBridge.readFile(rootPath, path, allowGlobal);
        const lines: string[] = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const ev = JSON.parse(trimmed) as {
                    eventType: string; scope: string; reason?: string;
                    path?: string; toPath?: string; actor?: string;
                };
                if (ev.scope !== 'dynamic_app') continue;
                const reason = ev.reason || '';
                // Only capture meaningful lifecycle events, not internal file writes
                const isCreate = reason.includes('create_dynamic_app') || reason.includes('create_app');
                const isDelete = reason.includes('trash_dynamic_app') || reason.includes('delete_dynamic_app');
                if (!isCreate && !isDelete) continue;

                const filePath = ev.toPath ?? ev.path ?? '';
                const appName = filePath.split('/').pop()?.replace(/\.tsx$/, '') || filePath;
                if (!appName) continue;

                const actorTag = ev.actor === 'agent' ? '[agent]' : ev.actor === 'user' ? '[用户]' : '';
                if (isCreate) {
                    lines.push(`${actorTag}创建了动态应用「${appName}」`);
                } else {
                    lines.push(`${actorTag}删除了动态应用「${appName}」`);
                }
            } catch { /* malformed */ }
        }
        return lines;
    } catch {
        return [];
    }
};

// Note: user app usage (behavior index) is already rendered via the `behaviorIdx` param
// passed directly into buildDailyPromptFromSessionSummaries — no need for a separate reader.

// ── Session-level LLM summarization (Phase 1) ───────────────────────────────

/** Max chars of message content to include in a single session prompt.
 *  If the session is longer, oldest messages are dropped first. */
const SESSION_PROMPT_MAX_CHARS = 14_000;

const padT2 = (n: number) => String(n).padStart(2, '0');
const toHHMM = (ts: number) => {
    const d = new Date(ts);
    return `${padT2(d.getHours())}:${padT2(d.getMinutes())}`;
};

/**
 * Builds the user-prompt for a single session's LLM summarization call.
 * Full message text — no truncation per message. If total content exceeds
 * SESSION_PROMPT_MAX_CHARS, oldest messages are dropped first to fit.
 */
export const buildSessionPrompt = (session: L2CleanSession): string => {
    const startTime = toHHMM(session.startAt);
    const endTime = toHHMM(session.endAt);
    const parts: string[] = [`=== Session [${startTime} - ${endTime}] ===`];

    // Tool/decision timeline
    const actions = session.agentActions ?? [];
    if (actions.length > 0) {
        parts.push('\n[工具/决策]');
        for (const action of actions) {
            const label = action.type === 'tool_call' ? '[工具]'
                : action.type === 'decision' ? '[决策]'
                    : `[App:${action.appId ?? '?'}]`;
            const result = action.resultSummary ? `→ ${action.resultSummary}` : '';
            parts.push(`· ${action.time} ${label} ${action.narrative}${result ? ' ' + result : ''}`);
        }
    }

    // Collect all messages across segments
    const allMessages = session.segments.flatMap(seg => seg.messages ?? []);
    if (allMessages.length === 0) return parts.join('\n');

    parts.push('\n[对话]');
    for (const msg of allMessages) {
        const time = toHHMM(msg.ts);
        const role = msg.role === 'user' ? '用户' : 'Agent';
        parts.push(`(${time}) ${role}：${msg.text}`);
    }

    return parts.join('\n');
};

// ── Session chunking (for large sessions that exceed model context) ────────────

/** Split messages into chunks where each chunk ≤ maxCharsPerChunk characters. */
const splitMessagesIntoChunks = (
    messages: Array<{ role: string; text: string; ts: number }>,
    maxCharsPerChunk: number,
): Array<typeof messages> => {
    const chunks: Array<typeof messages> = [];
    let current: typeof messages = [];
    let currentChars = 0;

    for (const msg of messages) {
        const msgChars = msg.text.length + 30; // +30 for timestamp/role prefix
        if (current.length > 0 && currentChars + msgChars > maxCharsPerChunk) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(msg);
        currentChars += msgChars;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
};

const buildChunkPrompt = (
    messages: Array<{ role: string; text: string; ts: number }>,
    session: L2CleanSession,
    chunkIndex: number,
    totalChunks: number,
): string => {
    const parts = [
        `=== Session 片段 ${chunkIndex}/${totalChunks} [${toHHMM(session.startAt)}-${toHHMM(session.endAt)}] ===`,
        '\n[对话]',
    ];
    for (const msg of messages) {
        const role = msg.role === 'user' ? '用户' : 'Agent';
        parts.push(`(${toHHMM(msg.ts)}) ${role}：${msg.text}`);
    }
    // Only include agentActions in first chunk to avoid duplication
    if (chunkIndex === 1 && (session.agentActions ?? []).length > 0) {
        parts.splice(1, 0, '\n[工具/决策]');
        for (const a of session.agentActions!) {
            const label = a.type === 'tool_call' ? '[工具]' : a.type === 'decision' ? '[决策]' : `[App:${a.appId ?? '?'}]`;
            parts.splice(2, 0, `· ${a.time} ${label} ${a.narrative}${a.resultSummary ? ' → ' + a.resultSummary : ''}`);
        }
    }
    return parts.join('\n');
};

const mergeSessionSummaries = (summaries: LLMSessionSummaryOutput[]): LLMSessionSummaryOutput => ({
    coreEvents: summaries.flatMap(s => s.coreEvents),
    emotionalCues: [...new Set(summaries.flatMap(s => s.emotionalCues))],
    decisions: [...new Set(summaries.flatMap(s => s.decisions))],
    preferenceSignals: [...new Set(summaries.flatMap(s => s.preferenceSignals))],
    toolHighlights: summaries.flatMap(s => s.toolHighlights),
});

/**
 * Summarizes a session that is too large for a single LLM call by splitting
 * it into chunks, summarizing each, then combining with a second LLM call.
 */
const summarizeSessionInChunks = async (
    session: L2CleanSession,
    callLLM: (sys: string, user: string) => Promise<string>,
    charName: string,
    userName: string,
): Promise<LLMSessionSummaryOutput | null> => {
    const allMessages = session.segments.flatMap(s => s.messages ?? []);
    const chunks = splitMessagesIntoChunks(allMessages, SESSION_PROMPT_MAX_CHARS);

    const chunkSummaries = await Promise.all(
        chunks.map(async (chunkMsgs, i) => {
            const prompt = buildChunkPrompt(chunkMsgs, session, i + 1, chunks.length);
            try {
                const raw = await callLLM(LLM_SESSION_SYSTEM(charName, userName), prompt);
                return tryParseSessionSummary(raw);
            } catch { return null; }
        }),
    );

    const valid = chunkSummaries.filter((s): s is LLMSessionSummaryOutput => s !== null);
    if (valid.length === 0) return null;
    if (valid.length === 1) return valid[0];

    // Combine chunk summaries with a second LLM call
    const combineParts = valid.map((s, i) => [
        `[片段 ${i + 1}]`,
        s.coreEvents.length > 0 ? `核心事件：${s.coreEvents.join('；')}` : '',
        s.emotionalCues.length > 0 ? `情绪：${s.emotionalCues.join('、')}` : '',
        s.decisions.length > 0 ? `决策：${s.decisions.join('；')}` : '',
        s.preferenceSignals.length > 0 ? `偏好信号：${s.preferenceSignals.join('；')}` : '',
    ].filter(Boolean).join('\n'));
    const combinePrompt = `以下是同一session分 ${valid.length} 个片段的提炼结果：\n\n${combineParts.join('\n\n')}`;

    try {
        const raw = await callLLM(LLM_CHUNK_COMBINE_SYSTEM(charName, userName), combinePrompt);
        return tryParseSessionSummary(raw) ?? mergeSessionSummaries(valid);
    } catch {
        return mergeSessionSummaries(valid);
    }
};

interface LLMSessionSummaryOutput {
    coreEvents: string[];
    emotionalCues: string[];
    decisions: string[];
    preferenceSignals: string[];
    toolHighlights: string[];
}

const tryParseSessionSummary = (raw: string): LLMSessionSummaryOutput | null => {
    try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(clean) as LLMSessionSummaryOutput;
        if (!Array.isArray(parsed.coreEvents)) return null;
        return parsed;
    } catch { return null; }
};

/**
 * Builds the daily LLM prompt (Phase 2) from per-session summaries + behavior data.
 * Replaces the old compileDailyInput which truncated message content.
 */
export const buildDailyPromptFromSessionSummaries = (
    sessionSummaries: Array<{ session: L2CleanSession; summary: LLMSessionSummaryOutput | null }>,
    behaviorIdx: BehaviorDayIndex | null,
    dayKey: DayKey,
    fileActivityLines?: string[],
    appLifecycleLines?: string[],
): string => {
    const parts: string[] = [`=== 日期: ${dayKey} ===`];

    if (sessionSummaries.length === 0) {
        parts.push('\n[今日没有聊天对话，以下仅为行为数据。请勿虚构对话内容。]');
    }

    for (let i = 0; i < sessionSummaries.length; i++) {
        const { session, summary } = sessionSummaries[i];
        const start = toHHMM(session.startAt);
        const end = toHHMM(session.endAt);
        const msgCount = session.stats.userMessages + session.stats.assistantMessages;
        parts.push(`\n[Session ${i + 1}] ${start}-${end}（${msgCount} 条消息）`);

        if (summary) {
            if (summary.coreEvents.length > 0)
                parts.push(`核心事件：${summary.coreEvents.join('；')}`);
            if (summary.emotionalCues.length > 0)
                parts.push(`情绪/状态：${summary.emotionalCues.join('、')}`);
            if (summary.decisions.length > 0)
                parts.push(`决策/计划：${summary.decisions.join('；')}`);
            if (summary.preferenceSignals.length > 0)
                parts.push(`偏好信号：${summary.preferenceSignals.join('；')}`);
            if (summary.toolHighlights.length > 0)
                parts.push(`工具结果：${summary.toolHighlights.join('；')}`);
        } else {
            // Fallback: render raw messages if session summary failed
            const msgs = session.segments.flatMap(s => s.messages ?? []).slice(0, 8);
            for (const m of msgs) {
                parts.push(`  ${m.role === 'user' ? 'U' : 'A'}: ${m.text.substring(0, 120).replace(/\n/g, ' ')}`);
            }
        }
    }

    // App usage
    if (behaviorIdx) {
        const openCounts = behaviorIdx.appOpenCount || {};
        const dwellMap = behaviorIdx.totalDwellMsByApp || {};
        const appIds = [...new Set([...Object.keys(openCounts), ...Object.keys(dwellMap)])]
            .sort((a, b) => (dwellMap[b] ?? 0) - (dwellMap[a] ?? 0))
            .slice(0, 6);
        if (appIds.length > 0) {
            parts.push('\n[App 使用]');
            for (const id of appIds) {
                const opens = openCounts[id] ?? 0;
                const mins = Math.round((dwellMap[id] ?? 0) / 60000);
                const timeStr = mins >= 60 ? `约${(mins / 60).toFixed(1)}小时`
                    : mins > 0 ? `约${mins}分钟` : '';
                const detail = [opens > 0 ? `打开${opens}次` : '', timeStr].filter(Boolean).join('、');
                if (detail) parts.push(`· ${id}：${detail}`);
            }
        }
    }

    // File activity (list format, delete/move already prioritized by readFileActivityLines)
    if (fileActivityLines && fileActivityLines.length > 0) {
        parts.push('\n[文件活动]');
        for (const fl of fileActivityLines.slice(0, 15)) {
            parts.push(`· ${fl}`);
        }
    }

    // Dynamic app lifecycle (create/delete) — semantic events worth remembering
    if (appLifecycleLines && appLifecycleLines.length > 0) {
        parts.push('\n[应用变动]');
        for (const al of appLifecycleLines) {
            parts.push(`· ${al}`);
        }
    }

    return parts.join('\n');
};

/**
 * Compiles daily summaries into a ~2800-char text block for the weekly LLM prompt.
 */
const compileWeeklyInput = (dailySummaries: L3DailySummary[], weekKey: WeekKey): string => {
    const parts: string[] = [`=== 周报: ${weekKey} (${dailySummaries.length} 天有数据) ===`];
    for (const d of dailySummaries) {
        parts.push(`\n--- ${d.dayKey} ---`);
        d.highlights.forEach(h => parts.push(`· ${h}`));
        const cs = d.dynamicLayer.currentState.filter(Boolean);
        if (cs.length > 0) parts.push(`  状态: ${cs.join(' / ')}`);
        const pc = d.dynamicLayer.purposeContext.filter(Boolean);
        if (pc.length > 0) parts.push(`  目标: ${pc.join(' / ')}`);
    }
    return parts.join('\n');
};

/**
 * Compiles weekly (or daily fallback) summaries for the monthly LLM prompt (~3200 chars).
 */
const compileMonthlyInput = (
    weeklySummaries: L3WeeklySummary[],
    dailySummaries: L3DailySummary[],
    monthKey: MonthKey,
): string => {
    const parts: string[] = [`=== 月报: ${monthKey} ===`];
    if (weeklySummaries.length > 0) {
        for (const w of weeklySummaries) {
            parts.push(`\n--- ${w.weekKey} ---`);
            w.highlights.forEach(h => parts.push(`· ${h}`));
            w.trendNotes.forEach(t => parts.push(`  趋势: ${t}`));
        }
    } else {
        for (const d of dailySummaries) {
            parts.push(`\n--- ${d.dayKey} ---`);
            d.highlights.forEach(h => parts.push(`· ${h}`));
        }
    }
    return parts.join('\n');
};


const tryParseLLMOutput = (raw: string): LLMDailySummaryOutput | null => {
    try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(clean) as LLMDailySummaryOutput;
        if (!Array.isArray(parsed.highlights)) return null;
        return parsed;
    } catch {
        return null;
    }
};

// ── Generate daily summary ────────────────────────────────────────────────────

export interface GenerateL3DailyInput {
    rootPath: string;
    allowGlobal: boolean;
    dayKey: DayKey;
    /** Overwrite even if a valid summary already exists */
    force?: boolean;
    /** Optional: use LLM to override rule-based highlights/dynamicLayer/proposals */
    llmConfig?: LLMSummaryCallConfig;
}

export const generateL3Daily = async (
    input: GenerateL3DailyInput,
): Promise<L3DailySummary | null> => {
    const { rootPath, allowGlobal, dayKey, force = false } = input;

    // LLM is required — skip entirely if not configured (compensation will retry later)
    if (!input.llmConfig) {
        console.warn(`[L3][daily] skip ${dayKey}: no LLM config — will retry via compensation`);
        return null;
    }

    const summaryPath = `memory/summaries/daily/${dayFolder(dayKey)}.daily.json`;

    if (!force) {
        const existing = await readJsonSafe<L3DailySummary | null>(
            rootPath, summaryPath, allowGlobal, null,
        );
        if (existing?.version) return existing;
    }

    // Read both sources in parallel — behavior index alone is enough to generate a summary
    const [sessions, behaviorIdx] = await Promise.all([
        readL2CleanForDay(rootPath, allowGlobal, dayKey),
        readBehaviorIndex(rootPath, allowGlobal, dayKey),
    ]);

    // Only skip if truly nothing happened that day
    const hasActivity = sessions.length > 0 || (behaviorIdx && behaviorIdx.totalEvents > 0);
    if (!hasActivity) return null;

    // Aggregate stats
    let messageEvents = 0;
    let toolEvents = 0;
    let userActions = 0;
    let startTs = Infinity;
    let endTs = 0;
    const activeAppsSet = new Set<string>();
    const sourceFiles: L3SourcePointer[] = [];

    for (const session of sessions) {
        messageEvents += (session.stats.userMessages + session.stats.assistantMessages);
        toolEvents += session.stats.toolEvents;
        userActions += session.stats.agentDecisions + session.stats.appInteractions;
        const startedAt = session.segments[0]?.startAt ?? Date.now();
        const endedAt = session.segments[session.segments.length - 1]?.endAt ?? Date.now();
        if (startedAt < startTs) startTs = startedAt;
        if (endedAt > endTs) endTs = endedAt;
        sourceFiles.push({
            kind: 'l2_clean',
            path: `memory/sessions/${dayFolder(dayKey)}/session-${session.sessionId}.part-${pad(session.part)}.clean.json`,
            dayKey,
            sessionId: session.sessionId,
            part: session.part,
        });
    }

    if (behaviorIdx) {
        Object.keys(behaviorIdx.appOpenCount).forEach(a => activeAppsSet.add(a));
        sourceFiles.push({
            kind: 'behavior_index',
            path: `memory/indexes/behavior/${dayKey}.index.json`,
            dayKey,
        });
    }

    const totalDwellMs = behaviorIdx
        ? Object.values(behaviorIdx.totalDwellMsByApp || {}).reduce((s, v) => s + v, 0)
        : 0;

    const stats: L3SummaryStats = {
        l2SessionParts: sessions.length,
        messageEvents,
        toolEvents,
        userActions,
        usageEvents: behaviorIdx?.totalEvents ?? 0,
        activeApps: [...activeAppsSet],
        totalDwellMs,
    };

    // ── Two-phase LLM generation (mandatory) ───────────────────────────────
    // Phase 1: summarize each session individually (no message truncation)
    // Phase 2: build daily summary from session summaries + behavior data
    // If LLM fails, we abort — no rule-based fallback; compensation will retry.
    let highlights: string[];
    let dynamicLayer: L3DynamicLayerSnapshot;
    let coreProposalDrafts: L3CoreProposalDraft[];

    try {
        console.warn(`[L3][daily] ${dayKey}: starting LLM generation (${sessions.length} sessions)`);
        // Phase 1: per-session summaries (parallel)
        const sessionSummaries = await Promise.all(
            sessions.map(async session => {
                const msgCount = session.stats.userMessages + session.stats.assistantMessages;
                if (msgCount === 0 && (session.agentActions ?? []).length === 0) {
                    return { session, summary: null };
                }
                try {
                    const allMsgs = session.segments.flatMap(s => s.messages ?? []);
                    const totalChars = allMsgs.reduce((n, m) => n + m.text.length, 0);
                    let summary: LLMSessionSummaryOutput | null;
                    const charName = input.llmConfig!.charName ?? 'AI';
                    const userName = input.llmConfig!.userName ?? '用户';
                    if (totalChars > SESSION_PROMPT_MAX_CHARS) {
                        summary = await summarizeSessionInChunks(session, input.llmConfig!.callLLM, charName, userName);
                    } else {
                        const raw = await input.llmConfig!.callLLM(LLM_SESSION_SYSTEM(charName, userName), buildSessionPrompt(session));
                        summary = tryParseSessionSummary(raw);
                    }
                    return { session, summary };
                } catch {
                    return { session, summary: null };
                }
            }),
        );

        // Phase 2: daily summary from session summaries + file/app context
        const [fileActivityLines, appLifecycleLines] = await Promise.all([
            readFileActivityLines(rootPath, allowGlobal, dayKey),
            readAppLifecycleLines(rootPath, allowGlobal, dayKey),
        ]);
        const dailyPrompt = buildDailyPromptFromSessionSummaries(
            sessionSummaries, behaviorIdx, dayKey, fileActivityLines, appLifecycleLines,
        );
        const raw = await input.llmConfig.callLLM(
            LLM_MEMORY_DAILY_SYSTEM(input.llmConfig.charName ?? 'AI', input.llmConfig.userName ?? '用户'),
            dailyPrompt,
        );
        const llmOut = tryParseLLMOutput(raw);
        if (!llmOut) {
            console.warn(`[L3][daily] ${dayKey}: LLM returned unparseable output — aborting (will retry)`);
            return null;
        }
        console.warn(`[L3][daily] ${dayKey}: LLM generation succeeded`);

        highlights = llmOut.highlights.length > 0
            ? llmOut.highlights
            : buildHighlights(sessions);   // keep rule-based highlights only if LLM returned none
        dynamicLayer = llmOut.dynamicLayer
            ? {
                currentState: (llmOut.dynamicLayer.currentState ?? []).slice(0, 3),
                purposeContext: (llmOut.dynamicLayer.purposeContext ?? []).slice(0, 3),
                onTheHorizon: (llmOut.dynamicLayer.onTheHorizon ?? []).slice(0, 3),
                others: (llmOut.dynamicLayer.others ?? []).slice(0, 3),
            }
            : buildDynamicLayer(sessions, behaviorIdx);
        if (Array.isArray(llmOut.coreProposalDrafts) && llmOut.coreProposalDrafts.length > 0) {
            const draftNow = Date.now();
            coreProposalDrafts = llmOut.coreProposalDrafts.map((p, i) => ({
                id: `draft-llm-${draftNow}-${i}`,
                category: p.category,
                proposal: p.proposal.substring(0, 150),
                reason: p.reason,
                confidence: Math.min(0.9, Math.max(0.4, p.confidence ?? 0.6)),
                status: 'pending' as const,
            }));
        } else {
            coreProposalDrafts = buildProposalDrafts(sessions, dayKey);
        }
    } catch (e) {
        console.warn(`[L3][daily] ${dayKey}: LLM failed — aborting (will retry via compensation)`, e);
        return null;
    }

    const searchIndex = buildSearchIndex(sessions, behaviorIdx);

    const summary: L3DailySummary = {
        version: 1,
        level: 'daily',
        dayKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        range: {
            startedAt: isFinite(startTs) ? startTs : Date.now(),
            endedAt: endTs > 0 ? endTs : Date.now(),
        },
        stats,
        highlights,
        dynamicLayer,
        coreProposalDrafts,
        searchIndex,
        sourceFiles,
    };

    await writeJsonSafe(rootPath, summaryPath, allowGlobal, summary);
    await updateL3Catalog(rootPath, allowGlobal, 'daily', dayKey, summaryPath, summary.createdAt);
    await updateKeywordIndex(rootPath, allowGlobal, dayKey, summary.searchIndex.keywords);

    return summary;
};

// ── Generate weekly summary ───────────────────────────────────────────────────

export interface GenerateL3WeeklyInput {
    rootPath: string;
    allowGlobal: boolean;
    weekKey: WeekKey;
    force?: boolean;
    /** Optional: use LLM (strong model) to override rule-based weekly output */
    llmConfig?: LLMSummaryCallConfig;
}

export const generateL3Weekly = async (
    input: GenerateL3WeeklyInput,
): Promise<L3WeeklySummary | null> => {
    const { rootPath, allowGlobal, weekKey, force = false } = input;

    if (!input.llmConfig) {
        console.warn(`[L3][weekly] skip ${weekKey}: no LLM config`);
        return null;
    }

    const [yearStr, weekStr] = weekKey.split('-W');
    const summaryPath = `memory/summaries/weekly/${yearStr}/${weekKey}.weekly.json`;

    if (!force) {
        const existing = await readJsonSafe<L3WeeklySummary | null>(
            rootPath, summaryPath, allowGlobal, null,
        );
        if (existing?.version) return existing;
    }

    const dayKeys = getDaysForISOWeek(parseInt(yearStr), parseInt(weekStr));
    const dailySummaries: L3DailySummary[] = [];
    const sourceDailyFiles: string[] = [];

    for (const dayKey of dayKeys) {
        const dp = `memory/summaries/daily/${dayFolder(dayKey)}.daily.json`;
        const daily = await readJsonSafe<L3DailySummary | null>(rootPath, dp, allowGlobal, null);
        if (daily) {
            dailySummaries.push(daily);
            sourceDailyFiles.push(dp);
        }
    }

    if (dailySummaries.length === 0) return null;

    // Find repeated keywords as trend signals
    const allKeywords = dailySummaries.flatMap(d => d.searchIndex.keywords);
    const kwFreq = new Map<string, number>();
    for (const kw of allKeywords) kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
    const trendNotes: string[] = [];
    const repeatedTopics = [...kwFreq.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, c]) => `${k}(${c}天)`);
    if (repeatedTopics.length > 0) {
        trendNotes.push(`本周重复主题: ${repeatedTopics.join(', ')}`);
    }

    // App usage pattern
    const appFreq = new Map<string, number>();
    for (const d of dailySummaries) {
        for (const app of d.stats.activeApps) {
            appFreq.set(app, (appFreq.get(app) || 0) + 1);
        }
    }
    const topApps = [...appFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topApps.length > 0) {
        trendNotes.push(`本周常用App: ${topApps.map(([a, c]) => `${a}(${c}天)`).join(', ')}`);
    }

    // Merge dynamic layers (deduplicate)
    const mergedDynamic: L3DynamicLayerSnapshot = {
        currentState: [...new Set(dailySummaries.flatMap(d => d.dynamicLayer.currentState))].slice(0, 3),
        purposeContext: [...new Set(dailySummaries.flatMap(d => d.dynamicLayer.purposeContext))].slice(0, 3),
        onTheHorizon: [...new Set(dailySummaries.flatMap(d => d.dynamicLayer.onTheHorizon))].slice(0, 3),
        others: [...new Set(dailySummaries.flatMap(d => d.dynamicLayer.others))].slice(0, 3),
    };

    // Elevate higher-confidence proposals
    const weeklyProposals = dailySummaries
        .flatMap(d => d.coreProposalDrafts)
        .filter(p => (p.confidence ?? 0) >= 0.35)
        .map(p => ({ ...p, confidence: Math.min(0.7, (p.confidence ?? 0.35) + 0.1) }))
        .slice(0, 6);

    let highlights = dailySummaries.flatMap(d => d.highlights);
    let finalTrendNotes = trendNotes;
    let finalDynamic = mergedDynamic;
    let finalProposals = weeklyProposals;

    // ── Mandatory LLM override ──────────────────────────────────────────────
    const callStrong = input.llmConfig.callLLMStrong ?? input.llmConfig.callLLM;
    try {
        console.warn(`[L3][weekly] ${weekKey}: starting LLM generation`);
        const userPrompt = compileWeeklyInput(dailySummaries, weekKey);
        const raw = await callStrong(
            LLM_MEMORY_WEEKLY_SYSTEM(input.llmConfig.charName ?? 'AI', input.llmConfig.userName ?? '用户'),
            userPrompt,
        );
        const llmOut = tryParseLLMOutput(raw);
        if (llmOut) {
            console.warn(`[L3][weekly] ${weekKey}: LLM generation succeeded`);
            if (llmOut.highlights.length > 0) highlights = llmOut.highlights;
            if (Array.isArray(llmOut.trendNotes) && llmOut.trendNotes.length > 0)
                finalTrendNotes = llmOut.trendNotes.slice(0, 4);
            else finalTrendNotes = [];
            if (llmOut.dynamicLayer) {
                finalDynamic = {
                    currentState: (llmOut.dynamicLayer.currentState ?? []).slice(0, 3),
                    purposeContext: (llmOut.dynamicLayer.purposeContext ?? []).slice(0, 3),
                    onTheHorizon: (llmOut.dynamicLayer.onTheHorizon ?? []).slice(0, 3),
                    others: (llmOut.dynamicLayer.others ?? []).slice(0, 3),
                };
            }
            if (Array.isArray(llmOut.coreProposalDrafts) && llmOut.coreProposalDrafts.length > 0) {
                const draftNow = Date.now();
                finalProposals = llmOut.coreProposalDrafts.map((p, i) => ({
                    id: `draft-llm-${draftNow}-${i}`,
                    category: p.category,
                    proposal: p.proposal.substring(0, 150),
                    reason: p.reason,
                    confidence: Math.min(0.7, Math.max(0.3, p.confidence ?? 0.5)),
                    status: 'pending' as const,
                }));
            }
        } else {
            console.warn(`[L3][weekly] ${weekKey}: LLM returned unparseable output — aborting`);
            return null;
        }
    } catch (e) {
        console.warn(`[L3][weekly] ${weekKey}: LLM failed — aborting (will retry)`, e);
        return null;
    }

    const now = Date.now();
    const startTs = Math.min(...dailySummaries.map(d => d.range.startedAt));
    const endTs = Math.max(...dailySummaries.map(d => d.range.endedAt));

    const weekly: L3WeeklySummary = {
        version: 1,
        level: 'weekly',
        weekKey,
        createdAt: now,
        updatedAt: now,
        range: { startedAt: startTs, endedAt: endTs },
        sourceDays: dayKeys.filter(dk => dailySummaries.some(d => d.dayKey === dk)),
        sourceDailyFiles,
        highlights: highlights.slice(0, 10),
        trendNotes: finalTrendNotes,
        dynamicLayer: finalDynamic,
        coreProposalDrafts: finalProposals,
        searchIndex: {
            keywords: pickTopKeywords(highlights),
            refs: dailySummaries.flatMap(d => d.searchIndex.refs).slice(0, 30),
        },
    };

    await writeJsonSafe(rootPath, summaryPath, allowGlobal, weekly);
    await updateL3Catalog(rootPath, allowGlobal, 'weekly', weekKey, summaryPath, now);

    return weekly;
};

// ── Generate monthly summary ──────────────────────────────────────────────────

export interface GenerateL3MonthlyInput {
    rootPath: string;
    allowGlobal: boolean;
    monthKey: MonthKey;
    force?: boolean;
    /** Optional: use LLM (strong model) to override rule-based monthly output */
    llmConfig?: LLMSummaryCallConfig;
}

export const generateL3Monthly = async (
    input: GenerateL3MonthlyInput,
): Promise<L3MonthlySummary | null> => {
    const { rootPath, allowGlobal, monthKey, force = false } = input;

    if (!input.llmConfig) {
        console.warn(`[L3][monthly] skip ${monthKey}: no LLM config`);
        return null;
    }

    const [year, month] = monthKey.split('-');
    const summaryPath = `memory/summaries/monthly/${year}/${monthKey}.monthly.json`;

    if (!force) {
        const existing = await readJsonSafe<L3MonthlySummary | null>(
            rootPath, summaryPath, allowGlobal, null,
        );
        if (existing?.version) return existing;
    }

    // Collect all days in this month
    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
    const allDayKeys: DayKey[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDayKeys.push(`${monthKey}-${pad(d)}`);
    }

    const dailySummaries: L3DailySummary[] = [];
    for (const dayKey of allDayKeys) {
        const dp = `memory/summaries/daily/${dayFolder(dayKey)}.daily.json`;
        const daily = await readJsonSafe<L3DailySummary | null>(rootPath, dp, allowGlobal, null);
        if (daily) dailySummaries.push(daily);
    }

    // Collect weekly summaries for this month
    const weekKeys = [...new Set(allDayKeys.map(dk => toISOWeekKey(dk)))];
    const weeklySummaries: L3WeeklySummary[] = [];
    const sourceWeeklyFiles: string[] = [];
    for (const weekKey of weekKeys) {
        const [wYear] = weekKey.split('-W');
        const wp = `memory/summaries/weekly/${wYear}/${weekKey}.weekly.json`;
        const weekly = await readJsonSafe<L3WeeklySummary | null>(rootPath, wp, allowGlobal, null);
        if (weekly) {
            weeklySummaries.push(weekly);
            sourceWeeklyFiles.push(wp);
        }
    }

    if (dailySummaries.length === 0 && weeklySummaries.length === 0) return null;

    // Find stable patterns (keywords appearing >= 3 days)
    const kwFreq = new Map<string, number>();
    for (const kw of dailySummaries.flatMap(d => d.searchIndex.keywords)) {
        kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
    }
    const stablePatterns: string[] = [];
    const stableTopics = [...kwFreq.entries()]
        .filter(([, c]) => c >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, c]) => `${k}(${c}天)`);
    if (stableTopics.length > 0) {
        stablePatterns.push(`本月稳定主题: ${stableTopics.join(', ')}`);
    }

    // App usage stable patterns
    const appFreq = new Map<string, number>();
    for (const d of dailySummaries) {
        for (const app of d.stats.activeApps) {
            appFreq.set(app, (appFreq.get(app) || 0) + 1);
        }
    }
    const stableApps = [...appFreq.entries()]
        .filter(([, c]) => c >= Math.ceil(dailySummaries.length * 0.4))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([a, c]) => `${a}(${c}天)`);
    if (stableApps.length > 0) {
        stablePatterns.push(`本月常用App: ${stableApps.join(', ')}`);
    }

    const allSources = [...weeklySummaries, ...dailySummaries];
    const mergedDynamic: L3DynamicLayerSnapshot = {
        currentState: [...new Set(allSources.flatMap(s => s.dynamicLayer.currentState))].slice(0, 3),
        purposeContext: [...new Set(allSources.flatMap(s => s.dynamicLayer.purposeContext))].slice(0, 3),
        onTheHorizon: [...new Set(allSources.flatMap(s => s.dynamicLayer.onTheHorizon))].slice(0, 3),
        others: [...new Set(allSources.flatMap(s => s.dynamicLayer.others))].slice(0, 3),
    };

    // Elevate highest-confidence proposals to monthly level
    const monthlyProposals = allSources
        .flatMap(s => s.coreProposalDrafts)
        .filter(p => (p.confidence ?? 0) >= 0.45)
        .map(p => ({ ...p, confidence: Math.min(0.85, (p.confidence ?? 0.45) + 0.15) }))
        .reduce((acc: L3CoreProposalDraft[], p) => {
            const dup = acc.find(x => x.proposal.substring(0, 40) === p.proposal.substring(0, 40));
            if (!dup) acc.push(p);
            return acc;
        }, [])
        .slice(0, 8);

    const now = Date.now();
    const allRanges = allSources.map(s => s.range);
    const startTs = Math.min(...allRanges.map(r => r.startedAt));
    const endTs = Math.max(...allRanges.map(r => r.endedAt));
    let allHighlights = [...weeklySummaries.flatMap(w => w.highlights), ...dailySummaries.flatMap(d => d.highlights)];
    let finalStablePatterns = stablePatterns;
    let finalMonthlyDynamic = mergedDynamic;
    let finalMonthlyProposals = monthlyProposals;

    // ── Mandatory LLM override ──────────────────────────────────────────────
    const callStrong = input.llmConfig.callLLMStrong ?? input.llmConfig.callLLM;
    try {
        console.warn(`[L3][monthly] ${monthKey}: starting LLM generation`);
        const userPrompt = compileMonthlyInput(weeklySummaries, dailySummaries, monthKey);
        const raw = await callStrong(
            LLM_MEMORY_MONTHLY_SYSTEM(input.llmConfig.charName ?? 'AI', input.llmConfig.userName ?? '用户'),
            userPrompt,
        );
        const llmOut = tryParseLLMOutput(raw);
        if (llmOut) {
            console.warn(`[L3][monthly] ${monthKey}: LLM generation succeeded`);
            if (llmOut.highlights.length > 0) allHighlights = llmOut.highlights;
            if (Array.isArray(llmOut.stablePatterns) && llmOut.stablePatterns.length > 0)
                finalStablePatterns = llmOut.stablePatterns.slice(0, 5);
            else finalStablePatterns = [];
            if (llmOut.dynamicLayer) {
                finalMonthlyDynamic = {
                    currentState: (llmOut.dynamicLayer.currentState ?? []).slice(0, 3),
                    purposeContext: (llmOut.dynamicLayer.purposeContext ?? []).slice(0, 3),
                    onTheHorizon: (llmOut.dynamicLayer.onTheHorizon ?? []).slice(0, 3),
                    others: (llmOut.dynamicLayer.others ?? []).slice(0, 3),
                };
            }
            if (Array.isArray(llmOut.coreProposalDrafts) && llmOut.coreProposalDrafts.length > 0) {
                const draftNow = Date.now();
                finalMonthlyProposals = llmOut.coreProposalDrafts.map((p, i) => ({
                    id: `draft-llm-${draftNow}-${i}`,
                    category: p.category,
                    proposal: p.proposal.substring(0, 150),
                    reason: p.reason,
                    confidence: Math.min(0.85, Math.max(0.3, p.confidence ?? 0.6)),
                    status: 'pending' as const,
                }));
            }
        } else {
            console.warn(`[L3][monthly] ${monthKey}: LLM returned unparseable output — aborting`);
            return null;
        }
    } catch (e) {
        console.warn(`[L3][monthly] ${monthKey}: LLM failed — aborting (will retry)`, e);
        return null;
    }

    const monthly: L3MonthlySummary = {
        version: 1,
        level: 'monthly',
        monthKey,
        createdAt: now,
        updatedAt: now,
        range: {
            startedAt: isFinite(startTs) ? startTs : now,
            endedAt: isFinite(endTs) ? endTs : now,
        },
        sourceDays: dailySummaries.map(d => d.dayKey),
        sourceWeeks: weeklySummaries.map(w => w.weekKey),
        sourceWeeklyFiles,
        highlights: allHighlights.slice(0, 12),
        stablePatterns: finalStablePatterns,
        dynamicLayer: finalMonthlyDynamic,
        coreProposalDrafts: finalMonthlyProposals,
        searchIndex: {
            keywords: pickTopKeywords(allHighlights, 15),
            refs: allSources.flatMap(s => s.searchIndex.refs).slice(0, 40),
        },
    };

    await writeJsonSafe(rootPath, summaryPath, allowGlobal, monthly);
    await updateL3Catalog(rootPath, allowGlobal, 'monthly', monthKey, summaryPath, now);

    return monthly;
};

// ── Yearly summary ────────────────────────────────────────────────────────────

interface LLMYearlySummaryOutput {
    highlights: string[];
    milestones: string[];
    stablePatterns: string[];
    relationshipNotes: string[];
    dynamicLayer: {
        currentState: string[];
        purposeContext: string[];
        onTheHorizon: string[];
        others: string[];
    };
    coreProposalDrafts: Array<{ category: string; proposal: string; reason: string; confidence: number }>;
}

const tryParseYearlyOutput = (raw: string): LLMYearlySummaryOutput | null => {
    try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(clean) as LLMYearlySummaryOutput;
        if (!Array.isArray(parsed.highlights)) return null;
        return parsed;
    } catch { return null; }
};

const compileYearlyInput = (monthlySummaries: L3MonthlySummary[], yearKey: YearKey): string => {
    const parts: string[] = [`=== 年报: ${yearKey} (${monthlySummaries.length} 个月有数据) ===`];
    for (const m of monthlySummaries) {
        parts.push(`\n--- ${m.monthKey} ---`);
        m.highlights.slice(0, 4).forEach(h => parts.push(`· ${h}`));
        if (m.stablePatterns.length > 0)
            parts.push(`  稳定规律: ${m.stablePatterns.slice(0, 2).join(' / ')}`);
        const pc = m.dynamicLayer.purposeContext.filter(Boolean);
        if (pc.length > 0) parts.push(`  目标: ${pc.join(' / ')}`);
    }
    return parts.join('\n');
};

export interface GenerateL3YearlyInput {
    rootPath: string;
    allowGlobal: boolean;
    yearKey: YearKey;
    llmConfig?: LLMSummaryCallConfig;
}

export const generateL3Yearly = async (input: GenerateL3YearlyInput): Promise<L3YearlySummary | null> => {
    const { rootPath, allowGlobal, yearKey, llmConfig } = input;

    if (!llmConfig) {
        console.warn(`[L3][yearly] skip ${yearKey}: no LLM config`);
        return null;
    }

    const summaryPath = `memory/summaries/yearly/${yearKey}.yearly.json`;
    const now = Date.now();

    // Read all monthly summaries for this year
    const catalog = await readL3Catalog(rootPath, allowGlobal);
    const monthlyEntries = catalog.monthly.filter(e => e.key.startsWith(yearKey + '-'));
    if (monthlyEntries.length === 0) return null;

    const monthlySummaries: L3MonthlySummary[] = [];
    for (const entry of monthlyEntries.sort((a, b) => a.key.localeCompare(b.key))) {
        const m = await readJsonSafe<L3MonthlySummary | null>(rootPath, entry.file, allowGlobal, null);
        if (m) monthlySummaries.push(m);
    }
    if (monthlySummaries.length === 0) return null;

    const allHighlights = monthlySummaries.flatMap(m => m.highlights);
    const allStablePatterns = [...new Set(monthlySummaries.flatMap(m => m.stablePatterns))];
    const allProposals: L3CoreProposalDraft[] = monthlySummaries
        .flatMap(m => m.coreProposalDrafts)
        .filter(p => (p.confidence ?? 0) >= 0.5)
        .slice(0, 8);

    const startTs = monthlySummaries[0].range.startedAt;
    const endTs = monthlySummaries[monthlySummaries.length - 1].range.endedAt;

    let finalHighlights = allHighlights.slice(0, 20);
    let finalMilestones: string[] = [];
    let finalStablePatterns = allStablePatterns.slice(0, 6);
    let finalRelationshipNotes: string[] = [];
    let finalDynamic = monthlySummaries[monthlySummaries.length - 1].dynamicLayer;
    let finalProposals = allProposals;

    const callStrong = llmConfig.callLLMStrong ?? llmConfig.callLLM;
    try {
        console.warn(`[L3][yearly] ${yearKey}: starting LLM generation`);
        const userPrompt = compileYearlyInput(monthlySummaries, yearKey);
        const raw = await callStrong(
            LLM_MEMORY_YEARLY_SYSTEM(llmConfig.charName ?? 'AI', llmConfig.userName ?? '用户'),
            userPrompt,
        );
        const llmOut = tryParseYearlyOutput(raw);
        if (llmOut) {
            console.warn(`[L3][yearly] ${yearKey}: LLM generation succeeded`);
            if (llmOut.highlights.length > 0) finalHighlights = llmOut.highlights;
            if (Array.isArray(llmOut.milestones)) finalMilestones = llmOut.milestones;
            if (Array.isArray(llmOut.stablePatterns) && llmOut.stablePatterns.length > 0)
                finalStablePatterns = llmOut.stablePatterns;
            if (Array.isArray(llmOut.relationshipNotes)) finalRelationshipNotes = llmOut.relationshipNotes;
            if (llmOut.dynamicLayer) {
                finalDynamic = {
                    currentState: (llmOut.dynamicLayer.currentState ?? []).slice(0, 3),
                    purposeContext: (llmOut.dynamicLayer.purposeContext ?? []).slice(0, 3),
                    onTheHorizon: (llmOut.dynamicLayer.onTheHorizon ?? []).slice(0, 3),
                    others: (llmOut.dynamicLayer.others ?? []).slice(0, 3),
                };
            }
            if (Array.isArray(llmOut.coreProposalDrafts) && llmOut.coreProposalDrafts.length > 0) {
                const draftNow = Date.now();
                finalProposals = llmOut.coreProposalDrafts.map((p, i) => ({
                    id: `draft-yearly-${draftNow}-${i}`,
                    category: p.category as CoreProposalCategory,
                    proposal: p.proposal.substring(0, 200),
                    reason: p.reason,
                    confidence: Math.min(0.9, Math.max(0.4, p.confidence ?? 0.7)),
                    status: 'pending' as const,
                }));
            }
        } else {
            console.warn(`[L3][yearly] ${yearKey}: LLM returned unparseable output — aborting`);
            return null;
        }
    } catch (e) {
        console.warn(`[L3][yearly] ${yearKey}: LLM failed — aborting (will retry)`, e);
        return null;
    }

    const yearly: L3YearlySummary = {
        version: 1,
        level: 'yearly',
        yearKey,
        createdAt: now,
        updatedAt: now,
        range: { startedAt: startTs, endedAt: endTs },
        sourceMonths: monthlySummaries.map(m => m.monthKey),
        sourceMonthlyFiles: monthlyEntries.map(e => e.file),
        highlights: finalHighlights,
        milestones: finalMilestones,
        stablePatterns: finalStablePatterns,
        relationshipNotes: finalRelationshipNotes,
        dynamicLayer: finalDynamic,
        coreProposalDrafts: finalProposals,
        searchIndex: {
            keywords: pickTopKeywords(allHighlights, 20),
            refs: [],
        },
    };

    await writeJsonSafe(rootPath, summaryPath, allowGlobal, yearly);
    await updateL3Catalog(rootPath, allowGlobal, 'yearly', yearKey, summaryPath, now);
    return yearly;
};

// ── Catalog helpers ───────────────────────────────────────────────────────────

const CATALOG_PATH = 'memory/summaries/indexes/catalog.json';

const EMPTY_CATALOG: L3SummaryCatalog = {
    version: 1,
    updatedAt: 0,
    daily: [],
    weekly: [],
    monthly: [],
    yearly: [],
};

export const readL3Catalog = async (
    rootPath: string,
    allowGlobal: boolean,
): Promise<L3SummaryCatalog> =>
    readJsonSafe<L3SummaryCatalog>(rootPath, CATALOG_PATH, allowGlobal, { ...EMPTY_CATALOG });

export const updateL3Catalog = async (
    rootPath: string,
    allowGlobal: boolean,
    level: MemorySummaryLevel,
    key: string,
    file: string,
    createdAt: number,
): Promise<void> => {
    const catalog = await readL3Catalog(rootPath, allowGlobal);
    const arr = catalog[level] as L3CatalogItem[];
    const idx = arr.findIndex(item => item.key === key);
    const entry: L3CatalogItem = { key, file, level, createdAt, updatedAt: Date.now() };
    if (idx >= 0) arr[idx] = entry;
    else arr.push(entry);
    arr.sort((a, b) => b.key.localeCompare(a.key));
    catalog.updatedAt = Date.now();
    await writeJsonSafe(rootPath, CATALOG_PATH, allowGlobal, catalog);
};

// ── Keyword index ─────────────────────────────────────────────────────────────

const KEYWORD_INDEX_PATH = 'memory/summaries/indexes/keyword_index.json';

const EMPTY_KEYWORD_INDEX: L3KeywordIndex = {
    version: 1,
    updatedAt: 0,
    index: {},
};

/**
 * Reads the inverted keyword index from disk.
 * Returns an empty index on any read/parse failure.
 */
export const readKeywordIndex = async (
    rootPath: string,
    allowGlobal: boolean,
): Promise<L3KeywordIndex> =>
    readJsonSafe<L3KeywordIndex>(
        rootPath, KEYWORD_INDEX_PATH, allowGlobal, { ...EMPTY_KEYWORD_INDEX, index: {} },
    );

/**
 * Upserts `dayKey` into every keyword's entry list.
 * Called automatically by `generateL3Daily` after writing a daily summary.
 *
 * Each keyword maps to a list of dayKeys sorted newest-first.
 * If `dayKey` is already present for a keyword it is not duplicated.
 */
export const updateKeywordIndex = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: string,
    keywords: string[],
): Promise<void> => {
    if (!rootPath || !dayKey || keywords.length === 0) return;
    try {
        const idx = await readKeywordIndex(rootPath, allowGlobal);
        for (const kw of keywords) {
            if (!kw) continue;
            const list = idx.index[kw] ?? [];
            if (!list.includes(dayKey)) {
                list.push(dayKey);
                list.sort((a, b) => b.localeCompare(a)); // newest first
            }
            idx.index[kw] = list;
        }
        idx.updatedAt = Date.now();
        await writeJsonSafe(rootPath, KEYWORD_INDEX_PATH, allowGlobal, idx);
    } catch {
        // Non-critical: search will fall back to full catalog scan
    }
};

/**
 * Given a set of query tokens, returns the set of dayKeys that appear in the
 * keyword index for at least one token.  Returns `null` when the index is
 * empty or unreadable (caller falls back to full catalog scan).
 */
const lookupKeywordIndex = async (
    rootPath: string,
    allowGlobal: boolean,
    queryTokens: Set<string>,
): Promise<Set<string> | null> => {
    try {
        const idx = await readKeywordIndex(rootPath, allowGlobal);
        if (Object.keys(idx.index).length === 0) return null;
        const candidates = new Set<string>();
        for (const token of queryTokens) {
            const days = idx.index[token];
            if (days) days.forEach(d => candidates.add(d));
        }
        return candidates;
    } catch {
        return null;
    }
};

// ── Compensation check ────────────────────────────────────────────────────────

export interface RunL3CompensationInput {
    rootPath: string;
    allowGlobal: boolean;
    /** How many past days to check (default: 7) */
    maxDaysBack?: number;
    /** Optional LLM config for daily/compensation generation */
    llmConfig?: LLMSummaryCallConfig;
    /** Optional strong LLM config for weekly/monthly */
    llmConfigStrong?: LLMSummaryCallConfig;
}

/** One-retry wrapper — logs the dayKey/type on second failure */
const withRetry = async <T>(
    label: string,
    fn: () => Promise<T>,
): Promise<T | null> => {
    try {
        return await fn();
    } catch {
        try {
            return await fn();
        } catch (e2) {
            console.warn(`[L3] ${label} failed after retry:`, e2);
            return null;
        }
    }
};

/**
 * Checks the last N days for missing daily summaries and generates them.
 * Also backfills any missing weekly (past 4 weeks) and monthly (past 3 months) summaries.
 * Should be called on app startup.
 */
export const runL3Compensation = async (input: RunL3CompensationInput): Promise<void> => {
    const { rootPath, allowGlobal, maxDaysBack = 7, llmConfig, llmConfigStrong } = input;
    if (!rootPath) return;

    if (!llmConfig) {
        console.warn('[L3][compensation] skip: no LLM config — summaries require LLM');
        return;
    }

    const todayTs = Date.now();

    // ── Daily compensation ────────────────────────────────────────────────────
    for (let i = 1; i <= maxDaysBack; i++) {
        const ts = todayTs - i * 86400000;
        const dayKey = toDayKey(ts);
        const summaryPath = `memory/summaries/daily/${dayFolder(dayKey)}.daily.json`;
        const existing = await readJsonSafe<L3DailySummary | null>(
            rootPath, summaryPath, allowGlobal, null,
        );
        if (!existing) {
            await withRetry(`daily ${dayKey}`, () =>
                generateL3Daily({ rootPath, allowGlobal, dayKey, llmConfig }),
            );
        }
    }

    // ── Weekly compensation (past 4 completed weeks) ──────────────────────────
    const seenWeeks = new Set<string>();
    for (let i = 7; i <= 4 * 7; i++) {
        const ts = todayTs - i * 86400000;
        const dayKey = toDayKey(ts);
        const weekKey = toISOWeekKey(dayKey);
        if (seenWeeks.has(weekKey)) continue;
        seenWeeks.add(weekKey);
        const weekPath = `memory/summaries/weekly/${weekKey.substring(0, 4)}/${weekKey}.weekly.json`;
        const existing = await readJsonSafe<L3WeeklySummary | null>(
            rootPath, weekPath, allowGlobal, null,
        );
        if (!existing) {
            await withRetry(`weekly ${weekKey}`, () =>
                generateL3Weekly({ rootPath, allowGlobal, weekKey, llmConfig: llmConfigStrong ?? llmConfig }),
            );
        }
    }

    // ── Monthly compensation (past 3 completed months) ────────────────────────
    const seenMonths = new Set<string>();
    for (let i = 28; i <= 3 * 31; i += 7) {
        const ts = todayTs - i * 86400000;
        const dayKey = toDayKey(ts);
        const monthKey = toMonthKey(dayKey);
        if (monthKey === toMonthKey(toDayKey(todayTs))) continue;
        if (seenMonths.has(monthKey)) continue;
        seenMonths.add(monthKey);
        const monthPath = `memory/summaries/monthly/${monthKey.substring(0, 4)}/${monthKey}.monthly.json`;
        const existing = await readJsonSafe<L3MonthlySummary | null>(
            rootPath, monthPath, allowGlobal, null,
        );
        if (!existing) {
            await withRetry(`monthly ${monthKey}`, () =>
                generateL3Monthly({ rootPath, allowGlobal, monthKey, llmConfig: llmConfigStrong ?? llmConfig }),
            );
        }
    }

    // ── Yearly compensation (past 2 completed years) ──────────────────────────
    const currentYear = new Date(todayTs).getFullYear();
    for (const yearOffset of [1, 2]) {
        const yearKey = String(currentYear - yearOffset);
        const yearPath = `memory/summaries/yearly/${yearKey}.yearly.json`;
        const existing = await readJsonSafe<L3YearlySummary | null>(rootPath, yearPath, allowGlobal, null);
        if (!existing) {
            await withRetry(`yearly ${yearKey}`, () =>
                generateL3Yearly({ rootPath, allowGlobal, yearKey, llmConfig: llmConfigStrong ?? llmConfig }),
            );
        }
    }
};

/**
 * Runs the full L3 daily generation for yesterday (typical nightly trigger).
 * Also triggers weekly/monthly if the current day is the right boundary.
 */
export const runL3DailyPipeline = async (
    rootPath: string,
    allowGlobal: boolean,
    llmConfig?: LLMSummaryCallConfig,
    llmConfigStrong?: LLMSummaryCallConfig,
): Promise<void> => {
    if (!rootPath) return;

    if (!llmConfig) {
        console.warn('[L3][pipeline] skip daily pipeline: no LLM config — summaries require LLM');
        return;
    }

    const yesterdayTs = Date.now() - 86400000;
    const yesterday = toDayKey(yesterdayTs);

    await withRetry(`daily ${yesterday}`, () =>
        generateL3Daily({ rootPath, allowGlobal, dayKey: yesterday, llmConfig }),
    );

    // On Monday, generate last week's weekly summary
    const today = new Date();
    if (today.getDay() === 1) {
        const lastWeekTs = Date.now() - 7 * 86400000;
        const lastWeekKey = toISOWeekKey(toDayKey(lastWeekTs));
        await withRetry(`weekly ${lastWeekKey}`, () =>
            generateL3Weekly({ rootPath, allowGlobal, weekKey: lastWeekKey, llmConfig: llmConfigStrong ?? llmConfig }),
        );
    }

    // On the 1st of the month, generate last month's monthly summary
    if (today.getDate() === 1) {
        const lastMonthTs = Date.now() - 2 * 86400000;
        const lastMonthKey = toMonthKey(toDayKey(lastMonthTs));
        await withRetry(`monthly ${lastMonthKey}`, () =>
            generateL3Monthly({ rootPath, allowGlobal, monthKey: lastMonthKey, llmConfig: llmConfigStrong ?? llmConfig }),
        );
    }

    // On Jan 1st, generate last year's yearly summary
    if (today.getMonth() === 0 && today.getDate() === 1) {
        const lastYearKey = String(today.getFullYear() - 1);
        await withRetry(`yearly ${lastYearKey}`, () =>
            generateL3Yearly({ rootPath, allowGlobal, yearKey: lastYearKey, llmConfig: llmConfigStrong ?? llmConfig }),
        );
    }
};

// ── Context blurb builder ─────────────────────────────────────────────────────

/**
 * Reads today + yesterday daily summaries, the latest weekly summary, and the
 * latest monthly summary from disk, then builds a compact markdown text block
 * suitable for injection into the LLM system prompt (L3 摘要检索层).
 *
 * Design spec (§九, §十七): inject "今日/昨日 summary + 最近 weekly/monthly summary"
 * as the fourth layer before L2 on-demand recall.
 */
export const buildL3ContextBlurb = async (
    rootPath: string,
    allowGlobal: boolean,
): Promise<string> => {
    if (!rootPath) return '';

    const now = Date.now();
    const todayKey = toDayKey(now);
    const yesterdayKey = toDayKey(now - 86400000);
    const dayBeforeKey = toDayKey(now - 2 * 86400000);

    const readDaily = (dk: DayKey) =>
        readJsonSafe<L3DailySummary | null>(
            rootPath,
            `memory/summaries/daily/${dayFolder(dk)}.daily.json`,
            allowGlobal,
            null,
        );

    const [today, yesterday, dayBefore] = await Promise.all([
        readDaily(todayKey),
        readDaily(yesterdayKey),
        readDaily(dayBeforeKey),
    ]);

    // Latest weekly/monthly/yearly from catalog
    const catalog = await readL3Catalog(rootPath, allowGlobal);
    const latestWeeklyEntry = catalog.weekly[0];
    const latestMonthlyEntry = catalog.monthly[0];
    const latestYearlyEntry = (catalog.yearly ?? [])[0];

    const [latestWeekly, latestMonthly, latestYearly] = await Promise.all([
        latestWeeklyEntry
            ? readJsonSafe<L3WeeklySummary | null>(rootPath, latestWeeklyEntry.file, allowGlobal, null)
            : Promise.resolve(null),
        latestMonthlyEntry
            ? readJsonSafe<L3MonthlySummary | null>(rootPath, latestMonthlyEntry.file, allowGlobal, null)
            : Promise.resolve(null),
        latestYearlyEntry
            ? readJsonSafe<L3YearlySummary | null>(rootPath, latestYearlyEntry.file, allowGlobal, null)
            : Promise.resolve(null),
    ]);

    if (!today && !yesterday && !dayBefore && !latestWeekly && !latestMonthly && !latestYearly) return '';

    const lines: string[] = ['### 近期摘要 (L3 Summary Layer)\n'];

    // Helper: format one daily entry
    const formatDaily = (summary: L3DailySummary, label: string) => {
        const parts: string[] = [`**${label} [${summary.dayKey}]**:`];
        if (summary.highlights.length > 0) {
            summary.highlights.slice(0, 4).forEach(h => parts.push(`- ${h}`));
        }
        const cs = summary.dynamicLayer.currentState.filter(Boolean);
        const pc = summary.dynamicLayer.purposeContext.filter(Boolean);
        if (cs.length > 0) parts.push(`- 状态: ${cs.join(' / ')}`);
        if (pc.length > 0) parts.push(`- 目标: ${pc.join(' / ')}`);
        return parts.join('\n');
    };

    if (today && today.highlights.length > 0) {
        lines.push(formatDaily(today, '今日（进行中）'));
    }
    if (yesterday) {
        lines.push(formatDaily(yesterday, '昨日'));
    } else if (dayBefore) {
        lines.push(formatDaily(dayBefore, '前日'));
    }

    if (latestWeekly && latestWeekly.highlights.length > 0) {
        const parts: string[] = [`**本周 [${latestWeekly.weekKey}]**:`];
        latestWeekly.highlights.slice(0, 3).forEach(h => parts.push(`- ${h}`));
        latestWeekly.trendNotes.slice(0, 2).forEach(t => parts.push(`- 📈 ${t}`));
        lines.push(parts.join('\n'));
    }

    if (latestMonthly && latestMonthly.stablePatterns.length > 0) {
        const parts: string[] = [`**本月稳定模式 [${latestMonthly.monthKey}]**:`];
        latestMonthly.stablePatterns.slice(0, 3).forEach(p => parts.push(`- ${p}`));
        lines.push(parts.join('\n'));
    }

    if (latestYearly && latestYearly.highlights.length > 0) {
        const parts: string[] = [`**${latestYearly.yearKey}年度记忆**:`];
        latestYearly.highlights.slice(0, 2).forEach(h => parts.push(`- ${h}`));
        latestYearly.milestones.slice(0, 2).forEach(m => parts.push(`- 里程碑: ${m}`));
        lines.push(parts.join('\n'));
    }

    return lines.join('\n\n');
};

// ── Draft → agent.coreProposals promotion ────────────────────────────────────

export interface PromoteL3DraftsResult {
    newProposals: CoreProposal[];
    dynamicMemories: DynamicMemory[];
}

/**
 * Reads the most recent daily summaries (today + yesterday) and promotes any
 * new L3CoreProposalDrafts to CoreProposal[], deduplicating against existing ones.
 * Also converts the latest dynamicLayer snapshot to DynamicMemory[].
 */
export const promoteL3Drafts = async (
    rootPath: string,
    allowGlobal: boolean,
    existingProposals: CoreProposal[],
): Promise<PromoteL3DraftsResult> => {
    if (!rootPath) return { newProposals: [], dynamicMemories: [] };

    const now = Date.now();
    const todayKey = toDayKey(now);
    const yesterdayKey = toDayKey(now - 86400000);

    const readDaily = (dk: DayKey) =>
        readJsonSafe<L3DailySummary | null>(
            rootPath,
            `memory/summaries/daily/${dayFolder(dk)}.daily.json`,
            allowGlobal,
            null,
        );

    const [today, yesterday, catalog] = await Promise.all([
        readDaily(todayKey),
        readDaily(yesterdayKey),
        readL3Catalog(rootPath, allowGlobal),
    ]);

    const [latestWeeklyDrafts, latestMonthlyDrafts] = await Promise.all([
        catalog.weekly[0]
            ? readJsonSafe<L3WeeklySummary | null>(rootPath, catalog.weekly[0].file, allowGlobal, null)
                .then(w => w?.coreProposalDrafts ?? [])
            : Promise.resolve([]),
        catalog.monthly[0]
            ? readJsonSafe<L3MonthlySummary | null>(rootPath, catalog.monthly[0].file, allowGlobal, null)
                .then(m => m?.coreProposalDrafts ?? [])
            : Promise.resolve([]),
    ]);

    // Use the most recent daily with actual data for dynamicLayer
    const sourceForDynamic = today ?? yesterday;
    const dynamicMemories: DynamicMemory[] = [];
    if (sourceForDynamic) {
        const dl = sourceForDynamic.dynamicLayer;
        const map: Array<{ cat: DynamicMemory['category']; items: string[] }> = [
            { cat: 'current_state', items: dl.currentState },
            { cat: 'purpose_context', items: dl.purposeContext },
            { cat: 'on_the_horizon', items: dl.onTheHorizon },
            { cat: 'others', items: dl.others },
        ];
        for (const { cat, items } of map) {
            for (const content of items) {
                if (!content.trim()) continue;
                dynamicMemories.push({
                    id: `dyn-${cat}-${now}-${Math.random().toString(36).slice(2, 6)}`,
                    category: cat,
                    content,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }
    }

    // Collect all drafts: daily (recent) + latest weekly/monthly (higher-confidence aggregates)
    const allDrafts = [
        ...(today?.coreProposalDrafts ?? []),
        ...(yesterday?.coreProposalDrafts ?? []),
        ...latestWeeklyDrafts,
        ...latestMonthlyDrafts,
    ];

    // Existing proposal text prefixes for dedup
    const existingPrefixes = new Set(existingProposals.map(p => p.proposal.substring(0, 40)));

    const newProposals: CoreProposal[] = [];
    const seenInBatch = new Set<string>();

    for (const draft of allDrafts) {
        const prefix = draft.proposal.substring(0, 40);
        if (existingPrefixes.has(prefix) || seenInBatch.has(prefix)) continue;
        seenInBatch.add(prefix);
        newProposals.push({
            id: draft.id,
            category: draft.category,
            proposal: draft.proposal,
            reason: draft.reason,
            status: 'pending',
            createdAt: now,
        });
    }

    return { newProposals, dynamicMemories };
};

// ── Proposal audit trail ──────────────────────────────────────────────────────

/**
 * Appends one audit record to memory/summaries/proposals/PROPOSAL_ID.audit.json.
 * The file and its parent directory are created on first write if absent.
 */
export const writeProposalAudit = async (
    rootPath: string,
    allowGlobal: boolean,
    opts: {
        proposalId: string;
        action: L3ProposalAuditRecord['action'];
        category: CoreProposalCategory;
        proposalText: string;
        reason: string;
        actorNote?: string;
    },
): Promise<void> => {
    if (!rootPath) return;
    const filePath = `memory/summaries/proposals/${opts.proposalId}.audit.json`;
    const existing = await readJsonSafe<L3ProposalAuditRecord[]>(rootPath, filePath, allowGlobal, []);
    const record: L3ProposalAuditRecord = {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        proposalId: opts.proposalId,
        action: opts.action,
        category: opts.category,
        proposalText: opts.proposalText,
        reason: opts.reason,
        timestamp: Date.now(),
        actorNote: opts.actorNote,
    };
    await writeJsonSafe(rootPath, filePath, allowGlobal, [...existing, record]);
};

// ── L3 RAG Search ─────────────────────────────────────────────────────────────

/**
 * Searches L3 daily (and optionally weekly) summaries by keyword overlap with
 * the given free-text query. Returns a formatted markdown string suitable for
 * injection into the chat as a system message (the "retrieved memory" context).
 *
 * Algorithm:
 *   1. Read the catalog to find which days/weeks have summaries (avoids wasted reads).
 *   2. For each catalog entry within `maxDaysBack` days, read its L3 summary.
 *   3. Score by: keyword overlap + text scan of highlights + recency bonus.
 *   4. Return the top `maxResults` matches formatted as markdown.
 */
/**
 * Callback signature for optional LLM-based result reranking.
 *
 * Receives the query string and an array of candidate snippets (already
 * above the rule-based score threshold).  Should return those same keys
 * in the preferred relevance order.  Any key omitted from the returned
 * array is placed at the end of the final list.
 */
export type L3RerankFn = (
    query: string,
    candidates: Array<{ key: string; level: string; snippet: string }>,
) => Promise<string[]>;

export const searchL3Memory = async (
    rootPath: string,
    allowGlobal: boolean,
    query: string,
    opts: {
        maxResults?: number;
        /** @deprecated No longer enforces a hard time limit — all catalog entries are searched.
         *  Kept for backwards compat; recency bonus still decays with distance. */
        maxDaysBack?: number;
        includeWeekly?: boolean;
        includeMonthly?: boolean;
        includeYearly?: boolean;
        /** When true, for the highest-scoring daily hit the L2 clean sessions are also
         *  read to surface fine-grained message-level context. */
        drillDownL2?: boolean;
        llmRerank?: L3RerankFn;
    } = {},
): Promise<string> => {
    if (!rootPath || !query.trim()) return '';

    const {
        maxResults = 5,
        includeWeekly = true,
        includeMonthly = true,
        includeYearly = true,
        drillDownL2 = true,
        llmRerank,
    } = opts;

    const queryTokens = new Set(
        tokenize(query).filter(t => !STOPWORDS.has(t)),
    );
    if (queryTokens.size === 0) return '';

    const now = Date.now();
    const catalog = await readL3Catalog(rootPath, allowGlobal);

    // ── Scoring helpers ───────────────────────────────────────────────────────
    const scoreText = (texts: string[]): number =>
        [...queryTokens].reduce((acc, tok) =>
            acc + (texts.some(t => t.toLowerCase().includes(tok)) ? 1 : 0), 0,
        );

    interface ScoredMatch {
        level: 'daily' | 'weekly' | 'monthly' | 'yearly';
        key: string;
        daysAgo: number;
        score: number;
        summary: L3DailySummary | L3WeeklySummary | L3MonthlySummary | L3YearlySummary;
    }
    const matches: ScoredMatch[] = [];

    // ── Keyword index pre-filter for daily entries ────────────────────────────
    const candidateDays = await lookupKeywordIndex(rootPath, allowGlobal, queryTokens);

    // ── Score daily summaries (full catalog, no time cutoff) ──────────────────
    const eligibleDays = catalog.daily.filter(e => {
        if (candidateDays !== null && candidateDays.size > 0) return candidateDays.has(e.key);
        return true;
    });

    for (const entry of eligibleDays) {
        const daily = await readJsonSafe<L3DailySummary | null>(rootPath, entry.file, allowGlobal, null);
        if (!daily) continue;

        const kwOverlap = daily.searchIndex.keywords.filter(kw => queryTokens.has(kw)).length;
        const textHits = scoreText(daily.highlights);
        const contextHits = scoreText([
            ...daily.dynamicLayer.purposeContext,
            ...daily.dynamicLayer.currentState,
        ]);
        if (kwOverlap === 0 && textHits === 0 && contextHits === 0) continue;

        const daysAgo = Math.round((now - Date.parse(entry.key + 'T12:00:00Z')) / 86400000);
        // Recency bonus: +0.5 within first 30 days, decaying to 0 at 365+ days
        const recencyBonus = Math.max(0, 1 - daysAgo / 365) * 0.5;
        const score = kwOverlap + textHits * 0.7 + contextHits * 0.4 + recencyBonus;
        matches.push({ level: 'daily', key: entry.key, daysAgo, score, summary: daily });
    }

    // ── Score weekly summaries ────────────────────────────────────────────────
    if (includeWeekly) {
        for (const entry of catalog.weekly) {
            const weekly = await readJsonSafe<L3WeeklySummary | null>(rootPath, entry.file, allowGlobal, null);
            if (!weekly) continue;
            const kwOverlap = weekly.searchIndex.keywords.filter(kw => queryTokens.has(kw)).length;
            const textHits = scoreText(weekly.highlights);
            if (kwOverlap === 0 && textHits === 0) continue;
            const daysAgo = Math.round((now - weekly.range.endedAt) / 86400000);
            const recencyBonus = Math.max(0, 1 - daysAgo / 365) * 0.3;
            matches.push({
                level: 'weekly', key: entry.key, daysAgo,
                score: kwOverlap * 0.8 + textHits * 0.5 + recencyBonus,
                summary: weekly,
            });
        }
    }

    // ── Score monthly summaries ───────────────────────────────────────────────
    if (includeMonthly) {
        for (const entry of catalog.monthly) {
            const monthly = await readJsonSafe<L3MonthlySummary | null>(rootPath, entry.file, allowGlobal, null);
            if (!monthly) continue;
            const kwOverlap = monthly.searchIndex.keywords.filter(kw => queryTokens.has(kw)).length;
            const textHits = scoreText([...monthly.highlights, ...monthly.stablePatterns]);
            if (kwOverlap === 0 && textHits === 0) continue;
            const daysAgo = Math.round((now - monthly.range.endedAt) / 86400000);
            matches.push({
                level: 'monthly', key: entry.key, daysAgo,
                score: kwOverlap * 0.7 + textHits * 0.4,
                summary: monthly,
            });
        }
    }

    // ── Score yearly summaries ────────────────────────────────────────────────
    if (includeYearly) {
        for (const entry of (catalog.yearly ?? [])) {
            const yearly = await readJsonSafe<L3YearlySummary | null>(rootPath, entry.file, allowGlobal, null);
            if (!yearly) continue;
            const kwOverlap = yearly.searchIndex.keywords.filter(kw => queryTokens.has(kw)).length;
            const textHits = scoreText([...yearly.highlights, ...yearly.milestones, ...yearly.stablePatterns]);
            if (kwOverlap === 0 && textHits === 0) continue;
            matches.push({
                level: 'yearly', key: entry.key, daysAgo: 0,
                score: kwOverlap * 0.6 + textHits * 0.3,
                summary: yearly,
            });
        }
    }

    if (matches.length === 0) return '';

    matches.sort((a, b) => b.score - a.score);

    // ── P3-1: Optional LLM rerank ─────────────────────────────────────────────
    let top = matches.slice(0, maxResults);
    if (llmRerank && matches.length > 1) {
        try {
            const pool = matches.slice(0, Math.min(matches.length, maxResults * 2));
            const candidates = pool.map(m => {
                const s = m.summary as { highlights: string[] };
                return { key: m.key, level: m.level, snippet: s.highlights.slice(0, 3).join(' / ') };
            });
            const rerankedKeys = await llmRerank(query, candidates);
            const keyToMatch = new Map(pool.map(m => [m.key, m]));
            const reranked: ScoredMatch[] = [];
            for (const key of rerankedKeys) {
                const m = keyToMatch.get(key);
                if (m) { reranked.push(m); keyToMatch.delete(key); }
            }
            keyToMatch.forEach(m => reranked.push(m));
            top = reranked.slice(0, maxResults);
        } catch { /* keep rule-based order */ }
    }

    // ── Format output ─────────────────────────────────────────────────────────
    const lines: string[] = [`=== 记忆检索: "${query.trim()}" ===\n`];

    for (const m of top) {
        const timeLabel =
            m.level === 'weekly' ? `周报 ${m.key}`
                : m.level === 'monthly' ? `月报 ${m.key}`
                    : m.level === 'yearly' ? `${m.key}年度回顾`
                        : m.daysAgo === 0 ? '今天'
                            : m.daysAgo === 1 ? '昨天'
                                : `${m.daysAgo}天前`;

        lines.push(`**[${m.key}] (${timeLabel})**:`);

        if (m.level === 'daily') {
            const d = m.summary as L3DailySummary;
            d.highlights.slice(0, 4).forEach(h => lines.push(`- ${h}`));
            const cs = d.dynamicLayer.currentState.filter(Boolean);
            const pc = d.dynamicLayer.purposeContext.filter(Boolean);
            if (cs.length > 0) lines.push(`- 状态: ${cs.join(' / ')}`);
            if (pc.length > 0) lines.push(`- 目标: ${pc.join(' / ')}`);
        } else if (m.level === 'weekly') {
            const w = m.summary as L3WeeklySummary;
            w.highlights.slice(0, 3).forEach(h => lines.push(`- ${h}`));
            w.trendNotes.slice(0, 2).forEach(t => lines.push(`- 趋势: ${t}`));
        } else if (m.level === 'monthly') {
            const mo = m.summary as L3MonthlySummary;
            mo.highlights.slice(0, 3).forEach(h => lines.push(`- ${h}`));
            mo.stablePatterns.slice(0, 2).forEach(p => lines.push(`- 规律: ${p}`));
        } else {
            const y = m.summary as L3YearlySummary;
            y.highlights.slice(0, 2).forEach(h => lines.push(`- ${h}`));
            y.milestones.slice(0, 2).forEach(ms => lines.push(`- 里程碑: ${ms}`));
            y.stablePatterns.slice(0, 1).forEach(p => lines.push(`- 规律: ${p}`));
        }
        lines.push('');
    }

    // ── L2 drill-down: load raw session messages for top daily hit ────────────
    // When the best match is a daily summary and score is confident (>= 1.5),
    // also surface the actual conversation content from L2 clean sessions.
    if (drillDownL2 && top.length > 0 && top[0].level === 'daily' && top[0].score >= 1.5) {
        const topDaily = top[0].summary as L3DailySummary;
        const cleanPointers = topDaily.sourceFiles.filter(f => f.kind === 'l2_clean');
        const relevantMsgs: string[] = [];

        for (const ptr of cleanPointers.slice(0, 3)) {
            const session = await readJsonSafe<L2CleanSession | null>(rootPath, ptr.path, allowGlobal, null);
            if (!session) continue;
            const allMsgs = session.segments.flatMap(s => s.messages ?? []);
            for (const msg of allMsgs) {
                const text = msg.text.toLowerCase();
                const hits = [...queryTokens].filter(tok => text.includes(tok)).length;
                if (hits > 0) {
                    const role = msg.role === 'user' ? 'U' : 'A';
                    const time = toHHMM(msg.ts);
                    relevantMsgs.push(`(${time}) ${role}: ${msg.text.substring(0, 200).replace(/\n/g, ' ')}`);
                }
            }
        }

        if (relevantMsgs.length > 0) {
            lines.push(`**原始对话片段 [${topDaily.dayKey}]**:`);
            relevantMsgs.slice(0, 6).forEach(m => lines.push(m));
            lines.push('');
        }
    }

    // ── File activity + app lifecycle drill-down for top daily hits ────────────
    // Search file events for the top-scoring daily matches to surface
    // relevant delete/move/create operations matching the query.
    const dailyHits = top.filter(m => m.level === 'daily').slice(0, 3);
    if (dailyHits.length > 0) {
        const fileEventLines: string[] = [];
        for (const hit of dailyHits) {
            const dk = hit.key as DayKey;
            const [fileLines, appLines] = await Promise.all([
                readFileActivityLines(rootPath, allowGlobal, dk),
                readAppLifecycleLines(rootPath, allowGlobal, dk),
            ]);
            const allEventLines = [...appLines, ...fileLines];
            for (const evLine of allEventLines) {
                const lower = evLine.toLowerCase();
                const hits = [...queryTokens].filter(tok => lower.includes(tok)).length;
                if (hits > 0) fileEventLines.push(`[${dk}] ${evLine}`);
            }
        }
        if (fileEventLines.length > 0) {
            lines.push('**相关文件/应用操作**:');
            fileEventLines.slice(0, 8).forEach(fl => lines.push(`- ${fl}`));
            lines.push('');
        }
    }

    return lines.join('\n');
};
