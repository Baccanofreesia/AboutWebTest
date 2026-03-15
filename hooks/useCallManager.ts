import { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import {
    Message,
    CallState,
    CallDirection,
    CallBubble,
    CallActions,
    AgentProfile
} from '../types';
import { ContextBuilder } from '../utils/context';
import { useVoiceRecorder, VoiceRecordResult } from './useVoiceRecorder';
import { cleanTextForTts, synthesizeSpeech } from '../utils/ttsService';
import { transcribeWithFasterWhisper } from '../utils/asrService';
import { resolveApiEndpoint } from '../utils/apiResolver';

const AGENT_CALL_COOLDOWN_MS = 8 * 60 * 1000;
const DEFAULT_CALL_PAUSE_THRESHOLD = 800;
const DEFAULT_CALL_SEGMENT_DURATION = 12000;
const CALL_PAUSE_MIN = 200;
const CALL_PAUSE_MAX = 3000;
const CALL_SEGMENT_MIN = 4000;
const CALL_SEGMENT_MAX = 30000;
const USER_REPLY_DEBOUNCE_MS = 1200;
const VOICE_ACTIVITY_THRESHOLD = 0.06;

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
};

interface UseCallManagerProps {
    char: AgentProfile | undefined;
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    triggerAI: (history: Message[], autoTTS?: boolean) => void;
}

export const useCallManager = ({ char, messages, setMessages, triggerAI }: UseCallManagerProps) => {
    const {
        apiConfig,
        userProfile,
        activeApp,
        suspendCall,
        clearSuspendedCall,
        setCallState: setGlobalCallState,
        setCallDirection: setGlobalCallDirection,
        setShowCallOverlay: setGlobalShowCallOverlay,
        setCallInput: setGlobalCallInput,
        setCallInputMode: setGlobalCallInputMode,
        setCallElapsed: setGlobalCallElapsed,
        setCallMicMuted: setGlobalCallMicMuted,
        setCallMicActive: setGlobalCallMicActive,
        setCallVolumeLevel: setGlobalCallVolumeLevel,
        // ✅ FIX 1: 引入 OSContext 的 setCallBubbles，用于同步气泡到 CallOverlay
        setCallBubbles: setGlobalCallBubbles,
        registerCallActions
    } = useOS();

    // Internal States
    const [callState, setInternalCallState] = useState<CallState>('idle');
    const [callDirection, setInternalCallDirection] = useState<CallDirection | null>(null);
    const [callBubbles, setCallBubbles] = useState<CallBubble[]>([]);
    const [callSessionId, setCallSessionId] = useState('');
    const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
    const [callElapsed, setCallElapsed] = useState(0);
    const [callInputMode, setCallInputMode] = useState<'voice' | 'text'>('voice');
    const [callInput, setCallInput] = useState('');
    const [callMicMuted, setCallMicMuted] = useState(true);

    // Refs
    const callSessionIdRef = useRef('');
    const callActiveRef = useRef(false);
    const callStateRef = useRef<CallState>('idle');
    const callStartedAtRef = useRef<number | null>(null);
    const callBubblesRef = useRef<CallBubble[]>([]);
    const callDecisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callIncomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ringtoneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const callVoiceChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const agentCallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const agentCallIntentRef = useRef<number | null>(null);
    const agentGreetingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingReplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingReplyAfterAgentRef = useRef(false);
    const silenceNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callReplyAbortRef = useRef<AbortController | null>(null);
    const sendCallAssistantReplyRef = useRef<(history: CallBubble[]) => Promise<void>>(async () => { });
    const callAudioRef = useRef<HTMLAudioElement | null>(null);
    const currentAssistantBubbleRef = useRef<{ id: string, text: string, audioDuration?: number } | null>(null);
    const callVoiceRecorder = useVoiceRecorder();
    const { isRecording: callMicActive, volumeLevel: callVolumeLevel } = callVoiceRecorder;
    const callVoiceResultRef = useRef<Promise<VoiceRecordResult | null> | null>(null);
    const callVoiceCapturingRef = useRef(false);
    const userSpokeRef = useRef(false);
    const lastVoiceAtRef = useRef(0);
    const segmentStartAtRef = useRef(0);
    const hasSpeechRef = useRef(false);
    const lastAgentSpokeAtRef = useRef(0);
    const lastUserSpokeAtRef = useRef(0);
    const voiceProcessingRef = useRef(false);
    const followupProcessingRef = useRef<Record<string, boolean>>({});
    const lastCallAtRef = useRef(0);
    const callSuspendRef = useRef(false);

    const charDisplayName = char?.nickname || char?.name || 'Agent';
    const charDisplayAvatar = char?.displayAvatar || char?.avatar || '';
    const userDisplayName = userProfile.nickname || userProfile.name;
    const charRealName = char?.name || charDisplayName;
    const userRealName = userProfile.name || userDisplayName;
    const charNameLine = char?.nickname && char?.name && char.nickname !== char.name
        ? `你的昵称：${char.nickname}；真名：${char.name}。`
        : `你的名字：${charRealName}。`;
    const userNameLine = userProfile.nickname && userProfile.name && userProfile.nickname !== userProfile.name
        ? `用户昵称：${userProfile.nickname}；用户名字：${userProfile.name}。`
        : `用户名字：${userRealName}。`;
    const callInitiative = clampNumber(char?.callInitiative, 0, 1, 0.5);

    // --- Messaging Helpers ---

    // ✅ 只在通话结束后调用一次，通话过程中绝不调用
    const refreshMessages = useCallback(async () => {
        if (!char) return;
        const updated = await DB.getMessagesByCharId(char.id);
        setMessages(updated);
    }, [char, setMessages]);

    // ✅ 只写数据库，通话中不触发 setMessages
    const saveCallMessage = useCallback(async (role: 'user' | 'assistant', text: string, extra?: any, sessionOverride?: string) => {
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role,
            type: 'text',
            content: text,
            metadata: { source: 'call', callSessionId: sessionOverride || callSessionIdRef.current || callSessionId, ...(extra || {}) }
        });
    }, [char, callSessionId]);

    // ✅ 只写数据库，通话中不触发 setMessages
    const saveCallLog = useCallback(async (content: string, variant: string, sessionOverride?: string) => {
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content,
            metadata: { source: 'call-log', variant, callSessionId: sessionOverride || callSessionIdRef.current || callSessionId }
        });
    }, [char, callSessionId]);

    const buildCallKeepsakeLine = useCallback((bubbles: CallBubble[]) => {
        const assistantLine = [...bubbles].reverse().find(item => item.role === 'assistant' && item.text.trim());
        if (!assistantLine) return `这通电话我会悄悄收藏，下次也记得来找我。——${charDisplayName}`;
        const normalized = assistantLine.text.replace(/\s+/g, ' ').trim();
        const cutAt = normalized.search(/[。！？]/);
        const sentence = cutAt >= 0 ? normalized.slice(0, cutAt + 1) : normalized.slice(0, 42);
        const polished = sentence.length > 48 ? `${sentence.slice(0, 48)}…` : sentence;
        return `"${polished}" ——${charDisplayName}`;
    }, [charDisplayName]);

    // ✅ 接收 bubblesSnapshot 参数，不依赖 state
    const saveCallSummary = useCallback(async (durationSec: number, turnCount: number, bubblesSnapshot: CallBubble[]) => {
        if (!char) return;
        const keepsakeLine = buildCallKeepsakeLine(bubblesSnapshot);
        const mins = Math.floor(durationSec / 60);
        const secs = Math.floor(durationSec % 60);
        const durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const content = `通话结束 · ${charDisplayName} (${durationStr}, ${Math.max(1, turnCount)}轮对话)`;
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content,
            metadata: {
                source: 'call-end-popup',
                durationSec,
                turnCount: Math.max(1, turnCount),
                characterName: charDisplayName,
                characterAvatar: charDisplayAvatar,
                keepsakeLine,
                callSessionId: callSessionIdRef.current || callSessionId
            }
        });
    }, [char, charDisplayName, charDisplayAvatar, buildCallKeepsakeLine, callSessionId]);

    const canUseCallTts = useCallback(() => {
        if (!apiConfig?.ttsProvider || apiConfig.ttsProvider === 'none') return false;
        const vp = char?.voiceProfile;
        if (!vp?.voiceId && (!vp?.timberWeights || vp.timberWeights.length === 0)) return false;
        if (apiConfig.ttsProvider === 'minimax') return !!apiConfig.minimaxApiKey;
        if (apiConfig.ttsProvider === 'fish_speech') return !!apiConfig.fishSpeechBaseUrl;
        return false;
    }, [apiConfig, char]);

    const callScrollRef = useRef<HTMLDivElement>(null);

    const callBusy = ['thinking', 'speaking'].includes(callState);
    const callStatusLabel = callState === 'idle' ? '' :
        callState === 'dialing' ? '正在拨号...' :
            callState === 'ringing' ? '正在呼入...' :
                callState === 'thinking' ? '对方正在思考...' :
                    callState === 'speaking' ? '对方正在发言...' : '通话中';

    const pauseThresholdMs = clampNumber(apiConfig?.callPauseThreshold, CALL_PAUSE_MIN, CALL_PAUSE_MAX, DEFAULT_CALL_PAUSE_THRESHOLD);
    const segmentDurationMs = clampNumber(apiConfig?.callSegmentDuration, CALL_SEGMENT_MIN, CALL_SEGMENT_MAX, DEFAULT_CALL_SEGMENT_DURATION);

    // ✅ FIX 2: updateCallBubbles 同时同步到 OSContext，让 CallOverlay 能收到气泡
    const updateCallBubbles = useCallback((updater: CallBubble[] | ((prev: CallBubble[]) => CallBubble[])) => {
        setCallBubbles(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            callBubblesRef.current = next;
            setGlobalCallBubbles(next); // ← 同步到 OSContext.callBubbles → CallOverlay
            return next;
        });
    }, [setGlobalCallBubbles]);

    const updateCallStartedAt = useCallback((val: number | null) => {
        callStartedAtRef.current = val;
        setCallStartedAt(val);
    }, []);

    const clearAgentGreeting = useCallback(() => {
        if (agentGreetingTimerRef.current) {
            clearTimeout(agentGreetingTimerRef.current);
            agentGreetingTimerRef.current = null;
        }
    }, []);

    const clearPendingReply = useCallback(() => {
        if (pendingReplyTimerRef.current) {
            clearTimeout(pendingReplyTimerRef.current);
            pendingReplyTimerRef.current = null;
        }
    }, []);

    const clearSilenceNudge = useCallback(() => {
        if (silenceNudgeTimerRef.current) {
            clearTimeout(silenceNudgeTimerRef.current);
            silenceNudgeTimerRef.current = null;
        }
    }, []);

    const abortCallReply = useCallback(() => {
        if (callReplyAbortRef.current) {
            callReplyAbortRef.current.abort();
            callReplyAbortRef.current = null;
        }
    }, []);



    // --- Synchronization ---
    useEffect(() => {
        callStateRef.current = callState;
        setGlobalCallState(callState);
    }, [callState, setGlobalCallState]);

    useEffect(() => {
        if (callDirection) setGlobalCallDirection(callDirection);
    }, [callDirection, setGlobalCallDirection]);

    useEffect(() => {
        setGlobalCallInput(callInput);
    }, [callInput, setGlobalCallInput]);

    useEffect(() => {
        setGlobalCallInputMode(callInputMode);
    }, [callInputMode, setGlobalCallInputMode]);

    useEffect(() => {
        setGlobalCallElapsed(callElapsed);
    }, [callElapsed, setGlobalCallElapsed]);

    useEffect(() => {
        setGlobalCallMicMuted(callMicMuted);
    }, [callMicMuted, setGlobalCallMicMuted]);

    useEffect(() => {
        setGlobalCallMicActive(callMicActive);
    }, [callMicActive, setGlobalCallMicActive]);

    useEffect(() => {
        setGlobalCallVolumeLevel(callVolumeLevel);
    }, [callVolumeLevel, setGlobalCallVolumeLevel]);

    // --- Audio Helpers ---
    const playRingtonePulse = useCallback((mode: 'incoming' | 'outgoing') => {
        try {
            const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const now = ctx.currentTime;
            osc.type = 'sine';
            osc.frequency.value = mode === 'incoming' ? 440 : 520;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.24);
            osc.onended = () => { try { ctx.close(); } catch { } };
        } catch { }
    }, []);


    const stopRingtone = useCallback(() => {
        if (ringtoneTimerRef.current) {
            clearInterval(ringtoneTimerRef.current);
            ringtoneTimerRef.current = null;
        }
    }, []);

    const startRingtone = useCallback((mode: 'incoming' | 'outgoing') => {
        stopRingtone();
        const intervalMs = mode === 'incoming' ? 1200 : 900;
        playRingtonePulse(mode);
        ringtoneTimerRef.current = setInterval(() => playRingtonePulse(mode), intervalMs);
    }, [playRingtonePulse, stopRingtone]);

    const stopCallAudio = useCallback(async (isInterrupted = false) => {
        const audio = callAudioRef.current;
        const bubble = currentAssistantBubbleRef.current;
        
        if (audio && bubble) {
            try {
                const src = audio.src;
                const currentTime = audio.currentTime;
                const duration = audio.duration || bubble.audioDuration || 0;
                
                audio.pause();
                audio.currentTime = 0;
                if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);

                if (isInterrupted && bubble.text) {
                    // Calculate how much was spoken
                    const ratio = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
                    const spokenLen = Math.floor(bubble.text.length * ratio);
                    
                    await saveCallMessage('assistant', bubble.text, {
                        interrupted: true,
                        spokenCharCount: spokenLen,
                        interpretation: `（用户在 Agent 说话说到一半时挂断了。Agent 原本打算说：“${bubble.text}”，但只说到了：“${bubble.text.slice(0, spokenLen)}”...）`
                    });
                }
            } catch (e) {
                console.error('[CallManager] stopCallAudio error:', e);
            }
        }
        
        callAudioRef.current = null;
        currentAssistantBubbleRef.current = null;
        if (callActiveRef.current) setInternalCallState('connected');
    }, [saveCallMessage]);

    const markUserSpoke = useCallback(() => {
        if (!userSpokeRef.current) userSpokeRef.current = true;
        clearAgentGreeting();
        clearSilenceNudge();
        clearPendingReply();
        lastUserSpokeAtRef.current = Date.now();
    }, [clearAgentGreeting, clearPendingReply, clearSilenceNudge]);

    // ✅ 仅内部调试/解释日志，不展示给用户（前端已过滤 call-internal-log）
    const saveCallInternalLog = useCallback(async (content: string, extra?: Record<string, any>) => {
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content,
            metadata: { source: 'call-internal-log', hidden: true, callSessionId: callSessionIdRef.current || callSessionId, ...(extra || {}) }
        });
    }, [char, callSessionId]);

    // --- Decision Logic ---
    const decideCallAccept = useCallback(() => {
        let prob = 0.78;
        const hour = new Date().getHours();
        if (hour >= 23 || hour <= 6) prob -= 0.25;
        if (hour >= 9 && hour <= 21) prob += 0.05;
        const persona = (char?.description || '').toLowerCase();
        if (/(内向|慢热|冷淡|高冷|被动|羞涩|社恐|安静)/i.test(persona)) prob -= 0.15;
        if (/(开朗|活泼|热情|粘人|主动|外向|话多|温柔)/i.test(persona)) prob += 0.1;
        if (Date.now() - lastCallAtRef.current < 15 * 60 * 1000) prob -= 0.2;
        return Math.random() < Math.min(Math.max(prob, 0.05), 0.95);
    }, [char]);

    const computeFollowupChance = useCallback((scenario: string, recentMsgs: Message[]) => {
        const base: Record<string, number> = { user_cancel: 0.45, agent_decline: 0.70, agent_cancel: 0.40, user_decline: 0.35 };
        let chance = base[scenario] ?? 0.4;
        const lastUserMsg = [...recentMsgs].reverse().find(m => m.role === 'user');
        const lastText = lastUserMsg?.type === 'voice' ? String(lastUserMsg.metadata?.transcription || '') : String(lastUserMsg?.content || '');
        if (lastText.length > 30) chance += 0.1;
        if (/(难过|焦虑|崩溃|想你|委屈|求你|生气|想见)/.test(lastText)) chance += 0.15;
        const hour = new Date().getHours();
        if (hour >= 23 || hour <= 6) chance -= 0.1;
        return Math.min(Math.max(chance, 0.05), 0.95);
    }, []);

    const decideAgentCall = useCallback((text: string) => {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            void saveCallInternalLog('[CallDecision] skip: empty_text');
            return false;
        }
        if (/(不要打|别打|不想打|别打电话|不接电话)/i.test(trimmed)) {
            void saveCallInternalLog('[CallDecision] skip: user_declined_call');
            return false;
        }
        if (callInitiative <= 0) {
            void saveCallInternalLog('[CallDecision] skip: callInitiative<=0');
            return false;
        }
        let score = 0.08;
        const signals: string[] = [];
        if (/(打电话|电话|语音|通话|听你|打给你|直接说)/i.test(trimmed)) score += 0.55;
        if (/(很急|马上|现在|快点|有急事|立刻)/i.test(trimmed)) score += 0.2;
        if (/(难过|焦虑|崩溃|孤独|想你|委屈|失眠)/i.test(trimmed)) score += 0.12;
        if (trimmed.length >= 120) score += 0.1;
        if (/(打电话|电话|语音|通话|听你|打给你|直接说)/i.test(trimmed)) signals.push('phone_intent');
        if (/(很急|马上|现在|快点|有急事|立刻)/i.test(trimmed)) signals.push('urgency');
        if (/(难过|焦虑|崩溃|孤独|想你|委屈|失眠)/i.test(trimmed)) signals.push('emotion');
        if (trimmed.length >= 120) signals.push('long_text');
        const hour = new Date().getHours();
        if (hour >= 23 || hour <= 7) {
            score -= 0.12;
            signals.push('late_hour');
        }
        const scaled = score * (0.4 + callInitiative * 1.2);
        const threshold = Math.min(Math.max(scaled, 0.02), 0.8);
        const roll = Math.random();
        const decision = roll < threshold;
        void saveCallInternalLog(`[CallDecision] decision=${decision} score=${score.toFixed(3)} scaled=${scaled.toFixed(3)} threshold=${threshold.toFixed(3)} roll=${roll.toFixed(3)} signals=${signals.join(',') || 'none'}`);
        return decision;
    }, [callInitiative, saveCallInternalLog]);


    useEffect(() => {
        if (callScrollRef.current) {
            callScrollRef.current.scrollTop = callScrollRef.current.scrollHeight;
        }
    }, [callBubbles.length, callState]);

    const maybeSendAgentFollowup = useCallback(async (sessionId: string, scenario: 'user_cancel' | 'agent_decline' | 'agent_cancel' | 'user_decline') => {
        if (!char || !sessionId) return;
        const key = `${sessionId}-${scenario}`;
        if (followupProcessingRef.current[key]) return;
        followupProcessingRef.current[key] = true;

        const chance = computeFollowupChance(scenario, messages);
        if (Math.random() > chance) {
            delete followupProcessingRef.current[key];
            return;
        }

        const recentMessages = messages.slice(-6).filter(m => m.role !== 'system');
        const contextSnippet = recentMessages.map(m => {
            const sender = m.role === 'user' ? userDisplayName : charDisplayName;
            const body = m.type === 'voice' ? `[语音] ${m.metadata?.transcription || ''}` : (m.content || '').slice(0, 60);
            return `${sender}: ${body}`;
        }).join('\n');

        let hint = '';
        if (scenario === 'user_cancel') hint = `（事实：${userDisplayName}去电，你是被叫；接通：未接通；动作：${userDisplayName}在你接听前取消。结合你的人设与上下文语境自然措辞，发一条简短消息。）`;
        else if (scenario === 'agent_decline') hint = `（事实：${userDisplayName}去电，你是被叫；接通：未接通；动作：你没有接听（拒接/未接）。可根据你的人设与上下文决定是否解释。）`;
        else if (scenario === 'agent_cancel') hint = `（事实：你去电，你是主叫；接通：未接通；动作：${userDisplayName}未接（不是你取消）。结合你的人设与上下文语境，自然给${userDisplayName}发一条消息。）`;
        else if (scenario === 'user_decline') hint = `（事实：你去电，你是主叫；接通：未接通；动作：${userDisplayName}拒接。结合人设与语境，发一条理解或询问的消息。）`;

        const fullHint = `（系统内部提示，不要输出这段内容本身：\n你是${charDisplayName}。\n${charNameLine}\n${userNameLine}\n${hint}\n规则：严禁混淆来电/去电与动作归属，不要把对方的拒接说成你的拒接，或把你的取消说成对方取消。只写消息正文，不写舞台指示。\n 要求：必须结合你的人设、与对方的关系和最近对话来措辞，称呼可根据亲密度。\n最近对话：\n${contextSnippet || '（无）'}\n不超过两句话。）`;

        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: fullHint,
            metadata: { source: 'call-followup-hint', callSessionId: sessionId, scenario }
        });

        // followup 在通话结束后，此时刷新 messages 安全
        const updated = await DB.getMessagesByCharId(char.id);
        setMessages(updated);
        triggerAI(updated, false);

        setTimeout(() => { delete followupProcessingRef.current[key]; }, 5000);
    }, [char, userDisplayName, charDisplayName, charNameLine, userNameLine, computeFollowupChance, messages, setMessages, triggerAI]);

    // --- AI Logic ---
    const buildCallSystemPrompt = useCallback(() => {
        if (!char) return '';
        const core = ContextBuilder.buildCoreContext(char, userProfile);
        const timeHint = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', weekday: 'short' });
        const directionHint = callDirection === 'user_outgoing'
            ? `你主动拨给了${userDisplayName}`
            : callDirection === 'agent_outgoing'
                ? `${userDisplayName}主动拨给你`
                : '电话方向未知';
        const roleHint = callDirection === 'user_outgoing'
            ? '你是主叫，对方为被叫'
            : callDirection === 'agent_outgoing'
                ? '你是被叫，对方为主叫'
                : '主叫/被叫未知';
        const statusHint = callState === 'connected'
            ? '通话已接通'
            : callState === 'dialing'
                ? '你正在拨出，尚未接通'
                : callState === 'ringing'
                    ? '对方向你拨入，尚未接通'
                    : '当前未在通话中';
        return `${core}\n\n### 电话模式 (Call Mode)\n你是${charDisplayName}，电话那头是${userDisplayName}。\n${charNameLine}\n${userNameLine}\n方向：${directionHint}；角色：${roleHint}；状态：${statusHint}。\n这是一通真实电话，你能听到对方的呼吸、语气、停顿。\n当前时间提示：${timeHint}\n要求：只输出你在电话里会说出口的话。口语化、简短、有停顿感。不要输出舞台指示。不要总是以“喂”开头，仅在自然需要时使用。始终依据人设、关系与最近对话来选词与称呼。额外规则：严格区分来电/去电与动作归属，不要颠倒“谁拨出、谁拒接、谁取消”。不要臆造未发生的事件。DO NOT USE any Emojis, Stickers, Emoticons, Em-dash, Links, URLs, or special markdown.`;
    }, [char, charDisplayName, userDisplayName, userProfile, callDirection, charNameLine, userNameLine, callState]);

    const sanitizeCallText = useCallback((raw: string) => {
        if (!raw) return '';
        return raw
            .replace(/<\s*\/?\s*(?:语音|語音)\s*>/gi, '')
            .replace(/^\s*\[(?:通话|聊天|系统)[^\]]*\]\s*/gim, '')
            .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/gm, '')
            .replace(/\[(?:你|用户|User|Assistant)\s*发送了语音消息\s*\d+(?:\.\d+)?\s*秒[^\]]*\]\s*[:：]?[^\n]*/gi, '')
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/\bwww\.[^\s]+/gi, '')
            .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }, []);

    const requestCallReply = useCallback(async (history: CallBubble[]) => {
        if (!apiConfig?.baseUrl || !char) return '';
        const controller = new AbortController();
        callReplyAbortRef.current = controller;
        const resolved = resolveApiEndpoint(apiConfig);
        const systemPrompt = buildCallSystemPrompt();
        const callMessages = history
            .slice(-24)
            .map(h => ({ role: h.role, content: (h.text || '').trim() }))
            .filter(m => m.content.length > 0);
        if (callMessages.length === 0) {
            callMessages.push({ role: 'user', content: '电话已接通，请自然开场。' });
        }

        const chatExtractResponseText = (data: any): string => {
            return data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.delta?.content?.trim() || data?.choices?.[0]?.text?.trim() || data?.content?.[0]?.text?.trim() || data?.reply?.trim() || data?.output_text?.trim() || '';
        };

        // ✅ FIX 5: max_tokens 是 Anthropic 协议必填字段（minimax_coding / minimax 等 source 需要）
        let body: any = { model: apiConfig.model, messages: [{ role: 'system', content: systemPrompt }, ...callMessages], temperature: 0.8, max_tokens: 1024, stream: false };
        if (resolved.transformBody) body = resolved.transformBody(body);
        try {
            const res = await fetch(resolved.chatUrl, { method: 'POST', headers: resolved.headers, body: JSON.stringify(body), signal: controller.signal });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.error(`[CallManager] requestCallReply API Error ${res.status}:`, errText.slice(0, 300));
                return '';
            }
            const data = await res.json();
            return chatExtractResponseText(data);
        } catch (err: any) {
            if (controller.signal.aborted) return '';
            console.error('[CallManager] requestCallReply failed:', err);
            return '';
        } finally {
            if (callReplyAbortRef.current === controller) {
                callReplyAbortRef.current = null;
            }
        }
    }, [apiConfig, char, buildCallSystemPrompt]);

    const scheduleSilenceNudge: () => void = useCallback(() => {
        clearSilenceNudge();
        const delay = 12000 + Math.floor(Math.random() * 10000);
        const agentSpokeAt = lastAgentSpokeAtRef.current;
        silenceNudgeTimerRef.current = setTimeout(() => {
            silenceNudgeTimerRef.current = null;
            if (!callActiveRef.current || callStateRef.current === 'idle') return;
            if (lastUserSpokeAtRef.current > agentSpokeAt) return;
            const nudgePrompt = '（对方沉默了一会儿。请结合你的人设、关系和最近对话，自然追问或换话题，不必刻意温和，也不要总以“喂”开头。）';
            sendCallAssistantReplyRef.current([{ id: 'call-nudge', role: 'user', text: nudgePrompt, timestamp: Date.now() }]);
        }, delay);
    }, [clearSilenceNudge]);

    const sendCallAssistantReply: (history: CallBubble[]) => Promise<void> = useCallback(async (history: CallBubble[]) => {
        if (!char || !callActiveRef.current) return;
        try {
            clearSilenceNudge();
            setInternalCallState('thinking');
            const raw = await requestCallReply(history);
            if (!callActiveRef.current) return;
            const cleaned = sanitizeCallText(raw);
            if (!cleaned) {
                setInternalCallState('connected');
                if (pendingReplyAfterAgentRef.current) {
                    pendingReplyAfterAgentRef.current = false;
                    const latestBubbles = [...callBubblesRef.current];
                    sendCallAssistantReplyRef.current(latestBubbles);
                }
                return;
            }

            const finalizeAgentTurn = () => {
                if (!callActiveRef.current) return;
                setInternalCallState('connected');
                lastAgentSpokeAtRef.current = Date.now();
                if (pendingReplyAfterAgentRef.current) {
                    pendingReplyAfterAgentRef.current = false;
                    const latestBubbles = [...callBubblesRef.current];
                    sendCallAssistantReplyRef.current(latestBubbles);
                    return;
                }
                scheduleSilenceNudge();
            };

            const bubble: CallBubble = {
                id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: 'assistant',
                text: cleaned,
                timestamp: Date.now(),
                streaming: true
            };
            // ✅ 先更新气泡 UI（同时同步到 OSContext），再异步写库
            updateCallBubbles(prev => [...prev, bubble]);

            let audioBlob: Blob | null = null;
            try {
                if (canUseCallTts()) {
                    const ttsText = cleanTextForTts(cleaned);
                    if (ttsText) audioBlob = await synthesizeSpeech(ttsText, char, apiConfig);
                }
            } catch { }

            if (!callActiveRef.current) return;

            if (audioBlob) {
                // 有 TTS：播放音频，playing 期间保持 speaking 状态
                const url = URL.createObjectURL(audioBlob);
                updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioUrl: url, audioProgress: 0 } : b));
                const audio = new Audio(url);
                callAudioRef.current = audio;
                audio.onloadedmetadata = () => {
                    updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioDuration: audio.duration } : b));
                };
                audio.ontimeupdate = () => {
                    updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioProgress: audio.currentTime } : b));
                };
                audio.onended = () => {
                    URL.revokeObjectURL(url);
                    if (callAudioRef.current === audio) {
                        callAudioRef.current = null;
                        currentAssistantBubbleRef.current = null;
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioProgress: audio.duration, streaming: false } : b));
                        if (callActiveRef.current) {
                            saveCallMessage('assistant', cleaned);
                            finalizeAgentTurn();
                        }
                    }
                };
                audio.onpause = () => {
                    // Logic moved to stopCallAudio for better control on hangup
                    if (callAudioRef.current === audio) {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, streaming: false } : b));
                    }
                };
                currentAssistantBubbleRef.current = { id: bubble.id, text: cleaned };
                await audio.play();
                setInternalCallState('speaking');
            } else {
                // ✅ 无 TTS 时按文字长度模拟阅读时间
                setInternalCallState('speaking');
                currentAssistantBubbleRef.current = { id: bubble.id, text: cleaned };
                const readDuration = Math.min(Math.max(cleaned.length * 60, 1200), 6000);
                const startAt = Date.now();
                
                await new Promise(r => {
                    const timer = setTimeout(r, readDuration);
                    // If hangup happens, stopCallAudio will clear currentAssistantBubbleRef
                    // and let this promise resolve or be ignored.
                });
                
                if (callActiveRef.current && currentAssistantBubbleRef.current?.id === bubble.id) {
                    currentAssistantBubbleRef.current = null;
                    updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, streaming: false } : b));
                    saveCallMessage('assistant', cleaned);
                    finalizeAgentTurn();
                }
            }
        } catch {
            setInternalCallState('connected');
            if (pendingReplyAfterAgentRef.current) {
                pendingReplyAfterAgentRef.current = false;
                const latestBubbles = [...callBubblesRef.current];
                sendCallAssistantReplyRef.current(latestBubbles);
            }
        }
    }, [char, apiConfig, canUseCallTts, requestCallReply, sanitizeCallText, saveCallMessage, updateCallBubbles, scheduleSilenceNudge, clearSilenceNudge]);

    useEffect(() => {
        sendCallAssistantReplyRef.current = sendCallAssistantReply;
    }, [sendCallAssistantReply]);

    const scheduleAgentGreeting = useCallback((connectedAt: number) => {
        clearAgentGreeting();
        userSpokeRef.current = false;
        const delay = 1000 + Math.floor(Math.random() * 1000);
        agentGreetingTimerRef.current = setTimeout(async () => {
            agentGreetingTimerRef.current = null;
            if (!callActiveRef.current) return;
            if (callStateRef.current === 'idle' || callStateRef.current === 'dialing' || callStateRef.current === 'ringing') return;
            const hasUserBubble = callBubblesRef.current.some(b => b.role === 'user' && b.timestamp >= connectedAt - 200);
            if (userSpokeRef.current || hasUserBubble) return;
            const greetingPrompt = '（电话刚接通，对方还没说话。你自然地开场，根据你的人设和上下文语境，简短口语。）';
            await sendCallAssistantReply([{ id: 'call-greet', role: 'user', text: greetingPrompt, timestamp: Date.now() }]);
        }, delay);
    }, [clearAgentGreeting, sendCallAssistantReply]);

    const scheduleAssistantReply = useCallback(() => {
        clearPendingReply();
        pendingReplyTimerRef.current = setTimeout(async () => {
            pendingReplyTimerRef.current = null;
            const currentState = callStateRef.current;
            if (!callActiveRef.current || currentState === 'idle') return;
            if (currentState === 'thinking' || currentState === 'speaking') {
                pendingReplyAfterAgentRef.current = true;
                return;
            }
            const latestBubbles = [...callBubblesRef.current];
            await sendCallAssistantReply(latestBubbles);
        }, USER_REPLY_DEBOUNCE_MS);
    }, [clearPendingReply, sendCallAssistantReply]);

    const sendCallUserText = useCallback(async (text: string, extra?: any) => {
        if (!char || !callActiveRef.current) return;
        if (!text.trim()) return;
        markUserSpoke();

        const userBubble: CallBubble = {
            id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: 'user',
            text: text.trim(),
            timestamp: Date.now(),
            streaming: extra?.via === 'voice'
        };
        // ✅ 先更新气泡 UI（同时同步到 OSContext），再异步写库
        updateCallBubbles(prev => [...prev, userBubble]);
        saveCallMessage('user', userBubble.text, extra);
        scheduleAssistantReply();
    }, [char, markUserSpoke, saveCallMessage, updateCallBubbles, scheduleAssistantReply]);

    // --- Voice Recording ---
    const stopCallVoiceCapture = useCallback(async (sendText: boolean) => {
        if (!callVoiceCapturingRef.current) return;
        callVoiceCapturingRef.current = false;
        if (voiceProcessingRef.current) return;
        voiceProcessingRef.current = true;
        if (callVoiceChunkTimerRef.current) { clearTimeout(callVoiceChunkTimerRef.current); callVoiceChunkTimerRef.current = null; }
        callVoiceRecorder.stopRecording();
        try {
            const result = await callVoiceResultRef.current;
            if (!sendText || !result) return;
            if (!callActiveRef.current || callState === 'idle' || callMicMuted) return;
            const asrResult = await transcribeWithFasterWhisper(result.blob);
            const transcription = (asrResult?.text || '').trim();
            if (!transcription) return;
            await sendCallUserText(transcription, { via: 'voice', duration: result.duration || 0, emotion: asrResult?.emotion });
        } finally {
            voiceProcessingRef.current = false;
        }
    }, [callVoiceRecorder, callState, callMicMuted, sendCallUserText]);

    const startCallVoiceCapture = useCallback(async () => {
        if (callVoiceCapturingRef.current) return;
        if (voiceProcessingRef.current) return;
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) return;
        callVoiceCapturingRef.current = true;
        segmentStartAtRef.current = Date.now();
        lastVoiceAtRef.current = 0;
        hasSpeechRef.current = false;
        callVoiceResultRef.current = callVoiceRecorder.startRecording();
        callVoiceResultRef.current?.then((res) => {
            if (!res && callVoiceCapturingRef.current) {
                callVoiceCapturingRef.current = false;
            }
        });
        if (callVoiceChunkTimerRef.current) clearTimeout(callVoiceChunkTimerRef.current);
        callVoiceChunkTimerRef.current = setTimeout(async () => {
            await stopCallVoiceCapture(true);
        }, segmentDurationMs);
    }, [callState, callMicMuted, callVoiceRecorder, segmentDurationMs, stopCallVoiceCapture]);

    useEffect(() => {
        if (!callVoiceCapturingRef.current || callMicMuted || callState === 'idle') return;
        const now = Date.now();
        if (callVolumeLevel > VOICE_ACTIVITY_THRESHOLD) {
            lastVoiceAtRef.current = now;
            hasSpeechRef.current = true;
            markUserSpoke();
        }
        const segmentElapsed = segmentStartAtRef.current ? (now - segmentStartAtRef.current) : 0;
        if (hasSpeechRef.current) {
            if (lastVoiceAtRef.current && (now - lastVoiceAtRef.current) >= pauseThresholdMs) {
                stopCallVoiceCapture(true);
            } else if (segmentElapsed >= segmentDurationMs) {
                stopCallVoiceCapture(true);
            }
        } else if (segmentElapsed >= segmentDurationMs) {
            stopCallVoiceCapture(false);
        }
    }, [callVolumeLevel, callMicMuted, callState, markUserSpoke, pauseThresholdMs, segmentDurationMs, stopCallVoiceCapture]);

    // --- Core Actions ---
    const startCall = useCallback(async () => {
        if (!char || callState !== 'idle') return;
        pendingReplyAfterAgentRef.current = false;
        stopCallAudio();
        clearSuspendedCall();
        const sessionId = `call-${Date.now()}`;
        lastCallAtRef.current = Date.now();
        callActiveRef.current = true;
        callSessionIdRef.current = sessionId;
        setCallSessionId(sessionId);
        setInternalCallDirection('user_outgoing');
        updateCallBubbles([]);
        setCallInput('');
        setCallInputMode('voice');
        updateCallStartedAt(null);
        setCallElapsed(0);
        setCallMicMuted(true);
        setInternalCallState('dialing');
        setGlobalShowCallOverlay(true);
        startRingtone('outgoing');
        const delay = 800 + Math.floor(Math.random() * 1600);
        callDecisionTimerRef.current = setTimeout(async () => {
            stopRingtone();
            if (!callActiveRef.current) return;
            const accept = decideCallAccept();
            if (!accept) {
                callActiveRef.current = false;
                setGlobalShowCallOverlay(false);
                setInternalCallState('idle');
                setInternalCallDirection(null);
                await saveCallLog('对方已拒绝', 'declined', sessionId);
                await maybeSendAgentFollowup(sessionId, 'agent_decline');
                return;
            }
            setInternalCallState('connected');
            const connectedAt = Date.now();
            updateCallStartedAt(connectedAt);
            setCallElapsed(0);
            // ✅ FIX 4: 接通时不写聊天界面气泡，只在挂断后写摘要卡片
            // await saveCallLog('通话已接通', 'connected', sessionId);
            scheduleAgentGreeting(connectedAt);
        }, delay);
    }, [char, callState, stopCallAudio, clearSuspendedCall, setGlobalShowCallOverlay, startRingtone, stopRingtone, decideCallAccept, saveCallLog, maybeSendAgentFollowup, scheduleAgentGreeting, updateCallBubbles, updateCallStartedAt]);

    const startAgentCall = useCallback(async () => {
        if (!char || callState !== 'idle') return;
        pendingReplyAfterAgentRef.current = false;
        stopCallAudio();
        clearSuspendedCall();
        const sessionId = `call-${Date.now()}`;
        lastCallAtRef.current = Date.now();
        callActiveRef.current = false;
        callSessionIdRef.current = sessionId;
        setCallSessionId(sessionId);
        setInternalCallDirection('agent_outgoing');
        updateCallBubbles([]);
        setCallInput('');
        setCallInputMode('voice');
        updateCallStartedAt(null);
        setCallElapsed(0);
        setCallMicMuted(true);
        setInternalCallState('ringing');
        setGlobalShowCallOverlay(true);
        startRingtone('incoming');
        const ringTimeout = 12000 + Math.floor(Math.random() * 8000);
        callIncomingTimerRef.current = setTimeout(async () => {
            if (callActiveRef.current) return;
            if (callSessionIdRef.current !== sessionId) return;
            await hangup();
        }, ringTimeout);
    }, [char, callState, stopCallAudio, clearSuspendedCall, setGlobalShowCallOverlay, startRingtone]);

    const acceptIncomingCall = useCallback(async () => {
        if (!char || callDirection !== 'agent_outgoing' || callState !== 'ringing') return;
        stopRingtone();
        if (callIncomingTimerRef.current) { clearTimeout(callIncomingTimerRef.current); callIncomingTimerRef.current = null; }
        pendingReplyAfterAgentRef.current = false;
        callActiveRef.current = true;
        setInternalCallState('connected');
        const connectedAt = Date.now();
        updateCallStartedAt(connectedAt);
        setCallElapsed(0);
        // ✅ FIX 4 同上: 接通时不写聊天界面气泡
        // await saveCallLog('通话已接通', 'connected', callSessionIdRef.current || callSessionId);
        scheduleAgentGreeting(connectedAt);
    }, [char, callDirection, callState, stopRingtone, scheduleAgentGreeting, updateCallStartedAt]);

    const hangup = useCallback(async () => {
        const wasActive = callActiveRef.current;
        const stateAtHangup = callState;
        const sessionId = callSessionIdRef.current || callSessionId;
        const directionAtHangup = callDirection;
        // ✅ 从 ref 读取气泡和开始时间，不依赖 state
        const bubblesSnapshot = callBubblesRef.current;
        const startedAt = callStartedAtRef.current;

        callActiveRef.current = false;
        pendingReplyAfterAgentRef.current = false;
        clearAgentGreeting();
        userSpokeRef.current = false;
        voiceProcessingRef.current = false;
        callVoiceCapturingRef.current = false;
        clearPendingReply();
        clearSilenceNudge();
        abortCallReply();
        stopRingtone();
        await stopCallAudio(stateAtHangup === 'speaking');
        if (callDecisionTimerRef.current) { clearTimeout(callDecisionTimerRef.current); callDecisionTimerRef.current = null; }
        if (callIncomingTimerRef.current) { clearTimeout(callIncomingTimerRef.current); callIncomingTimerRef.current = null; }
        await stopCallVoiceCapture(false);
        setGlobalShowCallOverlay(false);
        setInternalCallState('idle');
        setInternalCallDirection(null);
        setCallMicMuted(true);
        callSessionIdRef.current = '';
        clearSuspendedCall();

        const wasConnected = wasActive && !!startedAt;
        if (wasConnected) {
            const duration = Math.floor((Date.now() - (startedAt || Date.now())) / 1000);
            await saveCallSummary(duration, bubblesSnapshot.filter(b => b.role === 'user').length, bubblesSnapshot);
            await saveCallLog(`通话结束 (${duration}s)`, 'ended', sessionId);
        } else {
            const scenarioMap: any = { agent_outgoing: 'user_cancel', user_outgoing: 'agent_cancel' };
            const scenario = stateAtHangup === 'ringing' ? 'user_decline' : (stateAtHangup === 'dialing' ? 'agent_decline' : (directionAtHangup ? scenarioMap[directionAtHangup] : 'agent_cancel'));
            await saveCallLog('通话已结束', 'canceled', sessionId);
            await maybeSendAgentFollowup(sessionId, scenario);
        }

        // ✅ 通话完全结束后统一刷新一次 messages
        await refreshMessages();

        updateCallBubbles([]);
        updateCallStartedAt(null);
        setCallElapsed(0);
    }, [callState, callSessionId, callDirection, clearAgentGreeting, clearPendingReply, clearSilenceNudge, abortCallReply, stopRingtone, stopCallAudio, stopCallVoiceCapture, setGlobalShowCallOverlay, clearSuspendedCall, saveCallSummary, saveCallLog, refreshMessages, maybeSendAgentFollowup, updateCallBubbles, updateCallStartedAt]);

    const toggleMute = useCallback(() => {
        setCallMicMuted(prev => !prev);
    }, []);

    // --- Life Cycle Management ---
    useEffect(() => {
        const actions: CallActions = {
            onAccept: acceptIncomingCall,
            onDecline: hangup,
            onHangup: hangup,
            onCancelOutgoing: hangup,
            onToggleMute: toggleMute,
            onToggleInputMode: () => setCallInputMode(prev => prev === 'voice' ? 'text' : 'voice'),
            onSendText: () => {
                if (callInput.trim()) {
                    sendCallUserText(callInput.trim());
                    setCallInput('');
                }
            },
            onChangeInput: setCallInput
        };
        registerCallActions(actions);
    }, [acceptIncomingCall, hangup, toggleMute, sendCallUserText, registerCallActions, callInput]);

    useEffect(() => {
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) {
            stopCallVoiceCapture(true);
        } else {
            startCallVoiceCapture();
        }
    }, [callState, callMicMuted, startCallVoiceCapture, stopCallVoiceCapture]);

    useEffect(() => {
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) return;
        if (!callMicActive && !callVoiceCapturingRef.current && !voiceProcessingRef.current) {
            startCallVoiceCapture();
        }
    }, [callMicActive, callMicMuted, callState, startCallVoiceCapture]);

    useEffect(() => {
        if (callState === 'idle') return;
        if (activeApp !== 'chat') {
            if (!callSuspendRef.current) {
                suspendCall({ charId: char?.id || '', charName: charDisplayName, charAvatar: charDisplayAvatar, startedAt: callStartedAtRef.current || Date.now() });
                callSuspendRef.current = true;
            }
        } else if (callSuspendRef.current) {
            clearSuspendedCall();
            callSuspendRef.current = false;
        }
    }, [activeApp, callState, char, charDisplayName, charDisplayAvatar, suspendCall, clearSuspendedCall]);

    useEffect(() => {
        if (!char || callState !== 'idle') return;
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'user' || last.metadata?.source === 'call') return;
        if (Date.now() - lastCallAtRef.current < AGENT_CALL_COOLDOWN_MS) return;
        const text = last.type === 'voice' ? (last.metadata?.transcription || '') : (last.content || '');
        if (!decideAgentCall(text)) return;
        if (agentCallIntentRef.current === last.id) return;

        if (agentCallTimerRef.current) clearTimeout(agentCallTimerRef.current);
        agentCallIntentRef.current = last.id;
        agentCallTimerRef.current = setTimeout(() => {
            if (agentCallIntentRef.current === last.id && callState === 'idle') startAgentCall();
        }, 1200 + Math.floor(Math.random() * 1800));
    }, [messages, callState, char, decideAgentCall, startAgentCall]);

    // ✅ 计时器在通话全过程（connected / thinking / speaking）保持更新
    useEffect(() => {
        if (callState === 'idle' || !callStartedAt) return;
        const tick = () => setCallElapsed(Math.floor((Date.now() - callStartedAt) / 1000));
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [callState, callStartedAt]);

    return {
        callState, callDirection, callBubbles, callElapsed, callInputMode, setCallInputMode,
        callInput, setCallInput, callMicMuted, setCallMicMuted, callStartedAt, callBusy, callStatusLabel,
        callScrollRef,
        callMicActive,
        callVolumeLevel,
        toggleMute, startCall, acceptIncomingCall, hangup, sendCallUserText
    };
};
