/** Six observable states for a live L2 session. */
export type L2SessionMode =
    | 'idle'
    | 'active_chat'
    | 'assistant_pending'
    | 'tool_pending'
    | 'active_task'
    | 'cooldown';

export interface L2SessionState {
    sessionId: string;
    dayKey: string;
    part: number;
    startedAt: number;
    lastEventAt: number;
    /** Derived observable state – set by resolveL2SessionState, never written manually. */
    mode: L2SessionMode;
    /** Epoch ms when the cooldown window expires (undefined = not in cooldown). */
    cooldownUntil?: number;
    assistantPending: boolean;
    toolPending: boolean;
    /** True while the user is in a known continuous task flow (tool chain, multi-step op). */
    taskActive?: boolean;
    /** Running count of user/assistant message events in this session. */
    messageCount?: number;
}

export interface L2SessionSignal {
    timestamp: number;
    assistantPending?: boolean;
    toolPending?: boolean;
    /** Caller sets this when entering / leaving a continuous task context. */
    taskActive?: boolean;
    forceNewSession?: boolean;
}

export interface L2SessionTransition {
    state: L2SessionState;
    startedNewSession: boolean;
    rolledPart: boolean;
    continuedFrom?: { dayKey: string; part: number };
}

export interface L2SessionOptions {
    /** How long with no activity before a new session starts (default: 45 min). */
    silenceThresholdMs?: number;
    /**
     * Grace window after pending flags clear.
     * Any new event within this window continues the same session (default: 5 min).
     */
    cooldownWindowMs?: number;
    /**
     * Minimum message count before a session can be split.
     * If the current session has fewer messages than this, silence threshold is ignored
     * and the next event continues the same session (default: 3).
     */
    minMessagesForSplit?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SILENCE_THRESHOLD_MS = 45 * 60 * 1000; // 45 min
const DEFAULT_COOLDOWN_WINDOW_MS = 5 * 60 * 1000;    // 5 min
const DEFAULT_MIN_MESSAGES_FOR_SPLIT = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export const toDayKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const createSessionId = (ts: number): string => {
    const d = new Date(ts);
    const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${stamp}-${rand}`;
};

/**
 * Derives the observable mode purely from state fields.
 * Priority order: assistant_pending > tool_pending > active_task > cooldown > active_chat.
 * 'idle' is never returned here (it's the caller's initial null state).
 */
const deriveMode = (
    assistantPending: boolean,
    toolPending: boolean,
    taskActive: boolean | undefined,
    cooldownUntil: number | undefined,
    ts: number,
): L2SessionMode => {
    if (assistantPending) return 'assistant_pending';
    if (toolPending) return 'tool_pending';
    if (taskActive) return 'active_task';
    if (cooldownUntil && ts < cooldownUntil) return 'cooldown';
    return 'active_chat';
};

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Stateless resolver: given the previous state and a new signal, returns the
 * next state plus metadata about what transition occurred.
 *
 * Session split rules (ALL must hold):
 *   1. Previous state has no assistantPending / toolPending / taskActive.
 *   2. Incoming signal has no assistantPending / toolPending / taskActive.
 *   3. Current time is NOT within the cooldown window of the previous session.
 *   4. Silence gap exceeds silenceThresholdMs.
 *
 * Cooldown window:
 *   When pending flags (assistantPending | toolPending) clear, a cooldown
 *   timer starts. Any event arriving before it expires continues the same
 *   session without checking the silence threshold.
 *
 * Day rollover:
 *   If the new event falls on a different calendar day, the sessionId is
 *   preserved (logical continuity) but the part number increments and the
 *   dayKey is updated. This satisfies the "00:00 splits file, not session"
 *   requirement from the architecture doc.
 */
export const resolveL2SessionState = (
    previous: L2SessionState | null,
    signal: L2SessionSignal,
    options?: L2SessionOptions,
): L2SessionTransition => {
    const ts = signal.timestamp || Date.now();
    const dayKey = toDayKey(ts);
    const silenceThresholdMs = options?.silenceThresholdMs ?? DEFAULT_SILENCE_THRESHOLD_MS;
    const cooldownWindowMs = options?.cooldownWindowMs ?? DEFAULT_COOLDOWN_WINDOW_MS;
    const minMsgsForSplit = options?.minMessagesForSplit ?? DEFAULT_MIN_MESSAGES_FOR_SPLIT;

    const sigPending = !!signal.assistantPending || !!signal.toolPending;
    const sigTask = !!signal.taskActive;

    // ── No previous state or forced reset ────────────────────────────────────
    if (!previous || signal.forceNewSession) {
        const mode = deriveMode(
            !!signal.assistantPending, !!signal.toolPending, sigTask, undefined, ts,
        );
        return {
            state: {
                sessionId: createSessionId(ts),
                dayKey,
                part: 1,
                startedAt: ts,
                lastEventAt: ts,
                mode,
                assistantPending: !!signal.assistantPending,
                toolPending: !!signal.toolPending,
                taskActive: sigTask || undefined,
                messageCount: 0,
            },
            startedNewSession: true,
            rolledPart: false,
        };
    }

    // ── Check split eligibility ───────────────────────────────────────────────
    const prevBlocked =
        previous.assistantPending || previous.toolPending || !!previous.taskActive;
    const sigBlocked = !!signal.assistantPending || !!signal.toolPending || sigTask;
    const canSplit = !prevBlocked && !sigBlocked;

    // Within cooldown: definitely continue same session
    const inCooldown = !!previous.cooldownUntil && ts < previous.cooldownUntil;
    const gapMs = Math.max(0, ts - previous.lastEventAt);
    // Don't split if current session is too short (< minMsgsForSplit messages)
    const hasEnoughMessages = (previous.messageCount ?? 0) >= minMsgsForSplit;
    const shouldStartNew = canSplit && !inCooldown && gapMs > silenceThresholdMs && hasEnoughMessages;

    if (shouldStartNew) {
        const mode = deriveMode(
            !!signal.assistantPending, !!signal.toolPending, sigTask, undefined, ts,
        );
        return {
            state: {
                sessionId: createSessionId(ts),
                dayKey,
                part: 1,
                startedAt: ts,
                lastEventAt: ts,
                mode,
                assistantPending: !!signal.assistantPending,
                toolPending: !!signal.toolPending,
                taskActive: sigTask || undefined,
                messageCount: 0,
            },
            startedNewSession: true,
            rolledPart: false,
        };
    }

    // ── Continue existing session ─────────────────────────────────────────────

    // Cooldown management:
    //   • Pending just cleared → start a fresh cooldown window.
    //   • Still within an existing cooldown → preserve it.
    //   • Otherwise → clear it.
    const prevHadPending = previous.assistantPending || previous.toolPending;
    const nowClearedPending = prevHadPending && !sigPending && !sigTask;
    const newCooldownUntil = nowClearedPending
        ? ts + cooldownWindowMs
        : previous.cooldownUntil && ts < previous.cooldownUntil
            ? previous.cooldownUntil
            : undefined;

    const mode = deriveMode(
        !!signal.assistantPending, !!signal.toolPending, sigTask, newCooldownUntil, ts,
    );

    const next: L2SessionState = {
        ...previous,
        lastEventAt: ts,
        mode,
        cooldownUntil: newCooldownUntil,
        assistantPending: !!signal.assistantPending,
        toolPending: !!signal.toolPending,
        taskActive: sigTask || undefined,
        messageCount: (previous.messageCount ?? 0) + 1,
    };

    // Day rollover: same logical session, new physical file part
    let rolledPart = false;
    let continuedFrom: { dayKey: string; part: number } | undefined;
    if (dayKey !== previous.dayKey) {
        rolledPart = true;
        continuedFrom = { dayKey: previous.dayKey, part: previous.part };
        next.dayKey = dayKey;
        next.part = previous.part + 1;
    }

    return { state: next, startedNewSession: false, rolledPart, continuedFrom };
};
