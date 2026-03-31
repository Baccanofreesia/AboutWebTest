import { fsBridge } from './fsBridge';
import {
    L2CleanAgentAction,
    L2CleanMessage,
    L2CleanSession,
    L2CleanToolCall,
    L2RawEvent,
} from '../types';

// ── Time helpers ───────────────────────────────────────────────────────────────

const padT = (n: number) => String(n).padStart(2, '0');
const toHHMM = (ts: number): string => {
    const d = new Date(ts);
    return `${padT(d.getHours())}:${padT(d.getMinutes())}`;
};

// ── Noise filter ──────────────────────────────────────────────────────────────
//
// "Noise" = events that carry no semantic value for L3 analysis:
//   - system_message: infrastructure pings (heartbeat, state sync) with no content
//   - user_action: isolated UI clicks/swipes with no message context within 30s
//
const CONTEXT_WINDOW_MS = 30_000;

const isNoiseEvent = (event: L2RawEvent, allEvents: L2RawEvent[], idx: number): boolean => {
    if (event.type === 'system_message') {
        const md = (event.metadata || {}) as Record<string, unknown>;
        const variant = String(md.variant || '');
        const isCallRelated = variant.includes('call');
        const hasMeaningfulContent = typeof event.content === 'string' && event.content.length > 20;
        return !isCallRelated && !hasMeaningfulContent;
    }

    if (event.type === 'user_action') {
        const hasNearbyMessage = allEvents.some((other, otherIdx) => {
            if (otherIdx === idx) return false;
            if (other.type !== 'user_message' && other.type !== 'assistant_message') return false;
            return Math.abs(other.ts - event.ts) <= CONTEXT_WINDOW_MS;
        });
        return !hasNearbyMessage;
    }

    return false;
};

// ── Segment splitter ──────────────────────────────────────────────────────────

const SEGMENT_GAP_MS = 20 * 60 * 1000; // 20-minute silence → new segment

const splitSegments = (events: L2RawEvent[]): L2RawEvent[][] => {
    const segments: L2RawEvent[][] = [];
    let current: L2RawEvent[] = [];

    for (const ev of events) {
        if (current.length === 0) {
            current.push(ev);
            continue;
        }
        const prev = current[current.length - 1];
        if (ev.ts - prev.ts > SEGMENT_GAP_MS) {
            segments.push(current);
            current = [ev];
        } else {
            current.push(ev);
        }
    }
    if (current.length > 0) segments.push(current);
    return segments;
};

// ── Extractors ────────────────────────────────────────────────────────────────

/**
 * Builds a semantic label for media events (image/video/voice) from the event's
 * messageType and metadata. This handles both:
 *   - New raw JSONL: content is already the label (from memoryArchive)
 *   - Old raw JSONL: content is still a base64 data URL (fallback rebuild)
 */
const buildMediaLabel = (event: L2RawEvent): string => {
    const md = (event.metadata || {}) as Record<string, unknown>;
    const str = (v: unknown) => String(v || '').trim();

    if (event.messageType === 'voice') {
        const transcript = str(md.transcription);
        const dur = md.duration ? `${Math.round(Number(md.duration))}s` : '';
        return transcript
            ? `[语音消息${dur ? ' ' + dur : ''}] ${transcript}`
            : `[语音消息${dur ? ' ' + dur : ''}]`;
    }

    if (event.messageType === 'image' || event.messageType === 'video') {
        const label = event.messageType === 'video' ? '视频' : '图片';
        const galleryPath = str(md.galleryPath); // full relative path (preferred)
        const fileName = str(md.fileName);
        const namePart = galleryPath || fileName;
        const detail = str(event.messageType === 'video'
            ? (md.videoDetail || md.imageDetail || '')
            : (md.imageDetail || ''));
        const parts = [namePart, detail ? `detail=${detail}` : ''].filter(Boolean);
        return parts.length > 0 ? `[${label}: ${parts.join(' | ')}]` : `[${label}]`;
    }

    if (event.messageType === 'emoji') {
        const name = str(md.stickerName);
        const category = str(md.stickerCategory);
        const rawUrl = typeof event.content === 'string' ? event.content.trim() : '';
        // local:// → path, https → keep, data: → drop
        let stickerPath = '';
        if (rawUrl.startsWith('local://')) {
            stickerPath = rawUrl.replace(/^local:\/\//, '');
        } else if (rawUrl.startsWith('http')) {
            stickerPath = rawUrl;
        }
        const catName = category && name ? `${category}: ${name}` : name || category;
        const parts = [stickerPath, catName].filter(Boolean);
        return parts.length > 0 ? `[表情包: ${parts.join(' | ')}]` : '[表情包]';
    }

    if (event.messageType === 'file') {
        const workspacePath = str(md.workspacePath);
        const fileName = str(md.fileName);
        const mimeType = str(md.mimeType || md.fileType || '');
        const size = Number(md.size || 0);
        const namePart = workspacePath || fileName;
        const sizePart = size > 0 ? `${(size / 1024).toFixed(1)}KB` : '';
        const typePart = mimeType ? `type=${mimeType}` : '';
        const parts = [namePart, sizePart, typePart].filter(Boolean);
        return parts.length > 0 ? `[文件: ${parts.join(' | ')}]` : `[文件: ${fileName || '未知'}]`;
    }

    return '';
};

/**
 * Extracts readable text from a message event.
 * - If content is already a semantic string (new raw JSONL), return as-is.
 * - If content is base64 (old raw JSONL or leak), rebuild from messageType + metadata.
 * - If content is a multimodal array (edge case), extract text parts.
 */
const extractTextContent = (event: L2RawEvent): string => {
    const content = event.content;

    // Multimodal array (shouldn't normally appear in raw JSONL, but handle gracefully)
    if (Array.isArray(content)) {
        const textParts = (content as Array<{ type?: string; text?: string }>)
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text!);
        const hasMedia = (content as Array<{ type?: string }>).some(
            c => c.type === 'image_url' || c.type === 'image' || c.type === 'video_url',
        );
        const mediaLabel = hasMedia ? buildMediaLabel(event) || '[含媒体]' : '';
        return [...textParts, mediaLabel].filter(Boolean).join('\n');
    }

    if (typeof content === 'string') {
        // Content is still a raw base64 blob (old sessions or edge case) — rebuild label
        if (/^data:(image|video|audio)/.test(content)) {
            return buildMediaLabel(event) || '[媒体内容]';
        }
        // File messages: content is just `[文件] fileName` (no path info) — enrich with metadata
        if (event.messageType === 'file') {
            return buildMediaLabel(event) || content;
        }
        return content;
    }

    return String(content ?? '');
};

/** Full messages — no truncation. */
const extractMessages = (events: L2RawEvent[]): L2CleanMessage[] =>
    events
        .filter(e => (e.type === 'user_message' || e.type === 'assistant_message') && e.content)
        .map(e => ({
            role: (e.type === 'user_message' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: extractTextContent(e),
            ts: e.ts,
        }))
        .filter(m => m.text.trim().length > 0);

/** Tool calls with their results (tool audit). */
const extractToolCalls = (events: L2RawEvent[]): L2CleanToolCall[] =>
    events
        .filter(e => e.type === 'tool_event')
        .map(e => {
            const md = (e.metadata || {}) as Record<string, unknown>;
            const call: L2CleanToolCall = {
                time: toHHMM(e.ts),
                ts: e.ts,
                toolName: e.toolName || String(md.toolName || '未知工具'),
                status: (e.toolStatus ?? 'unknown') as 'ok' | 'error' | 'unknown',
            };
            const inp = String(md.inputSummary || '');
            const out = String(md.outputSummary || '');
            if (inp) call.inputSummary = inp.slice(0, 200);
            if (out) call.outputSummary = out.slice(0, 200);
            return call;
        });

/**
 * Converts a single non-conversation event into one human-readable sentence
 * for the agentActions timeline.
 */
const buildNarrative = (event: L2RawEvent): string => {
    const md = (event.metadata || {}) as Record<string, unknown>;
    const str = (v: unknown) => String(v || '');

    switch (event.type) {
        case 'tool_event': {
            const tool = event.toolName || str(md.toolName) || '未知工具';
            const input = str(md.inputSummary || '').slice(0, 60);
            const output = str(md.outputSummary || '').slice(0, 80);
            if (tool === 'RECALL')
                return `调阅了 ${input || '历史档案'}${output ? '，' + output : ''}`;
            if (tool === 'MEMORY_SEARCH')
                return `检索记忆关键词「${input}」${output ? '，' + output : ''}`;
            const base = input ? `使用工具 ${tool}：${input}` : `使用了工具 ${tool}`;
            return (output ? `${base}，${output}` : base).slice(0, 140);
        }
        case 'agent_decision': {
            const rawResp = str(md.rawResponse || event.content || '').slice(0, 140);
            if (rawResp) return rawResp;
            const outcome = str(md.outcome || '').slice(0, 60);
            const tag = str(md.actionTag || '').slice(0, 40);
            return outcome ? `执行决策：${outcome}（${tag}）` : `执行了 ${tag}`;
        }
        case 'app_interaction': {
            const appId = str(md.appId || '').slice(0, 30);
            const prompt = str(event.content || '').slice(0, 80);
            return `在 ${appId} 中收到请求：「${prompt}」`;
        }
        default:
            return str(event.content || '').slice(0, 100);
    }
};

/** Session-level timeline of tool calls, decisions, and app interactions. */
const extractAgentActions = (events: L2RawEvent[]): L2CleanAgentAction[] =>
    events
        .filter(e =>
            e.type === 'tool_event' ||
            e.type === 'agent_decision' ||
            e.type === 'app_interaction',
        )
        .map(e => {
            const md = (e.metadata || {}) as Record<string, unknown>;
            const type: L2CleanAgentAction['type'] =
                e.type === 'tool_event' ? 'tool_call'
                    : e.type === 'agent_decision' ? 'decision'
                        : 'app_interaction';
            const action: L2CleanAgentAction = {
                time: toHHMM(e.ts),
                ts: e.ts,
                type,
                narrative: buildNarrative(e),
            };
            if (e.toolName) action.toolName = e.toolName;
            if (md.appId) action.appId = String(md.appId);
            if (e.toolStatus) action.status = e.toolStatus;
            const result = String(md.outputSummary || '');
            if (result) action.resultSummary = result.slice(0, 200);
            return action;
        });

// ── JSONL parser ──────────────────────────────────────────────────────────────

const parseJsonLineEvents = (rawText: string): L2RawEvent[] => {
    const events: L2RawEvent[] = [];
    for (const line of rawText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const item = JSON.parse(trimmed) as L2RawEvent;
            if (item && typeof item.ts === 'number') events.push(item);
        } catch {
            // Skip malformed rows.
        }
    }
    return events.sort((a, b) => a.ts - b.ts);
};

// ── Core builder ─────────────────────────────────────────────────────────────

const buildCleanDoc = (events: L2RawEvent[]): L2CleanSession => {
    const first = events[0];
    const dayKey = first?.dayKey || '';
    const sessionId = first?.sessionId || '';
    const part = first?.part ?? 1;

    // Apply noise filter — preserves all semantic events
    const filtered = events.filter((e, idx) => !isNoiseEvent(e, events, idx));

    const userMessages = filtered.filter(e => e.type === 'user_message').length;
    const assistantMessages = filtered.filter(e => e.type === 'assistant_message').length;
    const toolEvents = filtered.filter(e => e.type === 'tool_event').length;
    const agentDecisions = filtered.filter(e => e.type === 'agent_decision').length;
    const appInteractions = filtered.filter(e => e.type === 'app_interaction').length;

    // ── Derive session source from trigger metadata ──
    const sourceCounts: Record<string, number> = {};
    let callSessionId: string | undefined;
    let callDirection: 'user_to_agent' | 'agent_to_user' | undefined;
    for (const ev of filtered) {
        const trigger = (ev as any).trigger as { source?: string } | undefined;
        const src = trigger?.source || 'chat';
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;

        if (src === 'call') {
            const md = (ev.metadata || {}) as Record<string, unknown>;
            if (!callSessionId && md.callSessionId) callSessionId = String(md.callSessionId);
            // Prefer explicit callDirection from metadata (set by useCallManager)
            if (!callDirection && md.callDirection) {
                callDirection = String(md.callDirection) === 'incoming' ? 'user_to_agent' : 'agent_to_user';
            }
            // Fallback: first message type determines direction
            if (!callDirection && ev.type === 'user_message') callDirection = 'user_to_agent';
            if (!callDirection && ev.type === 'assistant_message') callDirection = 'agent_to_user';
        }
    }
    const sourceKeys = Object.keys(sourceCounts);
    const primarySource = sourceKeys.length === 1
        ? (sourceKeys[0] as L2CleanSession['source'])
        : sourceKeys.length === 0 ? 'chat' : 'mixed';

    const segmentsRaw = splitSegments(filtered);
    const segments = segmentsRaw.map((group, idx) => ({
        segmentId: `seg-${String(idx + 1).padStart(3, '0')}`,
        startAt: group[0].ts,
        endAt: group[group.length - 1].ts,
        messages: extractMessages(group),
        toolCalls: extractToolCalls(group),
    }));

    const agentActions = extractAgentActions(filtered);
    const startAt = filtered[0]?.ts ?? Date.now();
    const endAt = filtered[filtered.length - 1]?.ts ?? Date.now();

    // Generate human-readable label for memory recall
    const sourceLabel = primarySource === 'call'
        ? callDirection === 'agent_to_user' ? 'agent主动打给用户的通话' : '用户打给agent的通话'
        : primarySource === 'heartbeat' ? '心跳消息'
        : primarySource === 'cron' ? '定时任务触发'
        : primarySource === 'mixed' ? '混合来源会话'
        : '文字聊天';

    const doc: L2CleanSession = {
        version: 2,
        dayKey,
        sessionId,
        part,
        generatedAt: Date.now(),
        startAt,
        endAt,
        source: primarySource,
        sourceLabel,
        stats: {
            eventCount: filtered.length,
            userMessages,
            assistantMessages,
            toolEvents,
            agentDecisions,
            appInteractions,
        },
        segments,
        agentActions: agentActions.length > 0 ? agentActions : undefined,
    };

    if (primarySource === 'call' && callDirection) {
        doc.callMeta = { direction: callDirection };
        if (callSessionId) doc.callMeta.callSessionId = callSessionId;
    }

    return doc;
};

// ── Public API ────────────────────────────────────────────────────────────────

export interface RebuildL2CleanInput {
    rootPath: string;
    allowGlobal: boolean;
    rawFilePath: string;
    cleanFilePath: string;
}

export const rebuildL2CleanFromRaw = async (input: RebuildL2CleanInput): Promise<L2CleanSession | null> => {
    const { rootPath, allowGlobal, rawFilePath, cleanFilePath } = input;
    let rawText = '';
    try {
        rawText = await fsBridge.readFile(rootPath, rawFilePath, allowGlobal);
    } catch {
        return null;
    }
    const events = parseJsonLineEvents(rawText);
    if (events.length === 0) return null;

    const cleanDoc = buildCleanDoc(events);
    await fsBridge.writeFile(rootPath, cleanFilePath, JSON.stringify(cleanDoc, null, 2), allowGlobal);
    return cleanDoc;
};

// ── One-time migrations ───────────────────────────────────────────────────────

export interface MigrateL2CleanInput {
    rootPath: string;
    allowGlobal: boolean;
}

/**
 * Rebuilds all clean.json files that were generated with v1 format (truncated messages).
 * Safe to re-run: only rebuilds files where version < 2.
 */
export const migrateL2CleanToV2 = async (input: MigrateL2CleanInput): Promise<number> => {
    const { rootPath, allowGlobal } = input;
    let rebuilt = 0;

    const listDir = async (path: string): Promise<string[]> => {
        try {
            return ((await fsBridge.readDir(rootPath, path, allowGlobal)) ?? []).map(e => e.name);
        } catch { return []; }
    };
    const readJsonSafe = async <T>(path: string, fb: T): Promise<T> => {
        try { return JSON.parse(await fsBridge.readFile(rootPath, path, allowGlobal)) as T; }
        catch { return fb; }
    };

    const years = await listDir('memory/sessions');
    for (const year of years) {
        const months = await listDir(`memory/sessions/${year}`);
        for (const month of months) {
            const days = await listDir(`memory/sessions/${year}/${month}`);
            for (const day of days) {
                const folder = `memory/sessions/${year}/${month}/${day}`;
                const manifest = await readJsonSafe<{ parts: Array<{ rawFile?: string; cleanFile?: string }> }>(
                    `${folder}/manifest.json`, { parts: [] },
                );
                for (const part of manifest.parts) {
                    if (!part.rawFile || !part.cleanFile) continue;
                    const existing = await readJsonSafe<{ version?: number }>( part.cleanFile, {});
                    if ((existing.version ?? 0) >= 2) continue;
                    try {
                        await rebuildL2CleanFromRaw({
                            rootPath, allowGlobal,
                            rawFilePath: part.rawFile,
                            cleanFilePath: part.cleanFile,
                        });
                        rebuilt++;
                    } catch { /* skip on error */ }
                }
            }
        }
    }
    return rebuilt;
};

export interface MigrateCleanLayoutInput { rootPath: string; allowGlobal: boolean; }

/**
 * Moves existing clean.json files from the legacy `memory/clean/YYYY/MM/DD/` tree
 * into the co-located `memory/sessions/YYYY/MM/DD/` structure, then updates each
 * manifest.json so that cleanFile paths reflect the new location.
 * Safe to re-run (already-moved files are skipped).
 */
export const migrateCleanLayoutToSessionsDir = async (input: MigrateCleanLayoutInput): Promise<number> => {
    const { rootPath, allowGlobal } = input;
    let moved = 0;

    const listDir = async (p: string): Promise<string[]> => {
        try { return ((await fsBridge.readDir(rootPath, p, allowGlobal)) ?? []).map(e => e.name); }
        catch { return []; }
    };
    const fileExists = async (p: string) => {
        try { await fsBridge.readFile(rootPath, p, allowGlobal); return true; }
        catch { return false; }
    };

    const years = await listDir('memory/sessions');
    for (const year of years.filter(y => /^\d{4}$/.test(y))) {
        const months = await listDir(`memory/sessions/${year}`);
        for (const month of months) {
            const days = await listDir(`memory/sessions/${year}/${month}`);
            for (const day of days) {
                const sessionDir = `memory/sessions/${year}/${month}/${day}`;
                const manifestPath = `${sessionDir}/manifest.json`;

                let manifest: { parts?: Array<{ rawFile?: string; cleanFile?: string }> };
                try {
                    manifest = JSON.parse(await fsBridge.readFile(rootPath, manifestPath, allowGlobal));
                } catch { continue; }

                if (!manifest.parts) continue;
                let dirty = false;

                for (const part of manifest.parts) {
                    if (!part.cleanFile) continue;
                    if (!part.cleanFile.startsWith('memory/clean/')) continue;

                    const legacyPath = part.cleanFile;
                    const fileName = legacyPath.split('/').pop()!;
                    const newPath = `${sessionDir}/${fileName}`;

                    if (await fileExists(legacyPath) && !(await fileExists(newPath))) {
                        const content = await fsBridge.readFile(rootPath, legacyPath, allowGlobal);
                        await fsBridge.writeFile(rootPath, newPath, content, allowGlobal);
                        moved++;
                    }

                    part.cleanFile = newPath;
                    dirty = true;
                }

                if (dirty) {
                    await fsBridge.writeFile(rootPath, manifestPath, JSON.stringify(manifest, null, 2), allowGlobal);
                }
            }
        }
    }
    return moved;
};
