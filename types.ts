
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
    category: 'about_nova' | 'user_profile' | 'relationship_core';
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
