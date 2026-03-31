/**
 * l2CaptureService — Centralized L2 raw event writer (singleton)
 *
 * Single source of truth for all L2 captures across the app:
 *   - Chat messages (user / assistant)
 *   - Tool calls (MEMORY_SEARCH, RECALL, ToolGateway, XHS, etc.)
 *   - Agent decisions (action tag execution: call init, voice switch, etc.)
 *   - App interactions (askAgent calls from dynamic Apps)
 *   - Background sources (heartbeat, cron, call — via OSContext watcher)
 *
 * Usage:
 *   import { L2CaptureService } from '../utils/l2CaptureService';
 *
 *   // Configure once when the active character / workspace changes:
 *   L2CaptureService.configure({ rootPath, allowGlobal, charId });
 *
 *   // Capture a batch of pending messages:
 *   await L2CaptureService.captureMessages(msgs, triggerFn, { assistantPending: true });
 *
 *   // Capture an agent decision (action tag):
 *   await L2CaptureService.captureDecision({ trigger, actionTag, thinking, outcome });
 *
 *   // Capture a tool call:
 *   await L2CaptureService.captureToolCall({ trigger, toolName, inputSummary, outputSummary, status });
 *
 *   // Capture a dynamic-app askAgent interaction:
 *   await L2CaptureService.captureAppInteraction({ appId, prompt, response });
 */

import { Message, MessageType, L2RawTrigger, L2RawEventType } from '../types';
import { appendL2RawEvent } from './memoryArchive';
import { rebuildL2CleanFromRaw } from './memoryClean';
import { resolveL2SessionState, L2SessionState, L2SessionSignal } from './memorySession';

// ---------------------------------------------------------------------------
// Config & internal state
// ---------------------------------------------------------------------------

interface L2CaptureConfig {
    rootPath: string;
    allowGlobal: boolean;
    charId: string;
}

// Per-call options for captureMessages batch
export interface CaptureMessagesOpts {
    assistantPending?: boolean;
    toolPending?: boolean;
}

// Options for captureDecision
export interface CaptureDecisionOpts {
    trigger: L2RawTrigger;
    /** Original action tag string, e.g. "[[INITIATE_CALL]]" */
    actionTag: string;
    /** Chain-of-thought from the model (if available via msg.thinking) */
    thinking?: string;
    /** EventBus.getSnapshot() at decision time */
    contextSnapshot?: string;
    /** e.g. "call_initiated", "voice_switched", "nickname_changed", "silent" */
    outcome?: string;
    /** Agent's natural-language text surrounding the action */
    rawResponse?: string;
    ts?: number;
}

// Options for captureToolCall
export interface CaptureToolCallOpts {
    trigger: L2RawTrigger;
    toolName: string;
    inputSummary?: string;
    outputSummary?: string;
    status: 'ok' | 'error' | 'unknown';
    ts?: number;
}

// Options for captureAppInteraction
export interface CaptureAppInteractionOpts {
    appId: string;
    prompt: string;
    response?: string;
    /** Defaults to { source: 'app', appId } */
    trigger?: L2RawTrigger;
    ts?: number;
}

// ---------------------------------------------------------------------------
// Helpers (moved from useChatAI so they live alongside the service)
// ---------------------------------------------------------------------------

/**
 * Converts raw message content to a stable semantic string suitable for L2 storage.
 * - voice  → transcription text (discards blob URL)
 * - image/video with dataURL → [图片: filename] label
 * - emoji  → [表情包: name] prefix
 * - file   → [文件: name] label
 */
export function prepareContentForRaw(msg: Message): string {
    const raw = String(msg.content || '');
    const md = (msg.metadata && typeof msg.metadata === 'object')
        ? msg.metadata as Record<string, unknown>
        : null;

    switch (msg.type as MessageType) {
        case 'voice': {
            const transcript = String(md?.transcription || '').trim();
            const dur = md?.duration ? `${Math.round(Number(md.duration))}s` : '';
            return transcript
                ? `[语音${dur ? ' ' + dur : ''}] ${transcript}`
                : `[语音消息${dur ? ' ' + dur : ''}]`;
        }
        case 'image':
        case 'video': {
            const label = msg.type === 'video' ? '视频' : '图片';
            const galleryPath = String(md?.galleryPath || '');
            const fileName = String(md?.fileName || '');
            const detail = String(msg.type === 'video'
                ? (md?.videoDetail || md?.imageDetail || '')
                : (md?.imageDetail || ''));
            // Never store raw base64; prefer galleryPath → fileName → nothing
            const namePart = galleryPath || fileName || (raw.startsWith('data:') ? '' : raw);
            const parts = [namePart, detail ? `detail=${detail}` : ''].filter(Boolean);
            return parts.length > 0 ? `[${label}: ${parts.join(' | ')}]` : `[${label}]`;
        }
        case 'emoji': {
            const name = String(md?.stickerName || '');
            const category = String(md?.stickerCategory || '');
            // local:// → strip prefix to get storage path; https → keep; data: → drop
            let stickerPath = '';
            if (raw.startsWith('local://')) {
                stickerPath = raw.replace(/^local:\/\//, '');
            } else if (raw.startsWith('http')) {
                stickerPath = raw;
            }
            const catName = category && name ? `${category}: ${name}` : name || category;
            const parts = [stickerPath, catName].filter(Boolean);
            return parts.length > 0 ? `[表情包: ${parts.join(' | ')}]` : '[表情包]';
        }
        case 'file': {
            const workspacePath = String(md?.workspacePath || '');
            const fileName = String(md?.fileName || raw);
            const namePart = workspacePath || fileName;
            return namePart ? `[文件: ${namePart}]` : '[文件]';
        }
        default:
            return raw;
    }
}

/**
 * Strips render-only fields from metadata before writing to L2 raw.
 * Denylist approach: removes only known ephemeral keys and large data URIs.
 */
export function pickMetadataForRaw(metadata: unknown): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const deny = new Set([
        'characterAvatar', 'audioBlob', 'audioUrl', 'waveform', 'hidden',
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
        if (deny.has(k) || v === undefined || v === null) continue;
        if (typeof v === 'string' && v.startsWith('data:') && v.length > 300) continue;
        out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Derives the L2 trigger for a message based on its metadata.
 * Falls back to chat/call if no triggerSource metadata is set.
 */
export function deriveL2Trigger(msg: Message, prevUserMsgId?: number): L2RawTrigger {
    const md = (msg.metadata && typeof msg.metadata === 'object')
        ? msg.metadata as Record<string, unknown>
        : null;
    const triggerSource = String(md?.triggerSource || '');

    if (triggerSource === 'heartbeat') return { source: 'heartbeat', reason: 'heartbeat_tick' };
    if (triggerSource.startsWith('cron')) return { source: 'cron', reason: triggerSource };
    if (
        triggerSource === 'call' ||
        triggerSource.startsWith('call-') ||
        md?.source === 'call' ||
        md?.variant === 'call'
    ) {
        return { source: 'call', reason: String(md?.variant || 'turn') };
    }
    if (msg.role === 'user') return { source: 'chat', reason: 'user_message' };
    if (msg.role === 'assistant') {
        return {
            source: 'chat',
            reason: 'reply',
            ...(prevUserMsgId ? { triggerMsgId: prevUserMsgId } : {}),
        };
    }
    return { source: 'system', reason: 'system_event' };
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

class L2CaptureServiceClass {
    private config: L2CaptureConfig | null = null;
    private sessionRef: L2SessionState | null = null;
    private lastCapturedId = 0;
    /** True once initWatermark() has been called for the current charId. */
    private watermarkInitialized = false;

    // ── Configuration ────────────────────────────────────────────────────────

    configure(opts: L2CaptureConfig): void {
        if (!opts.rootPath || !opts.charId) return;
        // Reset state when the active character changes
        if (this.config?.charId !== opts.charId) {
            this.sessionRef = null;
            this.lastCapturedId = 0;
            this.watermarkInitialized = false;
        }
        this.config = opts;
    }

    /**
     * Sets the watermark to the current max message ID so that only NEW messages
     * (after this call) will be captured.
     *
     * Call this on first workspace setup so historical messages are NOT silently
     * backfilled. Use backfillL2FromDB() explicitly for intentional history import.
     *
     * Safe to call multiple times — only acts on the first call per character.
     */
    initWatermark(messages: Message[]): void {
        if (this.watermarkInitialized) return;
        const maxId = messages.reduce<number>((max, m) => {
            const id = typeof m.id === 'number' ? m.id : 0;
            return id > max ? id : max;
        }, 0);
        this.lastCapturedId = maxId;
        this.watermarkInitialized = true;
    }

    // ── Batch capture (chat messages from useChatAI) ─────────────────────────

    /**
     * Captures all pending messages (id > lastCapturedId) from the given list.
     * Use triggerFn to derive per-message triggers (chat, heartbeat, cron, call).
     * Pass the assistant's thinking string via the optional thinkingMap if available.
     */
    async captureMessages(
        messages: Message[],
        triggerFn: (msg: Message) => L2RawTrigger,
        opts?: CaptureMessagesOpts & {
            /** map: messageId → thinking text */
            thinkingMap?: Map<number, string>;
        },
    ): Promise<void> {
        const cfg = this.config;
        if (!cfg?.rootPath) return;

        const pending = messages
            .filter(m => typeof m.id === 'number' && (m.id as number) > this.lastCapturedId)
            .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
            .sort((a, b) => (a.id as number) - (b.id as number));
        if (pending.length === 0) return;

        // Track sessions touched in this batch for clean rebuild
        const touched = new Map<string, { rawFilePath: string; cleanFilePath: string }>();

        for (const msg of pending) {
            const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
            const signal: L2SessionSignal = {
                timestamp,
                assistantPending: opts?.assistantPending,
                toolPending: opts?.toolPending,
            };
            const transition = resolveL2SessionState(this.sessionRef, signal);
            this.sessionRef = transition.state;

            const thinking = opts?.thinkingMap?.get(msg.id as number);
            const md = pickMetadataForRaw(msg.metadata);

            const { rawFilePath, cleanFilePath } = await appendL2RawEvent({
                rootPath: cfg.rootPath,
                allowGlobal: cfg.allowGlobal,
                charId: cfg.charId,
                session: transition.state,
                type: this._inferType(msg),
                timestamp,
                role: msg.role,
                messageId: typeof msg.id === 'number' ? msg.id : undefined,
                messageType: msg.type,
                content: prepareContentForRaw(msg),
                metadata: thinking
                    ? { ...md, thinking: thinking.slice(0, 600) }
                    : md,
                trigger: triggerFn(msg),
                continuedFrom: transition.continuedFrom,
            });

            const key = `${transition.state.sessionId}-${transition.state.part}`;
            if (!touched.has(key)) touched.set(key, { rawFilePath, cleanFilePath });

            if (typeof msg.id === 'number' && (msg.id as number) > this.lastCapturedId) {
                this.lastCapturedId = msg.id as number;
            }
        }

        // Rebuild clean files for all touched sessions
        for (const { rawFilePath, cleanFilePath } of touched.values()) {
            await rebuildL2CleanFromRaw({
                rootPath: cfg.rootPath,
                allowGlobal: cfg.allowGlobal,
                rawFilePath,
                cleanFilePath,
            }).catch(() => { });
        }
    }

    // ── Agent decision ────────────────────────────────────────────────────────

    /**
     * Records a single agent decision: an action tag was detected and executed.
     * Captures the action, optional CoT (thinking), perception snapshot, and outcome.
     */
    async captureDecision(opts: CaptureDecisionOpts): Promise<void> {
        const cfg = this.config;
        if (!cfg?.rootPath) return;

        const ts = opts.ts ?? Date.now();
        const transition = resolveL2SessionState(this.sessionRef, { timestamp: ts });
        this.sessionRef = transition.state;

        await appendL2RawEvent({
            rootPath: cfg.rootPath,
            allowGlobal: cfg.allowGlobal,
            charId: cfg.charId,
            session: transition.state,
            type: 'agent_decision',
            timestamp: ts,
            role: 'assistant',
            content: opts.rawResponse ?? opts.actionTag,
            metadata: {
                actionTag: opts.actionTag,
                ...(opts.thinking ? { thinking: opts.thinking.slice(0, 600) } : {}),
                ...(opts.contextSnapshot ? { contextSnapshot: opts.contextSnapshot } : {}),
                ...(opts.outcome ? { outcome: opts.outcome } : {}),
            },
            trigger: opts.trigger,
            continuedFrom: transition.continuedFrom,
        }).catch(() => { });
    }

    // ── Tool call ─────────────────────────────────────────────────────────────

    /**
     * Records a single tool invocation (MEMORY_SEARCH, RECALL, XHS_*, ToolGateway, etc.).
     * Call before + after the tool, or just after with the final status.
     */
    async captureToolCall(opts: CaptureToolCallOpts): Promise<void> {
        const cfg = this.config;
        if (!cfg?.rootPath) return;

        const ts = opts.ts ?? Date.now();
        const transition = resolveL2SessionState(this.sessionRef, {
            timestamp: ts,
            toolPending: true,
        });
        this.sessionRef = transition.state;

        const { rawFilePath, cleanFilePath } = await appendL2RawEvent({
            rootPath: cfg.rootPath,
            allowGlobal: cfg.allowGlobal,
            charId: cfg.charId,
            session: transition.state,
            type: 'tool_event',
            timestamp: ts,
            toolName: opts.toolName,
            toolStatus: opts.status,
            content: opts.outputSummary,
            metadata: opts.inputSummary ? { inputSummary: opts.inputSummary } : undefined,
            trigger: opts.trigger,
            continuedFrom: transition.continuedFrom,
        });

        await rebuildL2CleanFromRaw({
            rootPath: cfg.rootPath,
            allowGlobal: cfg.allowGlobal,
            rawFilePath,
            cleanFilePath,
        }).catch(() => { });
    }

    // ── App interaction (dynamic App → askAgent) ──────────────────────────────

    /**
     * Records an askAgent() interaction from a dynamic App.
     * Writes the prompt as 'app_interaction' and the response as 'assistant_message'.
     */
    async captureAppInteraction(opts: CaptureAppInteractionOpts): Promise<void> {
        const cfg = this.config;
        if (!cfg?.rootPath) return;

        const ts = opts.ts ?? Date.now();
        const trigger: L2RawTrigger = opts.trigger ?? { source: 'app', appId: opts.appId };

        // Prompt event
        const promptTransition = resolveL2SessionState(this.sessionRef, {
            timestamp: ts,
            assistantPending: true,
        });
        this.sessionRef = promptTransition.state;

        const { rawFilePath, cleanFilePath } = await appendL2RawEvent({
            rootPath: cfg.rootPath,
            allowGlobal: cfg.allowGlobal,
            charId: cfg.charId,
            session: promptTransition.state,
            type: 'app_interaction',
            timestamp: ts,
            role: 'user',
            content: opts.prompt.slice(0, 500),
            metadata: { appId: opts.appId },
            trigger,
            continuedFrom: promptTransition.continuedFrom,
        });

        // Response event (if available)
        if (opts.response) {
            const replyTs = ts + 1;
            const replyTransition = resolveL2SessionState(this.sessionRef, { timestamp: replyTs });
            this.sessionRef = replyTransition.state;

            await appendL2RawEvent({
                rootPath: cfg.rootPath,
                allowGlobal: cfg.allowGlobal,
                charId: cfg.charId,
                session: replyTransition.state,
                type: 'assistant_message',
                timestamp: replyTs,
                role: 'assistant',
                content: opts.response.slice(0, 800),
                trigger,
                continuedFrom: replyTransition.continuedFrom,
            });
        }

        await rebuildL2CleanFromRaw({
            rootPath: cfg.rootPath,
            allowGlobal: cfg.allowGlobal,
            rawFilePath,
            cleanFilePath,
        }).catch(() => { });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _inferType(msg: Message): L2RawEventType {
        if (msg.role === 'user') return 'user_message';
        if (msg.role === 'assistant') return 'assistant_message';
        const md = (msg.metadata && typeof msg.metadata === 'object')
            ? msg.metadata as Record<string, unknown>
            : null;
        const hasToolMeta = !!md && (
            typeof md.toolName === 'string' ||
            typeof md.toolStatus === 'string' ||
            md.source === 'tool' ||
            md.source === 'mcp' ||
            md.source === 'xhs'
        );
        if (msg.type === 'interaction' || hasToolMeta) return 'tool_event';
        return 'system_message';
    }
}

/** Singleton instance — import and use directly across the entire app. */
export const L2CaptureService = new L2CaptureServiceClass();
