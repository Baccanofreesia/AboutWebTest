import { fsBridge } from './fsBridge';
import { L2DayManifest, L2RawEvent, L2RawEventType, L2RawTrigger, Message } from '../types';
import { L2SessionState } from './memorySession';

export interface AppendL2RawEventInput {
    rootPath: string;
    allowGlobal: boolean;
    charId: string;
    session: L2SessionState;
    type: L2RawEventType;
    timestamp: number;
    role?: 'user' | 'assistant' | 'system';
    messageId?: number;
    messageType?: L2RawEvent['messageType'];
    content?: string;
    metadata?: Record<string, unknown>;
    toolName?: string;
    toolStatus?: 'ok' | 'error' | 'unknown';
    trigger?: L2RawTrigger;
    continuedFrom?: { dayKey: string; part: number };
}

export interface AppendL2RawEventResult {
    event: L2RawEvent;
    rawFilePath: string;
    cleanFilePath: string;
    manifestPath: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

const dayFolder = (dayKey: string) => {
    const [year, month] = dayKey.split('-');
    return `${year}/${year}-${month}/${dayKey}`;
};

const buildRawFileName = (sessionId: string, part: number) =>
    `session-${sessionId}.part-${pad(part)}.raw.jsonl`;

const buildCleanFileName = (sessionId: string, part: number) =>
    `session-${sessionId}.part-${pad(part)}.clean.json`;

const ensureFolderSafe = async (rootPath: string, path: string, allowGlobal: boolean) => {
    try {
        await fsBridge.createFolder(rootPath, path, allowGlobal);
    } catch { }
};

const readJsonSafe = async <T>(rootPath: string, path: string, allowGlobal: boolean, fallback: T): Promise<T> => {
    try {
        const raw = await fsBridge.readFile(rootPath, path, allowGlobal);
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const writeJson = async (rootPath: string, path: string, allowGlobal: boolean, data: unknown) => {
    await fsBridge.writeFile(rootPath, path, JSON.stringify(data, null, 2), allowGlobal);
};

export const ensureL2MemoryLayout = async (rootPath: string, allowGlobal: boolean): Promise<void> => {
    await ensureFolderSafe(rootPath, 'memory', allowGlobal);
    await ensureFolderSafe(rootPath, 'memory/sessions', allowGlobal);
    await ensureFolderSafe(rootPath, 'memory/indexes', allowGlobal);
    // memory/clean/ is legacy — clean files now live alongside raw inside memory/sessions/
};

const ensureL2DayFolders = async (rootPath: string, allowGlobal: boolean, dayKey: string) => {
    await ensureFolderSafe(rootPath, `memory/sessions/${dayFolder(dayKey)}`, allowGlobal);
};

const createEventId = (ts: number) => {
    const d = new Date(ts);
    const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 8);
    return `evt-${stamp}-${rand}`;
};

const upsertManifest = async (
    rootPath: string,
    allowGlobal: boolean,
    dayKey: string,
    session: L2SessionState,
    timestamp: number,
    rawFilePath: string,
    cleanFilePath: string,
    continuedFrom?: { dayKey: string; part: number },
) => {
    const folder = dayFolder(dayKey);
    const manifestPath = `memory/sessions/${folder}/manifest.json`;
    const fallback: L2DayManifest = { version: 1, dayKey, updatedAt: Date.now(), parts: [] };
    const manifest = await readJsonSafe<L2DayManifest>(rootPath, manifestPath, allowGlobal, fallback);

    let entry = manifest.parts.find(p => p.sessionId === session.sessionId && p.part === session.part);
    if (!entry) {
        entry = {
            sessionId: session.sessionId,
            part: session.part,
            rawFile: rawFilePath,
            cleanFile: cleanFilePath,
            startedAt: timestamp,
            endedAt: timestamp,
            eventCount: 0,
            updatedAt: Date.now(),
            continuedFrom,
        };
        manifest.parts.push(entry);
    }
    entry.endedAt = timestamp;
    entry.updatedAt = Date.now();
    entry.eventCount += 1;
    entry.rawFile = rawFilePath;
    entry.cleanFile = cleanFilePath;
    if (continuedFrom && !entry.continuedFrom) {
        entry.continuedFrom = continuedFrom;
    }

    manifest.updatedAt = Date.now();
    await writeJson(rootPath, manifestPath, allowGlobal, manifest);

    if (continuedFrom) {
        const prevFolder = dayFolder(continuedFrom.dayKey);
        const prevManifestPath = `memory/sessions/${prevFolder}/manifest.json`;
        const prevFallback: L2DayManifest = { version: 1, dayKey: continuedFrom.dayKey, updatedAt: Date.now(), parts: [] };
        const prevManifest = await readJsonSafe<L2DayManifest>(rootPath, prevManifestPath, allowGlobal, prevFallback);
        const prevEntry = prevManifest.parts.find(
            p => p.sessionId === session.sessionId && p.part === continuedFrom.part,
        );
        if (prevEntry) {
            prevEntry.continuedTo = { dayKey, part: session.part };
            prevEntry.updatedAt = Date.now();
            prevManifest.updatedAt = Date.now();
            await writeJson(rootPath, prevManifestPath, allowGlobal, prevManifest);
        }
    }

    return manifestPath;
};

export const appendL2RawEvent = async (input: AppendL2RawEventInput): Promise<AppendL2RawEventResult> => {
    const {
        rootPath,
        allowGlobal,
        charId,
        session,
        type,
        timestamp,
        role,
        messageId,
        messageType,
        content,
        metadata,
        toolName,
        toolStatus,
        trigger,
        continuedFrom,
    } = input;

    await ensureL2MemoryLayout(rootPath, allowGlobal);
    await ensureL2DayFolders(rootPath, allowGlobal, session.dayKey);

    const folder = dayFolder(session.dayKey);
    const rawFileName = buildRawFileName(session.sessionId, session.part);
    const cleanFileName = buildCleanFileName(session.sessionId, session.part);
    const rawFilePath = `memory/sessions/${folder}/${rawFileName}`;
    const cleanFilePath = `memory/sessions/${folder}/${cleanFileName}`;

    const event: L2RawEvent = {
        id: createEventId(timestamp),
        ts: timestamp,
        isoTime: new Date(timestamp).toISOString(),
        charId,
        dayKey: session.dayKey,
        sessionId: session.sessionId,
        part: session.part,
        type,
        role,
        messageId,
        messageType,
        content,
        metadata,
        toolName,
        toolStatus,
        ...(trigger ? { trigger } : {}),
    };

    let previousRaw = '';
    try {
        previousRaw = await fsBridge.readFile(rootPath, rawFilePath, allowGlobal);
    } catch {
        previousRaw = '';
    }
    const nextRaw = `${previousRaw}${JSON.stringify(event)}\n`;
    await fsBridge.writeFile(rootPath, rawFilePath, nextRaw, allowGlobal);

    const manifestPath = await upsertManifest(
        rootPath,
        allowGlobal,
        session.dayKey,
        session,
        timestamp,
        rawFilePath,
        cleanFilePath,
        continuedFrom,
    );

    return { event, rawFilePath, cleanFilePath, manifestPath };
};

// ── Backfill L2 from existing DB messages (pre-configuration history) ─────────

export interface BackfillL2FromDBInput {
    rootPath: string;
    allowGlobal: boolean;
    charId: string;
    /** Caller provides messages from DB.getMessagesByCharId() — no direct DB dep here */
    messages: Message[];
}

export interface BackfillL2FromDBResult {
    sessionsCreated: number;
    daysProcessed: number;
}

/** Messages within this gap (ms) are grouped into the same backfill session */
const BACKFILL_SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Converts DB messages that have no corresponding L2 raw file into L2 raw JSONL files.
 * Groups messages into sessions by day + 2-hour inactivity gap.
 * Safe to re-run: skips sessions whose raw file already exists.
 */
export const backfillL2FromDB = async (
    input: BackfillL2FromDBInput,
): Promise<BackfillL2FromDBResult> => {
    const { rootPath, allowGlobal, charId, messages } = input;

    if (messages.length === 0) return { sessionsCreated: 0, daysProcessed: 0 };

    await ensureL2MemoryLayout(rootPath, allowGlobal);

    // Sort ascending by timestamp / id
    const sorted = [...messages]
        .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .sort((a, b) => {
            const ta = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const tb = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return ta !== tb ? ta - tb : (a.id ?? 0) - (b.id ?? 0);
        });

    if (sorted.length === 0) return { sessionsCreated: 0, daysProcessed: 0 };

    // Group into sessions by day + inactivity gap
    interface BackfillGroup { dayKey: string; msgs: Message[] }
    const groups: BackfillGroup[] = [];
    let current: BackfillGroup | null = null;
    let lastTs = 0;

    for (const msg of sorted) {
        const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
        const d = new Date(ts);
        const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const gap = ts - lastTs;
        if (!current || current.dayKey !== dk || gap > BACKFILL_SESSION_GAP_MS) {
            current = { dayKey: dk, msgs: [] };
            groups.push(current);
        }
        current.msgs.push(msg);
        lastTs = ts;
    }

    let sessionsCreated = 0;
    const daysProcessed = new Set<string>();

    for (const group of groups) {
        const firstMsg = group.msgs[0];
        const firstTs = typeof firstMsg.timestamp === 'number' ? firstMsg.timestamp : Date.now();

        // Derive a deterministic sessionId from the first message's timestamp
        const d = new Date(firstTs);
        const stamp =
            `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
            `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
        const sessionId = `${stamp}-backfill`;

        const folder = dayFolder(group.dayKey);
        const rawFileName = `session-${sessionId}.part-01.raw.jsonl`;
        const cleanFileName = `session-${sessionId}.part-01.clean.json`;
        const rawFilePath = `memory/sessions/${folder}/${rawFileName}`;
        const cleanFilePath = `memory/sessions/${folder}/${cleanFileName}`;

        // Skip if raw already exists
        try {
            await fsBridge.readFile(rootPath, rawFilePath, allowGlobal);
            continue; // already backfilled
        } catch { /* not found — proceed */ }

        await ensureFolderSafe(rootPath, `memory/sessions/${folder}`, allowGlobal);

        // Build raw JSONL lines
        const lines: string[] = [];
        for (const msg of group.msgs) {
            const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
            const md = msg.metadata && typeof msg.metadata === 'object' ? msg.metadata as Record<string, unknown> : null;

            // Content: replace ephemeral blobs with semantic labels (same logic as prepareContentForRaw)
            let content = String(msg.content || '');
            if (msg.type === 'voice') {
                const transcript = String(md?.transcription || '').trim();
                const dur = md?.duration ? `${Math.round(Number(md.duration))}s` : '';
                content = transcript ? `[语音${dur ? ' ' + dur : ''}] ${transcript}` : `[语音消息${dur ? ' ' + dur : ''}]`;
            } else if ((msg.type === 'image' || msg.type === 'video') && content.startsWith('data:')) {
                const label = msg.type === 'video' ? '视频' : '图片';
                // galleryPath is the full relative path (includes filename), prefer it over bare fileName
                const galleryPath = String(md?.galleryPath || '').trim();
                const fileName = String(md?.fileName || '').trim();
                const namePart = galleryPath || fileName;  // galleryPath has full context
                const detail = String(msg.type === 'video'
                    ? (md?.videoDetail || md?.imageDetail || '')
                    : (md?.imageDetail || '')).trim();
                const parts = [namePart, detail ? `detail=${detail}` : ''].filter(Boolean);
                content = parts.length > 0 ? `[${label}: ${parts.join(' | ')}]` : `[${label}]`;
            } else if (msg.type === 'emoji') {
                const name = String(md?.stickerName || '').trim();
                const category = String(md?.stickerCategory || '').trim();
                const rawUrl = typeof msg.content === 'string' ? msg.content.trim() : '';
                // Normalize URL:
                //   local://stickers/collection/xxx.png → stickers/collection/xxx.png (path)
                //   https://...  → keep as-is
                //   data:...     → drop (base64, no memory value)
                let stickerPath = '';
                if (rawUrl.startsWith('local://')) {
                    stickerPath = rawUrl.replace(/^local:\/\//, '');
                } else if (rawUrl.startsWith('http')) {
                    stickerPath = rawUrl;
                }
                const catName = category && name ? `${category}: ${name}` : name || category;
                const parts = [stickerPath, catName].filter(Boolean);
                content = parts.length > 0 ? `[表情包: ${parts.join(' | ')}]` : '[表情包]';
            } else if (msg.type === 'file') {
                const fileName = String(md?.fileName || '').trim();
                const workspacePath = String(md?.workspacePath || '').trim();
                const mimeType = String(md?.mimeType || md?.fileType || '').trim();
                const size = Number(md?.size || 0);
                const namePart = workspacePath || fileName;
                const sizePart = size > 0 ? `${(size / 1024).toFixed(1)}KB` : '';
                const typePart = mimeType ? `type=${mimeType}` : '';
                const parts = [namePart, sizePart, typePart].filter(Boolean);
                content = parts.length > 0 ? `[文件: ${parts.join(' | ')}]` : `[文件: ${fileName || '未知'}]`;
            }

            const type: L2RawEventType =
                msg.role === 'user' ? 'user_message'
                : msg.role === 'assistant' ? 'assistant_message'
                : (md?.toolName || md?.toolStatus || md?.source === 'tool') ? 'tool_event'
                : 'system_message';

            // Strip denylist fields from metadata
            let cleanMd: Record<string, unknown> | undefined;
            if (md) {
                const deny = new Set(['characterAvatar', 'audioBlob', 'audioUrl', 'waveform', 'hidden']);
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(md)) {
                    if (deny.has(k) || v === undefined || v === null) continue;
                    if (typeof v === 'string' && v.startsWith('data:') && v.length > 300) continue;
                    out[k] = v;
                }
                if (Object.keys(out).length > 0) cleanMd = out;
            }

            const event: L2RawEvent = {
                id: createEventId(ts),
                ts,
                isoTime: new Date(ts).toISOString(),
                charId,
                dayKey: group.dayKey,
                sessionId,
                part: 1,
                type,
                role: msg.role,
                messageId: typeof msg.id === 'number' ? msg.id : undefined,
                messageType: msg.type,
                content,
                metadata: cleanMd,
            };
            lines.push(JSON.stringify(event));
        }

        await fsBridge.writeFile(rootPath, rawFilePath, lines.join('\n') + '\n', allowGlobal);

        // Update manifest
        const manifestPath = `memory/sessions/${folder}/manifest.json`;
        const fallback: L2DayManifest = { version: 1, dayKey: group.dayKey, updatedAt: Date.now(), parts: [] };
        const manifest = await readJsonSafe<L2DayManifest>(rootPath, manifestPath, allowGlobal, fallback);
        if (!manifest.parts.find(p => p.sessionId === sessionId && p.part === 1)) {
            manifest.parts.push({
                sessionId,
                part: 1,
                rawFile: rawFilePath,
                cleanFile: cleanFilePath,
                startedAt: firstTs,
                endedAt: typeof group.msgs[group.msgs.length - 1].timestamp === 'number'
                    ? group.msgs[group.msgs.length - 1].timestamp as number
                    : firstTs,
                eventCount: group.msgs.length,
                updatedAt: Date.now(),
            });
            manifest.updatedAt = Date.now();
            await writeJson(rootPath, manifestPath, allowGlobal, manifest);
        }

        sessionsCreated++;
        daysProcessed.add(group.dayKey);
    }

    return { sessionsCreated, daysProcessed: daysProcessed.size };
};
