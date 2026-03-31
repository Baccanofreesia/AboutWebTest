
// ============================================
// NovaClaw Type System v2
// Single-Agent AI Assistant Architecture
// ============================================

export enum AppID {
    Launcher = 'launcher',
    Settings = 'settings',
    Chat = 'chat',
    CheckPhone = 'checkphone',  // Phone-in-Phone: Agent's virtual phone
    Gallery = 'gallery',
    ThemeMaker = 'thememaker',
    Appearance = 'appearance',
    Date = 'date',              // Future: Voice/Video Call entry
    User = 'user',              // Lightweight profile card (avatar + nickname)
    Journal = 'journal',
    Schedule = 'schedule',
    Study = 'study',            // Study Room from SULLYTEST2
    FreeRoam = 'freeroam',      // XHS Free Roam from SULLYTEST2
    XhsStock = 'xhs_stock',     // XHS image stock (optional)
    Music = 'music',            // Future: Listen together
    Browser = 'browser',        // Future: AI search/browse
}

export interface StickerUsageRecord {
    name: string;       // sticker name (key)
    count: number;      // total send count
    lastUsedAt: number; // timestamp of last use
}

// --- Message Types ---

export type MessageType = 'text' | 'transfer' | 'interaction' | 'voice' | 'emoji' | 'image' | 'video' | 'xhs_card' | 'file';

export interface MessageReplyRef {
    id: number;
    content: string;
    name: string;
    messageType?: MessageType;
    fileName?: string;
    workspacePath?: string;
}

export interface Message {
    id: number;
    charId: string;             // Always 'nova' in NovaClaw
    role: 'user' | 'assistant' | 'system';
    type: MessageType;
    content: string;
    metadata?: any;
    replyTo?: MessageReplyRef;
    timestamp: number;
}

// --- XHS (小红书) ---

export interface XhsStockImage {
    id: string;
    url: string;
    localPath?: string;
    tags: string[];
    addedAt: number;
    usedCount: number;
    lastUsedAt?: number;
}

export type XhsActionType = 'post' | 'browse' | 'search' | 'comment' | 'save_topic' | 'idle';

export interface XhsActivityRecord {
    id: string;
    characterId: string;
    timestamp: number;
    actionType: XhsActionType;
    content: {
        title?: string;
        body?: string;
        tags?: string[];
        keyword?: string;
        savedTopics?: { title: string; desc: string; noteId?: string }[];
        notesViewed?: { noteId: string; title: string; desc: string; author: string; likes: number }[];
        commentTarget?: { noteId: string; title: string };
        commentText?: string;
    };
    thinking: string;
    result: 'success' | 'failed' | 'skipped';
    resultMessage?: string;
}

export interface XhsFreeRoamSession {
    id: string;
    characterId: string;
    startedAt: number;
    endedAt?: number;
    activities: XhsActivityRecord[];
    summary?: string;
}

export interface XhsMcpConfig {
    enabled: boolean;
    serverUrl: string;
    loggedInUserId?: string;
    loggedInNickname?: string;
    userXsecToken?: string;
}

export interface AppConfig {
    id: AppID | string;
    name: string;
    icon: string;
    color: string;
}

// --- OS Theme ---

export interface OSTheme {
    hue: number;
    saturation: number;
    lightness: number;
    wallpaper: string;
    darkMode: boolean;
    contentColor: string;
}

// --- API Config ---

export type ApiSource =
    | 'openai_compatible'  // Default: universal OpenAI-format proxy
    | 'volcengine'         // 火山引擎方舟 在线推理（ep-xxxx）
    | 'volcengine_coding'  // 火山引擎方舟 Coding Plan（模型名直传）
    | 'minimax'            // MiniMax 按量付费
    | 'minimax_coding'     // MiniMax Coding Plan（Anthropic 协议）
    | 'gemini'             // Google Gemini native
    | 'deepseek'           // DeepSeek official
    | 'moonshot';          // Moonshot/Kimi official

export interface APIConfig {
    apiSource?: ApiSource; // defaults to 'openai_compatible' if undefined
    baseUrl: string;
    apiKey: string;
    model: string;
    callPauseThreshold?: number; // VAD debounce in ms (call only)
    callSegmentDuration?: number; // max voice chunk duration in ms (call only)
    callAsrProvider?: 'web-speech' | 'faster-whisper' | 'bytedance';
    bytedanceAsrAppKey?: string;
    bytedanceAsrAccessKey?: string;
    bytedanceAsrResourceId?: string;
    bytedanceAsrMode?: 'fast' | 'standard' | 'dual' | 'file';
    bytedanceAsrLanguage?: string;
    bytedanceAsrEnablePunc?: boolean;
    bytedanceAsrEnableItn?: boolean;
    bytedanceAsrEnableEmotion?: boolean;
    bytedanceAucPublicBaseUrl?: string;
    webSpeechLanguage?: string;
    webSpeechInterim?: boolean;
    webSpeechContinuous?: boolean;
    webSpeechMinVolume?: number; // dB threshold (e.g. -30)
    nativeWorkspacePath?: string; // e.g. 'D:\\MyWork\\Mydevelop\\MyBot'
    galleryWorkspacePath?: string; // e.g. 'D:\\MyWork\\Mydevelop\\MyBot\\Photos'
    securityPolicy?: SecurityPolicy;
    perceptionConfig?: PerceptionConfig;
    videoUnderstanding?: VideoUnderstandingConfig;
    ttsProvider?: 'minimax' | 'fish_speech' | 'none';
    minimaxApiKey?: string;
    minimaxGroupId?: string;
    fishSpeechBaseUrl?: string;
    fishSpeechApiKey?: string;
    l3SummaryConfig?: L3SummaryConfig;
}

export interface L3SummaryConfig {
    /** Master toggle — set false to disable all L3 auto-generation */
    enabled: boolean;
    /**
     * Base hour (0–23) for the summary pipeline trigger (default: 2).
     * Daily fires every day; weekly fires on Monday; monthly fires on the 1st.
     * All three use this same time — the pipeline decides what to generate.
     */
    baseHour: number;
    /** Base minute (0–59) (default: 0) */
    baseMinute: number;
    /** Dual-model: separate API Source for summarization */
    summaryApiSource?: ApiSource;
    /** Dual-model: separate API base URL for summarization (falls back to main apiConfig if unset) */
    summaryBaseUrl?: string;
    /** Dual-model: separate API key for summarization */
    summaryApiKey?: string;
    /** Dual-model: lightweight model for daily summarization */
    summaryModel?: string;
    /** Dual-model: stronger model for weekly/monthly (falls back to summaryModel if unset) */
    summaryModelStrong?: string;
}

/** Audit record appended to memory/summaries/proposals/PROPOSAL_ID.audit.json on every action */
export interface L3ProposalAuditRecord {
    id: string;                    // unique audit event id
    proposalId: string;            // the CoreProposal id
    action: 'approved' | 'rejected' | 'edited' | 'reverted';
    category: CoreProposalCategory;
    proposalText: string;          // text at time of action (post-edit if action=edited)
    reason: string;
    timestamp: number;             // ms epoch
    actorNote?: string;            // optional user annotation
}

export interface VideoUnderstandingConfig {
    maxFrames?: number; // default 10
    providerMode?: 'auto' | 'kimi' | 'volcengine' | 'gemini';
    nativeFirst?: boolean;
}

export interface PerceptionConfig {
    visibilityThreshold: number;      // 0.0 - 1.0, higher means more strict (silent)
    internalizationBias: number;      // 0.0 - 1.0, higher means subtle tone influence
    frequencyPenalty: number;         // 0.0 - 1.0, prevents repeating environmental hints
    presencePenalty: number;          // 0.0 - 1.0, discourages mentioning already-discussed context
    batteryUrgencyThreshold: number;  // default 15%
    lateNightHour: number;            // default 23 (11 PM)
}

export interface ApiPreset {
    id: string;
    name: string;
    config: APIConfig;
}

// --- Memory System ---

export interface MemoryFragment {
    id: string;
    date: string;
    summary: string;
    mood?: string;
}

// --- Memory L2: Session Archive (raw + clean) ---

export type L2RawEventType =
    | 'user_message'
    | 'assistant_message'
    | 'system_message'
    | 'tool_event'
    | 'user_action'
    /** An askAgent() call originating from a dynamic App (prompt + response pair). */
    | 'app_interaction'
    /** Agent executed an action tag (call init, voice switch, nickname change, etc.). */
    | 'agent_decision';

/**
 * Why this event was generated — causal context.
 * source:
 *   'chat'       — user typed/sent something in the Chat app
 *   'call'       — phone call turn
 *   'heartbeat'  — periodic silent agent heartbeat
 *   'cron'       — scheduled cron job fired
 *   'app'        — interaction in a non-chat app (button, tool, etc.)
 *   'system'     — internal system event (session lifecycle, etc.)
 */
export interface L2RawTrigger {
    source: 'chat' | 'call' | 'heartbeat' | 'cron' | 'app' | 'system';
    reason?: string;        // e.g. 'user_message', 'reply', 'interaction:戳一戳', 'cron:daily_archival'
    appId?: string;         // which app triggered this (for source='app')
    triggerMsgId?: number;  // the message id that caused an agent reply
}

export interface L2RawEvent {
    id: string;
    ts: number;
    isoTime: string;
    charId: string;
    dayKey: string;
    sessionId: string;
    part: number;
    type: L2RawEventType;
    role?: 'user' | 'assistant' | 'system';
    messageId?: number;
    messageType?: MessageType;
    content?: string;
    metadata?: Record<string, unknown>;
    toolName?: string;
    toolStatus?: 'ok' | 'error' | 'unknown';
    /** Causal context: why was this event generated? */
    trigger?: L2RawTrigger;
}

export interface L2SessionManifestEntry {
    sessionId: string;
    part: number;
    rawFile: string;
    cleanFile: string;
    startedAt: number;
    endedAt: number;
    eventCount: number;
    updatedAt: number;
    continuedFrom?: { dayKey: string; part: number };
    continuedTo?: { dayKey: string; part: number };
}

export interface L2DayManifest {
    version: number;
    dayKey: string;
    updatedAt: number;
    parts: L2SessionManifestEntry[];
}

export interface L2CleanMessage {
    role: 'user' | 'assistant';
    /** Full message text — no truncation. */
    text: string;
    ts: number;
}

/** A tool call that occurred within a session segment, including its result. */
export interface L2CleanToolCall {
    /** HH:mm of the event */
    time: string;
    ts: number;
    toolName: string;
    status: 'ok' | 'error' | 'unknown';
    /** Brief description of input (≤200 chars) */
    inputSummary?: string;
    /** Brief description of output/result (≤200 chars) */
    outputSummary?: string;
}

/**
 * A single agent action entry — one human-readable sentence describing what the agent
 * did (tool call / decision / dynamic-app interaction) at a given time.
 * Stored in L2CleanSession.agentActions and surfaced to L3 as a narrative timeline.
 */
export interface L2CleanAgentAction {
    /** HH:mm of the event */
    time: string;
    ts: number;
    type: 'tool_call' | 'decision' | 'app_interaction';
    /** One-sentence natural-language description. */
    narrative: string;
    /** For tool_call events */
    toolName?: string;
    /** For app_interaction events */
    appId?: string;
    status?: 'ok' | 'error' | 'unknown';
    /** Brief summary of the action outcome (≤200 chars) */
    resultSummary?: string;
}

export interface L2CleanSegment {
    segmentId: string;
    startAt: number;
    endAt: number;
    /** Full conversation exchanges in this segment — no truncation. */
    messages: L2CleanMessage[];
    /** Tool calls with results that occurred in this segment. */
    toolCalls: L2CleanToolCall[];
}

export interface L2CleanSession {
    version: number;
    dayKey: string;
    sessionId: string;
    part: number;
    generatedAt: number;
    startAt: number;
    endAt: number;
    /** Primary source of this session's events: 'chat' | 'call' | 'heartbeat' | 'cron' | 'mixed'. */
    source?: 'chat' | 'call' | 'heartbeat' | 'cron' | 'mixed';
    /** Human-readable label for memory recall, e.g. "用户打给agent的通话", "文字聊天" */
    sourceLabel?: string;
    /** Present only when source === 'call'. */
    callMeta?: {
        /** Who initiated: 'user_to_agent' (user dialed) or 'agent_to_user' (agent initiated). */
        direction: 'user_to_agent' | 'agent_to_user';
        /** Call session identifier from the call manager. */
        callSessionId?: string;
    };
    stats: {
        eventCount: number;
        userMessages: number;
        assistantMessages: number;
        toolEvents: number;
        agentDecisions: number;
        appInteractions: number;
    };
    segments: L2CleanSegment[];
    /** Narrative timeline of tool calls, agent decisions, and app interactions. */
    agentActions?: L2CleanAgentAction[];
}

// --- Behavior Index (Event Perception -> Daily Index) ---

export type UsageAction =
    | 'app_open'
    | 'app_close'
    | 'app_switch'
    | 'view'
    | 'write'
    | 'update'
    | 'delete'
    | 'complete'
    | 'send'
    | 'search'
    | 'custom';

export interface UsageEvent {
    id: string;
    ts: number;
    isoTime: string;
    dayKey: string;
    appId: string;
    action: UsageAction;
    detail?: string;
    refType?: string;
    refId?: string;
    dwellMs?: number;
    importance?: number;
    source?: 'system' | 'event_bus' | 'agent' | 'user';
}

export interface BehaviorDayIndex {
    version: number;
    dayKey: string;
    updatedAt: number;
    totalEvents: number;
    appOpenCount: Record<string, number>;
    totalDwellMsByApp: Record<string, number>;
    actionCountByApp: Record<string, Record<string, number>>;
    highValueRefs: Array<{
        appId: string;
        refType: string;
        refId: string;
        lastTs: number;
        score: number;
    }>;
}

export interface ToolAuditRecord {
    id: string;
    ts: number;
    action: string;
    status: 'ok' | 'error';
    appId?: string;
    refType?: string;
    refId?: string;
    detail?: string;
}

// --- Memory L3 Summary Artifacts (daily / weekly / monthly) ---

// Key formats:
// - DayKey: YYYY-MM-DD
// - WeekKey: YYYY-Www (ISO week)
// - MonthKey: YYYY-MM
// - YearKey: YYYY
export type DayKey = string;
export type WeekKey = string;
export type MonthKey = string;
export type YearKey = string;

export type MemorySummaryLevel = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface L3SummaryRange {
    startedAt: number;
    endedAt: number;
}

export interface L3SourcePointer {
    kind: 'l2_raw' | 'l2_clean' | 'behavior_events' | 'behavior_index';
    path: string;
    dayKey?: DayKey;
    sessionId?: string;
    part?: number;
}

export interface L3DynamicLayerSnapshot {
    currentState: string[];
    purposeContext: string[];
    onTheHorizon: string[];
    others: string[];
}

export type CoreProposalCategory = 'about_agent' | 'user_profile' | 'relationship_core';

export interface L3CoreProposalDraft {
    id: string;
    category: CoreProposalCategory;
    proposal: string;
    reason: string;
    confidence?: number; // 0~1 heuristic score from summarizer
    status: 'pending' | 'approved' | 'rejected';
}

export interface L3SummaryStats {
    l2SessionParts: number;
    messageEvents: number;
    toolEvents: number;
    userActions: number;
    usageEvents: number;
    activeApps: string[];
    totalDwellMs: number;
}

export interface L3SearchRef {
    appId: string;
    refType: string;
    refId: string;
    score: number;
    lastTs: number;
}

export interface L3SearchIndex {
    keywords: string[];
    refs: L3SearchRef[];
}

export interface L3DailySummary {
    version: number;
    level: 'daily';
    dayKey: DayKey;
    createdAt: number;
    updatedAt: number;
    range: L3SummaryRange;
    stats: L3SummaryStats;
    highlights: string[];
    dynamicLayer: L3DynamicLayerSnapshot;
    coreProposalDrafts: L3CoreProposalDraft[];
    searchIndex: L3SearchIndex;
    sourceFiles: L3SourcePointer[];
}

export interface L3WeeklySummary {
    version: number;
    level: 'weekly';
    weekKey: WeekKey;
    createdAt: number;
    updatedAt: number;
    range: L3SummaryRange;
    sourceDays: DayKey[];
    sourceDailyFiles: string[];
    highlights: string[];
    trendNotes: string[];
    dynamicLayer: L3DynamicLayerSnapshot;
    coreProposalDrafts: L3CoreProposalDraft[];
    searchIndex: L3SearchIndex;
}

export interface L3MonthlySummary {
    version: number;
    level: 'monthly';
    monthKey: MonthKey;
    createdAt: number;
    updatedAt: number;
    range: L3SummaryRange;
    sourceDays: DayKey[];
    sourceWeeks: WeekKey[];
    sourceWeeklyFiles: string[];
    highlights: string[];
    stablePatterns: string[];
    dynamicLayer: L3DynamicLayerSnapshot;
    coreProposalDrafts: L3CoreProposalDraft[];
    searchIndex: L3SearchIndex;
}

export interface L3YearlySummary {
    version: number;
    level: 'yearly';
    yearKey: YearKey;                       // e.g. "2025"
    createdAt: number;
    updatedAt: number;
    range: L3SummaryRange;
    sourceMonths: MonthKey[];
    sourceMonthlyFiles: string[];
    highlights: string[];                   // Most memorable moments / milestones of the year
    milestones: string[];                   // Turning points, achievements, important changes
    stablePatterns: string[];               // Long-term stable traits/behaviors observed this year
    relationshipNotes: string[];            // How the relationship evolved over the year
    dynamicLayer: L3DynamicLayerSnapshot;
    coreProposalDrafts: L3CoreProposalDraft[];
    searchIndex: L3SearchIndex;
}

export type L3Summary = L3DailySummary | L3WeeklySummary | L3MonthlySummary | L3YearlySummary;

export interface L3CatalogItem {
    key: DayKey | WeekKey | MonthKey | YearKey;
    file: string;
    level: MemorySummaryLevel;
    createdAt: number;
    updatedAt: number;
}

export interface L3SummaryCatalog {
    version: number;
    updatedAt: number;
    daily: L3CatalogItem[];
    weekly: L3CatalogItem[];
    monthly: L3CatalogItem[];
    yearly: L3CatalogItem[];
}

/**
 * Inverted keyword index: keyword → sorted-descending array of dayKeys.
 * Lives at memory/summaries/indexes/keyword_index.json.
 * Built incrementally as daily summaries are generated.
 */
export interface L3KeywordIndex {
    version: number;
    updatedAt: number;
    /** keyword → dayKeys that contain it, newest first */
    index: Record<string, string[]>;
}

// --- Memory L4: Profiles (dynamic evolution buffer before stable core) ---

/**
 * A single "active observation" living in the profiles/ buffer.
 * Entries accumulate approval counts from repeated L3b proposal approvals.
 * Once approvalCount reaches the promotion threshold they are written to the
 * stable core files (USER.md / Agent_Soul.md / MEMORY.md) and marked promoted.
 */
export interface L4ProfileEntry {
    id: string;
    category: CoreProposalCategory;
    content: string;
    reason: string;
    /** first 50 chars of content.toLowerCase() — used for deduplication */
    fingerprint: string;
    /** proposal ids that contributed to this entry (tracks provenance) */
    sourceProposalIds: string[];
    firstApprovedAt: number;
    lastApprovedAt: number;
    /** how many distinct approvals this observation has received */
    approvalCount: number;
    /** true once written to stable core (USER.md / Agent_Soul.md / MEMORY.md) */
    promoted: boolean;
    promotedAt?: number;
}

export interface L4ProfileFile {
    version: number;
    category: CoreProposalCategory;
    updatedAt: number;
    entries: L4ProfileEntry[];
}

// --- Memory L3: Dynamic Layer (auto-updated daily) ---

export interface DynamicMemory {
    id: string;
    category: 'current_state' | 'purpose_context' | 'on_the_horizon' | 'others';
    content: string;
    createdAt: number;
    updatedAt: number;
}

// --- Memory L3: Core Proposals (need user approval) ---

export interface CoreProposal {
    id: string;
    category: CoreProposalCategory;
    proposal: string;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: number;
}

// --- Cron Job System (OpenClaw-style) ---

export type CronScheduleKind = 'every' | 'at' | 'cron';
export type CronEveryUnit = 'minutes' | 'hours';

export interface CronJob {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    type: 'system' | 'custom';              // system = memory fold, custom = user/agent created
    scheduleKind: CronScheduleKind;
    // For 'every': everyAmount + everyUnit (e.g. every 30 minutes)
    everyAmount?: number;
    everyUnit?: CronEveryUnit;
    // For 'at': scheduleAt is ISO string for one-shot (e.g. '2026-03-04T07:00')
    scheduleAt?: string;
    // For 'cron': cronExpr (e.g. '0 7 * * *')
    cronExpr?: string;
    prompt: string;                          // Hidden prompt sent to LLM when triggered
    lastRunAt?: number;
    nextRunAt?: number;
    createdAt: number;
}

// --- Heartbeat Config ---

export interface HeartbeatConfig {
    enabled: boolean;
    intervalMinutes: number;                 // Default 30, user/agent can change
    lastBeatAt?: number;
    prompt: string;                          // Hidden system prompt for heartbeat check
}

// --- User Impression (Four-Dimensional Profile) ---
// AI-generated psychological portrait of the user

export interface UserImpression {
    version: number;
    lastUpdated?: number;
    value_map: {
        likes: string[];
        dislikes: string[];
        core_values: string;
    };
    behavior_profile: {
        tone_style: string;
        emotion_summary: string;
        response_patterns: string;
    };
    emotion_schema: {
        triggers: {
            positive: string[];
            negative: string[];
        };
        comfort_zone: string;
        stress_signals: string[];
    };
    personality_core: {
        observed_traits: string[];
        interaction_style: string;
        summary: string;
    };
    observed_changes?: string[];
}

// --- Agent Profile (Single Agent - Nova) ---

export interface SpriteConfig {
    scale: number;
    x: number;   // percentage -100 to 100
    y: number;   // percentage -100 to 100
}

export interface AgentProfile {
    id: string;                             // Always 'nova'
    name: string;                           // Real name (e.g. "Nova")
    nickname?: string;                      // Display nickname in chat (like QQ/Discord)
    avatar: string;                         // Real/default avatar
    displayAvatar?: string;                 // Chat display avatar (e.g. couple avatar)
    description: string;
    systemPrompt: string;
    memories: MemoryFragment[];
    refinedMemories?: Record<string, string>;
    activeMemoryMonths?: string[];
    dynamicMemories?: DynamicMemory[];      // L3a dynamic layer
    coreProposals?: CoreProposal[];         // L3b core proposals awaiting approval
    l3SummaryBlurb?: string;               // L3 cached context: today+yesterday daily + latest weekly + monthly highlights
    profilesBlurb?: string;                // L4 active observations from profiles/ buffer (not yet promoted to stable core)
    impression?: UserImpression;            // AI's psychological profile of user
    heartbeat?: HeartbeatConfig;            // Heartbeat configuration
    bubbleStyle?: string;                   // Theme linked to this agent
    chatBackground?: string;                // Custom chat background
    contextLimit?: number;
    replySplitInterval?: number;            // ms between split messages (default: dynamic)
    hideSystemLogs?: boolean;
    hideBeforeMessageId?: number;
    xhsEnabled?: boolean;
    callInitiative?: number;

    // TTS & Voice
    chatVoiceEnabled?: boolean;             // Double-layer control switch
    chatVoiceLang?: string;                 // Target language for voice replies
    voiceProfile?: {
        provider?: 'minimax' | 'fish_speech';
        voiceId: string;                    // Fish Speech reference ID or MiniMax voice ID
        voiceName?: string;
        source?: 'custom' | 'preset';
        model?: string;
        speed?: number;
        vol?: number;
        pitch?: number;
        emotion?: string;
        timberWeights?: { voice_id: string; weight: number }[];
        voiceModify?: { pitch?: number; intensity?: number; timbre?: number; sound_effects?: string };
        notes?: string;
    };

    // DateApp / Visual Novel assets (preserved for future video call)
    dateBackground?: string;
    sprites?: Record<string, string>;
    spriteConfig?: SpriteConfig;
}

// Legacy alias — for gradual migration
export type CharacterProfile = AgentProfile;

// --- Agent Config Export ---

export interface AgentExportData extends Omit<AgentProfile, 'id' | 'memories' | 'refinedMemories' | 'activeMemoryMonths' | 'impression'> {
    version: number;
    type: 'novaclaw_agent_card';
    embeddedTheme?: ChatTheme;
}

// Legacy alias
export type CharacterExportData = AgentExportData;

// --- User Profile ---

export interface UserProfile {
    name: string;                           // Real name (used in Agent prompt context)
    nickname?: string;                      // Display nickname in chat (like QQ/Discord)
    preferredNames?: string[];              // Preferred forms of address
    avatar: string;                         // Default avatar
    displayAvatar?: string;                 // Chat display avatar (e.g. couple avatar)
    bio: string;                            // Sent to AI as user context
}

// --- Chat Theme & Bubble Style ---

export interface BubbleStyle {
    textColor: string;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    borderRadius: number;
    opacity: number;

    // Bubble Sticker / Decoration
    decoration?: string;
    decorationX?: number;
    decorationY?: number;
    decorationScale?: number;
    decorationRotate?: number;

    // Avatar Decoration (Frame/Sticker)
    avatarDecoration?: string;
    avatarDecorationX?: number;
    avatarDecorationY?: number;
    avatarDecorationScale?: number;
    avatarDecorationRotate?: number;
}

export interface ChatTheme {
    id: string;
    name: string;
    type: 'preset' | 'custom';
    user: BubbleStyle;
    ai: BubbleStyle;
    customCss?: string;
}

// --- Toast ---

export interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

// --- Gallery ---

export interface GalleryImage {
    id: string;
    charId: string;             // Always 'nova'
    url: string;
    timestamp: number;
    review?: string;
    reviewTimestamp?: number;
}

export interface ImageDetail {
    id: string;
    fileName: string;
    detail: string;
    source: 'user' | 'agent';
    relatedPath?: string;
    updatedAt: number;
}

export interface RelationEvent {
    id: string;
    type: 'user_nickname_changed' | 'agent_nickname_changed' | 'user_avatar_changed' | 'agent_avatar_changed' | 'couple_avatar_set' | 'agent_gallery_upload' | 'agent_gallery_send' | 'agent_file_send' | 'agent_voice_send' | 'agent_sticker_send' | 'user_sticker_send';
    actor: 'user' | 'agent' | 'system';
    summary: string;
    payload?: Record<string, any>;
    timestamp: number;
}

// --- Diary / Journal ---

export interface StickerData {
    id: string;
    url: string;
    x: number;
    y: number;
    rotation: number;
}

export interface DiaryPage {
    text: string;
    paperStyle: string;
    stickers: StickerData[];
}

export interface DiaryEntry {
    id: string;
    charId: string;             // Always 'nova'
    date: string;               // YYYY-MM-DD
    userPage: DiaryPage;
    charPage?: DiaryPage;
    timestamp: number;
    isArchived: boolean;
}

// --- Schedule App ---

export interface Task {
    id: string;
    title: string;
    tone: 'gentle' | 'strict' | 'tsundere';
    deadline?: string;          // YYYY-MM-DD
    isCompleted: boolean;
    completedAt?: number;
    createdAt: number;
}

export interface Anniversary {
    id: string;
    title: string;
    date: string;               // YYYY-MM-DD
    aiThought?: string;
    lastThoughtGeneratedAt?: number;
}

// --- Security Policy ---

export interface SecurityPolicy {
    allowReadWorkspace: boolean;
    allowWriteWorkspace: boolean;
    allowReadExternal: boolean;
    allowNativeAPIs: boolean;     // Camera, Mic, etc.
    notifyOnSensitive: boolean;
    allowGlobalFileAccess?: boolean; // Enable PC global file access bypass (ReAct Explorer)
}

// --- Full Backup ---

// --- Call System ---

export type CallState = 'idle' | 'dialing' | 'ringing' | 'connected' | 'thinking' | 'speaking';
export type CallDirection = 'user_outgoing' | 'agent_outgoing';
export type CallInputMode = 'voice' | 'text';

export type CallBubble = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: number;
    audioUrl?: string;
    audioDuration?: number;
    audioProgress?: number;
    streaming?: boolean;
};

export interface CallActions {
    onAccept: () => void;
    onDecline: () => void;
    onHangup: () => void;
    onCancelOutgoing: () => void;
    onToggleMute: () => void;
    onToggleInputMode: () => void;
    onSendText: () => void;
    onChangeInput: (val: string) => void;
}

export interface FullBackupData {
    timestamp: number;
    version: number;
    theme?: OSTheme;
    apiConfig?: APIConfig;
    apiPresets?: ApiPreset[];
    availableModels?: string[];
    customIcons?: Record<string, string>;
    agentProfile?: AgentProfile;
    messages?: Message[];
    customThemes?: ChatTheme[];
    savedEmojis?: { name: string, url: string }[];
    galleryImages?: GalleryImage[];
    imageDetails?: ImageDetail[];
    relationEvents?: RelationEvent[];
    userProfile?: UserProfile;
    diaries?: DiaryEntry[];
    tasks?: Task[];
    anniversaries?: Anniversary[];
    securityPolicy?: SecurityPolicy;
    cronJobs?: CronJob[];
    xhsActivities?: XhsActivityRecord[];
    xhsStockImages?: XhsStockImage[];
}
