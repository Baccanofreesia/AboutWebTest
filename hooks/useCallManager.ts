﻿import { useState, useEffect, useRef, useCallback } from 'react';
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
import { ChatParser } from '../utils/chatParser';
import { useVoiceRecorder, VoiceRecordResult } from './useVoiceRecorder';
import { cleanTextForTts, synthesizeSpeech } from '../utils/ttsService';
import { transcribeWithByteDance, transcribeWithByteDanceFile, transcribeWithFasterWhisper } from '../utils/asrService';
import { resolveApiEndpoint } from '../utils/apiResolver';

const AGENT_CALL_COOLDOWN_MS = 25 * 60 * 1000;
const DEFAULT_CALL_PAUSE_THRESHOLD = 800;
const DEFAULT_CALL_SEGMENT_DURATION = 12000;
const CALL_PAUSE_MIN = 200;
const CALL_PAUSE_MAX = 3000;
const CALL_SEGMENT_MIN = 4000;
const CALL_SEGMENT_MAX = 30000;
const USER_REPLY_DEBOUNCE_MS = 1200;
const VOICE_ACTIVITY_THRESHOLD = 0.03;
const WEB_SPEECH_MIN_DB = -60;
const WEB_SPEECH_MAX_DB = 0;

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
};

const dbToLinear = (db: number) => Math.pow(10, db / 20);

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
        // FIX 1: 引入 OSContext 的 setCallBubbles，用于同步气泡到 CallOverlay
        setCallBubbles: setGlobalCallBubbles,
        registerCallActions,
        addToast
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
    const callMicMutedRef = useRef(callMicMuted);

    // Refs
    const callSessionIdRef = useRef('');
    const callActiveRef = useRef(false);
    const callStateRef = useRef<CallState>('idle');
    const callDirectionRef = useRef<CallDirection | null>(null);
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
    const callVolumeLevelRef = useRef(0);
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
    const speechDetectorRef = useRef<any>(null);
    const speechDetectorActiveRef = useRef(false);
    const speechDetectorWantedRef = useRef(false);
    const pendingUserBubbleIdRef = useRef<string | null>(null);
    const lastAsrToastAtRef = useRef(0);
    const webSpeechRef = useRef<any>(null);
    const webSpeechActiveRef = useRef(false);
    const webSpeechWantedRef = useRef(false);
    const webSpeechBufferRef = useRef('');
    const webSpeechInterimRef = useRef('');
    const webSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const webSpeechLastResultAtRef = useRef(0);

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
    const rawCallInitiative = Number(char?.callInitiative);
    const normalizedCallInitiative = Number.isFinite(rawCallInitiative) && rawCallInitiative > 1
        ? rawCallInitiative / 100
        : rawCallInitiative;
    const callInitiative = clampNumber(normalizedCallInitiative, 0, 1, 0.5);

    useEffect(() => {
        callMicMutedRef.current = callMicMuted;
    }, [callMicMuted]);

    useEffect(() => {
        callVolumeLevelRef.current = callVolumeLevel;
    }, [callVolumeLevel]);

    // --- Messaging Helpers ---

    // 只在通话结束后调用一次，通话过程中绝不调用
    const refreshMessages = useCallback(async () => {
        if (!char) return;
        const updated = await DB.getMessagesByCharId(char.id);
        setMessages(updated);
    }, [char, setMessages]);

    // 只写数据库，通话中不触发 setMessages
    const saveCallMessage = useCallback(async (
        role: 'user' | 'assistant',
        text: string,
        extra?: any,
        sessionOverride?: string,
    ) => {
        if (!char) return;

        // 把 extra 里可能携带的 source 字段重命名为 via_source，
        // 确保 metadata.source 永远是 'call'，不会被外部覆盖。
        const { source: extraSource, ...restExtra } = extra || {};

        await DB.saveMessage({
            charId: char.id,
            role,
            type: 'text',
            content: text,
            metadata: {
                ...restExtra,
                ...(extraSource ? { via_source: extraSource } : {}), // 保留原始来源供调试
                source: 'call',                                       // 固定，不可被覆盖
                callSessionId: sessionOverride || callSessionIdRef.current || callSessionId,
            },
        });
    }, [char, callSessionId]);

    // 只写数据库，通话中不触发 setMessages
    const saveCallLog = useCallback(async (content: string, variant: string, sessionOverride?: string) => {
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content,
            metadata: {
                source: 'call-log',
                variant,
                // Who called whom: 'user_outgoing' = user dialled agent, 'agent_outgoing' = agent dialled user
                direction: callDirectionRef.current ?? null,
                initiator: callDirectionRef.current === 'user_outgoing' ? 'user' : callDirectionRef.current === 'agent_outgoing' ? 'agent' : null,
                callSessionId: sessionOverride || callSessionIdRef.current || callSessionId,
            }
        });
    }, [char, callSessionId]);

    const buildCallKeepsakeLine = useCallback((bubbles: CallBubble[]) => {
        const assistantLine = [...bubbles].reverse().find(item => item.role === 'assistant' && item.text.trim());
        if (!assistantLine) return `这通电话我会悄悄收藏，下次也记得来找我。—${charDisplayName}`;
        const normalized = assistantLine.text.replace(/\s+/g, ' ').trim();
        const cutAt = normalized.search(/[。！？]/);
        const sentence = cutAt >= 0 ? normalized.slice(0, cutAt + 1) : normalized.slice(0, 42);
        const polished = sentence.length > 48 ? `${sentence.slice(0, 48)}…` : sentence;
        return `"${polished}" —${charDisplayName}`;
    }, [charDisplayName]);

    // 接收 bubblesSnapshot 参数，不依赖 state
    const saveCallSummary = useCallback(async (durationSec: number, turnCount: number, bubblesSnapshot: CallBubble[]) => {
        if (!char) return;
        const keepsakeLine = buildCallKeepsakeLine(bubblesSnapshot);
        const mins = Math.floor(durationSec / 60);
        const secs = Math.floor(durationSec % 60);
        const durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const content = `通话结束 · ${charDisplayName} (${durationStr}, ${Math.max(1, turnCount)}轮对话`;
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
                direction: callDirectionRef.current ?? null,
                initiator: callDirectionRef.current === 'user_outgoing' ? 'user' : callDirectionRef.current === 'agent_outgoing' ? 'agent' : null,
                keepsakeLine,
                callSessionId: callSessionIdRef.current || callSessionId,
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

    const transcribeCallAudio = useCallback(async (blob: Blob) => {
        if (apiConfig?.callAsrProvider === 'bytedance') {
            if (!apiConfig.bytedanceAsrAppKey || !apiConfig.bytedanceAsrAccessKey || !apiConfig.bytedanceAsrResourceId) {
                const now = Date.now();
                if (now - lastAsrToastAtRef.current > 2000) {
                    addToast('字节ASR配置不完整，已回退本地识别', 'error');
                    lastAsrToastAtRef.current = now;
                }
                return transcribeWithFasterWhisper(blob);
            }
            const result = apiConfig.bytedanceAsrMode === 'file'
                ? await transcribeWithByteDanceFile(blob, {
                    appKey: apiConfig.bytedanceAsrAppKey,
                    accessKey: apiConfig.bytedanceAsrAccessKey,
                    resourceId: apiConfig.bytedanceAsrResourceId,
                    publicBaseUrl: apiConfig.bytedanceAucPublicBaseUrl,
                    language: apiConfig.bytedanceAsrLanguage,
                    enablePunc: apiConfig.bytedanceAsrEnablePunc,
                    enableItn: apiConfig.bytedanceAsrEnableItn,
                    enableEmotion: apiConfig.bytedanceAsrEnableEmotion,
                })
                : await transcribeWithByteDance(blob, {
                    appKey: apiConfig.bytedanceAsrAppKey,
                    accessKey: apiConfig.bytedanceAsrAccessKey,
                    resourceId: apiConfig.bytedanceAsrResourceId,
                    mode: apiConfig.bytedanceAsrMode,
                    language: apiConfig.bytedanceAsrLanguage,
                    enablePunc: apiConfig.bytedanceAsrEnablePunc,
                    enableItn: apiConfig.bytedanceAsrEnableItn,
                    enableEmotion: apiConfig.bytedanceAsrEnableEmotion,
                });
            if (result && result.text) return result;
            const now = Date.now();
            if (now - lastAsrToastAtRef.current > 2000) {
                addToast(`字节ASR失败: ${result?.error || '已回退本地识别'}`, 'error');
                lastAsrToastAtRef.current = now;
            }
        }
        return transcribeWithFasterWhisper(blob);
    }, [apiConfig, addToast]);

    const callScrollRef = useRef<HTMLDivElement>(null);

    const callBusy = ['thinking', 'speaking'].includes(callState);
    const callStatusLabel = callState === 'idle' ? '' :
        callState === 'dialing' ? '正在拨号...' :
            callState === 'ringing' ? '正在呼入...' :
                callState === 'thinking' ? '对方正在思考..' :
                    callState === 'speaking' ? '对方正在发言...' : '通话中';

    const pauseThresholdMs = clampNumber(apiConfig?.callPauseThreshold, CALL_PAUSE_MIN, CALL_PAUSE_MAX, DEFAULT_CALL_PAUSE_THRESHOLD);
    const segmentDurationMs = clampNumber(apiConfig?.callSegmentDuration, CALL_SEGMENT_MIN, CALL_SEGMENT_MAX, DEFAULT_CALL_SEGMENT_DURATION);
    const webSpeechMinDb = clampNumber(apiConfig?.webSpeechMinVolume, WEB_SPEECH_MIN_DB, WEB_SPEECH_MAX_DB, -45);
    const webSpeechConfigRef = useRef({
        language: apiConfig?.webSpeechLanguage || 'zh-CN',
        interim: apiConfig?.webSpeechInterim ?? true,
        continuous: apiConfig?.webSpeechContinuous ?? true,
        pauseMs: pauseThresholdMs,
        minDb: webSpeechMinDb,
        minVolumeLinear: dbToLinear(webSpeechMinDb)
    });

    useEffect(() => {
        const minDb = clampNumber(apiConfig?.webSpeechMinVolume, WEB_SPEECH_MIN_DB, WEB_SPEECH_MAX_DB, -45);
        webSpeechConfigRef.current = {
            language: apiConfig?.webSpeechLanguage || 'zh-CN',
            interim: apiConfig?.webSpeechInterim ?? true,
            continuous: apiConfig?.webSpeechContinuous ?? true,
            pauseMs: pauseThresholdMs,
            minDb,
            minVolumeLinear: dbToLinear(minDb)
        };
    }, [apiConfig?.webSpeechLanguage, apiConfig?.webSpeechInterim, apiConfig?.webSpeechContinuous, apiConfig?.webSpeechMinVolume, pauseThresholdMs]);

    // FIX 2: updateCallBubbles 同时同步到 OSContext，让 CallOverlay 能收到气泡
    const updateCallBubbles = useCallback((updater: CallBubble[] | ((prev: CallBubble[]) => CallBubble[])) => {
        setCallBubbles(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            callBubblesRef.current = next;
            setGlobalCallBubbles(next); // 同步到 OSContext.callBubbles 给 CallOverlay
            return next;
        });
    }, [setGlobalCallBubbles]);
    const createPendingUserBubble = useCallback((timestamp?: number) => {
        if (!callActiveRef.current) return null;
        if (pendingUserBubbleIdRef.current) return pendingUserBubbleIdRef.current;
        const id = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const bubble: CallBubble = {
            id,
            role: 'user',
            text: '...',
            timestamp: timestamp || Date.now(),
            streaming: true
        };
        updateCallBubbles(prev => [...prev, bubble]);
        pendingUserBubbleIdRef.current = id;
        return id;
    }, [updateCallBubbles]);

    const clearPendingUserBubble = useCallback(() => {
        const id = pendingUserBubbleIdRef.current;
        if (!id) return;
        updateCallBubbles(prev => prev.filter(b => b.id !== id));
        pendingUserBubbleIdRef.current = null;
    }, [updateCallBubbles]);
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
        callDirectionRef.current = callDirection;
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
                        interpretation: `（用户在 Agent 说话说到一半时挂断了。Agent 原本打算说：“${bubble.text}”，但只说到了：“${bubble.text.slice(0, spokenLen)}”..）`
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

    // 仅内部调用解释日志，不展示给用户（前端已过滤 call-internal-log）
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
        let score = 0;
        const signals: string[] = [];
        // Only strong phone-intent keywords; removed overly broad '直接聊|直接说'
        if (/(打电话|电话|语音|通话|打给你)/i.test(trimmed)) { score += 0.45; signals.push('phone_intent'); }
        if (/(很急|马上|有急事|立刻)/i.test(trimmed)) { score += 0.15; signals.push('urgency'); }
        // Emotion keywords are common in companion apps — lower weight, only strong signals
        if (/(崩溃|孤独|失眠)/i.test(trimmed)) { score += 0.06; signals.push('emotion'); }
        if (trimmed.length >= 120) { score += 0.03; signals.push('long_text'); }
        // No signals → no call. Eliminates the old base chance on every message.
        if (signals.length === 0) {
            void saveCallInternalLog('[CallDecision] skip: no_signals');
            return false;
        }
        const hour = new Date().getHours();
        if (hour >= 23 || hour <= 7) {
            score -= 0.15;
            signals.push('late_hour');
        }
        const scaled = score * (0.15 + callInitiative * 0.7);
        const threshold = Math.min(Math.max(scaled, 0.02), 0.45);
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

    const maybeSendAgentFollowup = useCallback(async (sessionId: string, scenario: 'user_cancel' | 'agent_decline' | 'agent_cancel' | 'user_decline' | 'user_hangup_during_call', bubbles?: CallBubble[]) => {
        if (!char || !sessionId) return;
        const key = `${sessionId}-${scenario}`;
        if (followupProcessingRef.current[key]) return;
        followupProcessingRef.current[key] = true;

        const chance = computeFollowupChance(scenario, messages);
        if (scenario !== 'user_hangup_during_call' && Math.random() > chance) {
            delete followupProcessingRef.current[key];
            return;
        }

        const recentMessages = messages.slice(-6).filter(m => m.role !== 'system');
        let contextSnippet = recentMessages.map(m => {
            const sender = m.role === 'user' ? userDisplayName : charDisplayName;
            const body = m.type === 'voice' ? `[语音] ${m.metadata?.transcription || ''}` : (m.content || '').slice(0, 60);
            return `${sender}: ${body}`;
        }).join('\n');

        if (bubbles && bubbles.length > 0) {
            const callSnippet = bubbles.slice(-10).map(b => {
                const sender = b.role === 'user' ? userDisplayName : charDisplayName;
                return `${sender}: ${b.text}`;
            }).join('\n');
            contextSnippet += `\n\n[刚结束的通话记录 (Last Call Transcript)]:\n${callSnippet}`;
        }

        let hint = '';
        const followupModeHint = '（当前为文字聊天模式：不要出现[通话]或电话口吻，不要输出通话标记，用简短的IM句子。）';
        if (scenario === 'user_cancel') hint = `（事实：${userDisplayName}给你打电话，你是被叫；状态：未接通；动作：${userDisplayName}在你接听前取消。结合你的人设与上下文语境自然措辞，发一条简短消息。${followupModeHint}）`;
        else if (scenario === 'agent_decline') hint = `（事实：${userDisplayName}给你打电话，你是被叫；状态：未接通；动作：你没有接听（拒接/未接）。可根据你的人设与上下文决定是否解释。${followupModeHint}）`;
        else if (scenario === 'agent_cancel') hint = `（事实：你给${userDisplayName}打电话，你是主动呼叫；状态：未接通；动作：${userDisplayName}未接（不是你取消）。结合你的人设与上下文语境，自然给${userDisplayName}发一条消息。${followupModeHint}）`;
        else if (scenario === 'user_decline') hint = `（事实：你给${userDisplayName}打电话，你是主动呼叫；状态：未接通；动作：${userDisplayName}拒接。结合人设与语境，发一条理解或询问的消息。${followupModeHint}）`;
        else if (scenario === 'user_hangup_during_call') hint = `（事实：通话中，${userDisplayName}在你说话或思考时突然挂断了。动作：结合人设与语境，自言自语或发一条消息表达反应（如惊讶、疑惑、无奈等）。${followupModeHint}）`;

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
            ? `${userDisplayName}主动拨给你`
            : callDirection === 'agent_outgoing'
                ? `你主动拨给了${userDisplayName}`
                : '电话方向未知';
        const roleHint = callDirection === 'user_outgoing'
            ? '你是被叫，对方为主叫'
            : callDirection === 'agent_outgoing'
                ? '你是主叫，对方为被叫'
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
        const hardened = ChatParser.sanitize(raw)
            .replace(/^\s*(?:思考|分析|推理|reasoning|thoughts?|chain\s*of\s*thought)\s*[:：].*$/gmi, '')
            .replace(/<\s*(?:think|analysis|reasoning)[^>]*>[\s\S]*?<\/\s*(?:think|analysis|reasoning)\s*>/gi, '');
        return hardened
            .replace(/<\s*\/?\s*(?:语音|发音)\s*>/gi, '')
            .replace(/^\s*\[(?:通话|聊天|系统)[^\]]*\]\s*/gim, '')
            .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/gm, '')
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

        const extractDeltaText = (line: string): string => {
            if (!line.startsWith('data: ')) return '';
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') return '';
            try {
                const data = JSON.parse(raw);
                if (data.choices?.[0]?.delta?.content) return data.choices[0].delta.content;
                if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
                if (data.delta?.text) return data.delta.text;
                if (data.content?.[0]?.text) return data.content[0].text;
            } catch { }
            return '';
        };

        let body: any = {
            model: apiConfig.model,
            messages: [{ role: 'system', content: systemPrompt }, ...callMessages],
            temperature: 0.7,
            stream: true
        };
        if (resolved.transformBody) body = resolved.transformBody(body);

        const res = await fetch(resolved.chatUrl, {
            method: 'POST',
            headers: resolved.headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!res.ok || !res.body) return '';

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let reply = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                const delta = extractDeltaText(line);
                if (delta) reply += delta;
            }
        }
        reader.releaseLock();
        return reply.trim();
    }, [apiConfig, char, buildCallSystemPrompt]);

    const sendCallAssistantReply: (history: CallBubble[]) => Promise<void> = useCallback(async (history: CallBubble[]) => {
        if (!char || !callActiveRef.current) return;
        clearSilenceNudge();
        setInternalCallState('thinking');
        const raw = await requestCallReply(history);
        const cleaned = sanitizeCallText(raw);
        if (!cleaned) {
            setInternalCallState('connected');
            return;
        }

        const bubble: CallBubble = {
            id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: 'assistant',
            text: cleaned,
            timestamp: Date.now(),
            streaming: true
        };
        updateCallBubbles(prev => [...prev, bubble]);
        await saveCallMessage('assistant', cleaned);
        lastAgentSpokeAtRef.current = Date.now();

        if (canUseCallTts()) {
            try {
                const audioBlob = await synthesizeSpeech(cleaned, char, apiConfig);
                if (audioBlob) {
                    const url = URL.createObjectURL(audioBlob);
                    updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioUrl: url, audioProgress: 0 } : b));

                    const audio = new Audio(url);
                    callAudioRef.current = audio;
                    currentAssistantBubbleRef.current = { id: bubble.id, text: cleaned };
                    setInternalCallState('speaking');

                    audio.onloadedmetadata = () => {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioDuration: audio.duration } : b));
                    };
                    audio.ontimeupdate = () => {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioProgress: audio.currentTime } : b));
                    };
                    audio.onended = () => {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioProgress: audio.duration, streaming: false } : b));
                        setInternalCallState('connected');
                        callAudioRef.current = null;
                        currentAssistantBubbleRef.current = null;
                    };
                    audio.onerror = () => {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, streaming: false } : b));
                        setInternalCallState('connected');
                        callAudioRef.current = null;
                        currentAssistantBubbleRef.current = null;
                    };
                    audio.play().catch(() => {
                        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, streaming: false } : b));
                        setInternalCallState('connected');
                        callAudioRef.current = null;
                        currentAssistantBubbleRef.current = null;
                    });
                    return;
                }
            } catch { }
        }

        updateCallBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, streaming: false } : b));
        setInternalCallState('connected');
    }, [apiConfig, canUseCallTts, char, clearSilenceNudge, requestCallReply, sanitizeCallText, saveCallMessage, updateCallBubbles]);

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
            const directionHint = callDirection === 'user_outgoing'
                ? `事实：${userDisplayName}主动拨给你，你是被叫，刚刚接起。`
                : callDirection === 'agent_outgoing'
                    ? `事实：你主动拨给${userDisplayName}，对方刚接起。`
                    : '事实：通话方向未知，默认你是被叫。';
            const greetingPrompt = `（电话刚接通，对方还没说话。${directionHint}请以正确的来电/去电视角自然开场，简短口语，符合你的人设与上下文。）`;
            await sendCallAssistantReply([{ id: 'call-greet', role: 'user', text: greetingPrompt, timestamp: Date.now() }]);
        }, delay);
    }, [callDirection, userDisplayName, clearAgentGreeting, sendCallAssistantReply]);

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

        const streaming = typeof extra?.streaming === 'boolean' ? extra.streaming : extra?.via === 'voice';
        const existingId = extra?.bubbleId as string | undefined;
        if (existingId) {
            updateCallBubbles(prev => prev.map(b => b.id === existingId ? { ...b, text: text.trim(), streaming } : b));
            saveCallMessage('user', text.trim(), extra);
        } else {
            const userBubble: CallBubble = {
                id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: 'user',
                text: text.trim(),
                timestamp: Date.now(),
                streaming
            };
            updateCallBubbles(prev => [...prev, userBubble]);
            saveCallMessage('user', userBubble.text, extra);
        }
        scheduleAssistantReply();
    }, [char, markUserSpoke, saveCallMessage, updateCallBubbles, scheduleAssistantReply]);

    const clearWebSpeechTimer = useCallback(() => {
        if (webSpeechTimerRef.current) {
            clearTimeout(webSpeechTimerRef.current);
            webSpeechTimerRef.current = null;
        }
    }, []);

    const updateWebSpeechBubble = useCallback((text: string, streaming: boolean) => {
        if (!text.trim()) return;
        const pendingId = pendingUserBubbleIdRef.current || createPendingUserBubble();
        pendingUserBubbleIdRef.current = pendingId;
        updateCallBubbles(prev => prev.map(b => b.id === pendingId ? { ...b, text, streaming } : b));
    }, [createPendingUserBubble, updateCallBubbles]);

    const flushWebSpeechBuffer = useCallback(() => {
        clearWebSpeechTimer();
        const combined = `${webSpeechBufferRef.current}${webSpeechInterimRef.current}`.trim();
        const pendingId = pendingUserBubbleIdRef.current;
        if (!combined) {
            if (pendingId) clearPendingUserBubble();
            webSpeechBufferRef.current = '';
            webSpeechInterimRef.current = '';
            return;
        }
        pendingUserBubbleIdRef.current = null;
        webSpeechBufferRef.current = '';
        webSpeechInterimRef.current = '';
        sendCallUserText(combined, { via: 'voice', streaming: false, bubbleId: pendingId, source: 'web-speech' });
    }, [clearWebSpeechTimer, clearPendingUserBubble, sendCallUserText]);

    const scheduleWebSpeechSend = useCallback((delayMs?: number) => {
        clearWebSpeechTimer();
        const delay = Math.max(200, delayMs ?? webSpeechConfigRef.current.pauseMs);
        webSpeechTimerRef.current = setTimeout(() => {
            webSpeechTimerRef.current = null;
            flushWebSpeechBuffer();
        }, delay);
    }, [clearWebSpeechTimer, flushWebSpeechBuffer]);

    const stopWebSpeechRecognition = useCallback((clearPending: boolean) => {
        webSpeechWantedRef.current = false;
        clearWebSpeechTimer();
        const recognizer = webSpeechRef.current;
        if (recognizer && webSpeechActiveRef.current) {
            try { recognizer.stop(); } catch { }
        }
        webSpeechActiveRef.current = false;
        webSpeechBufferRef.current = '';
        webSpeechInterimRef.current = '';
        if (clearPending) clearPendingUserBubble();
    }, [clearPendingUserBubble, clearWebSpeechTimer]);

    const startWebSpeechRecognition = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            const now = Date.now();
            if (now - lastAsrToastAtRef.current > 2000) {
                addToast('当前浏览器不支持 Web Speech API', 'error');
                lastAsrToastAtRef.current = now;
            }
            return false;
        }

        if (!webSpeechRef.current) {
            const recognizer = new SpeechRecognition();
            recognizer.onstart = () => { webSpeechActiveRef.current = true; };
            recognizer.onend = () => {
                webSpeechActiveRef.current = false;
                if (webSpeechWantedRef.current && callActiveRef.current && !callMicMutedRef.current && callStateRef.current !== 'idle' && webSpeechConfigRef.current.continuous) {
                    setTimeout(() => {
                        try { recognizer.start(); } catch { }
                    }, 300);
                } else if (webSpeechBufferRef.current || webSpeechInterimRef.current) {
                    scheduleWebSpeechSend(webSpeechConfigRef.current.pauseMs);
                }
            };
            recognizer.onerror = (e: any) => {
                if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
                    webSpeechWantedRef.current = false;
                }
            };
            recognizer.onresult = (event: any) => {
                if (!callActiveRef.current || callStateRef.current === 'idle' || callMicMutedRef.current) return;
                // removed volume check
                markUserSpoke();
                let interimText = '';
                let finalText = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    const text = result?.[0]?.transcript || '';
                    if (result?.isFinal) finalText += text;
                    else interimText += text;
                }
                if (finalText) webSpeechBufferRef.current += finalText;
                webSpeechInterimRef.current = webSpeechConfigRef.current.interim ? interimText : '';
                const combined = `${webSpeechBufferRef.current}${webSpeechInterimRef.current}`.trim();
                if (combined) updateWebSpeechBubble(combined, true);
                webSpeechLastResultAtRef.current = Date.now();
                if (finalText) {
                    scheduleWebSpeechSend(webSpeechConfigRef.current.pauseMs);
                }
            };
            webSpeechRef.current = recognizer;
        }

        const recognizer = webSpeechRef.current;
        const cfg = webSpeechConfigRef.current;
        recognizer.lang = cfg.language || 'zh-CN';
        recognizer.interimResults = cfg.interim;
        recognizer.continuous = cfg.continuous;

        webSpeechWantedRef.current = true;
        try { recognizer.start(); } catch { }
        return true;
    }, [addToast, markUserSpoke, scheduleWebSpeechSend, updateWebSpeechBubble]);

    // --- Voice Recording ---
    const stopCallVoiceCapture = useCallback(async (sendText: boolean) => {
        if (!callVoiceCapturingRef.current) return;
        callVoiceCapturingRef.current = false;
        if (voiceProcessingRef.current) return;
        voiceProcessingRef.current = true;
        if (callVoiceChunkTimerRef.current) { clearTimeout(callVoiceChunkTimerRef.current); callVoiceChunkTimerRef.current = null; }
        callVoiceRecorder.stopRecording();
        const pendingId = sendText ? (pendingUserBubbleIdRef.current || createPendingUserBubble()) : null;
        try {
            const result = await callVoiceResultRef.current;
            if (!sendText || !result) {
                if (pendingId) clearPendingUserBubble();
                return;
            }
            if (!callActiveRef.current || callState === 'idle' || callMicMuted) {
                if (pendingId) clearPendingUserBubble();
                return;
            }
            const asrResult = await transcribeCallAudio(result.blob);
            const transcription = (asrResult?.text || '').trim();
            if (!transcription) {
                if (asrResult?.error) {
                    const now = Date.now();
                    if (now - lastAsrToastAtRef.current > 2000) {
                        addToast(`语音识别失败: ${asrResult.error}`, 'error');
                        lastAsrToastAtRef.current = now;
                    }
                }
                if (pendingId) {
                    updateCallBubbles(prev => prev.map(b => b.id === pendingId ? { ...b, text: '未识别到语音', streaming: false } : b));
                    setTimeout(() => {
                        updateCallBubbles(prev => prev.filter(b => b.id !== pendingId));
                    }, 1500);
                    pendingUserBubbleIdRef.current = null;
                }
                return;
            }
            if (pendingId) {
                pendingUserBubbleIdRef.current = null;
                await sendCallUserText(transcription, { via: 'voice', duration: result.duration || 0, emotion: asrResult?.emotion, bubbleId: pendingId });
            } else {
                await sendCallUserText(transcription, { via: 'voice', duration: result.duration || 0, emotion: asrResult?.emotion });
            }
        } finally {
            voiceProcessingRef.current = false;
        }
    }, [callVoiceRecorder, callState, callMicMuted, sendCallUserText, createPendingUserBubble, clearPendingUserBubble, updateCallBubbles, transcribeCallAudio]);

    const gatingStartAtRef = useRef<number>(0);
    const GATING_WINDOW_MS = 150;

    const startCallVoiceCapture = useCallback(async () => {
        if (voiceProcessingRef.current) return;
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) return;
        const ok = await callVoiceRecorder.startMonitoring();
        if (!ok) {
            const now = Date.now();
            if (now - lastAsrToastAtRef.current > 2000) {
                addToast('麦克风不可用或权限被拒绝', 'error');
                lastAsrToastAtRef.current = now;
            }
            return;
        }
        callVoiceCapturingRef.current = false;
        segmentStartAtRef.current = 0;
        lastVoiceAtRef.current = 0;
        hasSpeechRef.current = false;
        gatingStartAtRef.current = 0;
        if (callVoiceChunkTimerRef.current) { clearTimeout(callVoiceChunkTimerRef.current); callVoiceChunkTimerRef.current = null; }
    }, [callState, callMicMuted, callVoiceRecorder]);

    const beginVoiceCapture = useCallback((assumeSpeech: boolean) => {
        if (voiceProcessingRef.current) return;
        if (!callActiveRef.current || callStateRef.current === 'idle' || callMicMuted) return;
        if (callVoiceCapturingRef.current) return;
        callVoiceResultRef.current = callVoiceRecorder.startRecording();
        createPendingUserBubble();
        callVoiceCapturingRef.current = true;
        segmentStartAtRef.current = Date.now();
        lastVoiceAtRef.current = assumeSpeech ? Date.now() : 0;
        hasSpeechRef.current = assumeSpeech;
        gatingStartAtRef.current = 0;
        if (callVoiceChunkTimerRef.current) clearTimeout(callVoiceChunkTimerRef.current);
        callVoiceChunkTimerRef.current = setTimeout(async () => {
            await stopCallVoiceCapture(true);
            if (callActiveRef.current && !callMicMuted) {
                startCallVoiceCapture();
            }
        }, segmentDurationMs);
    }, [callMicMuted, callVoiceRecorder, segmentDurationMs, startCallVoiceCapture, stopCallVoiceCapture, createPendingUserBubble]);

    const startSpeechDetector = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return false;

        if (!speechDetectorRef.current) {
            const recognizer = new SpeechRecognition();
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'zh-CN';
            recognizer.onstart = () => { speechDetectorActiveRef.current = true; };
            recognizer.onend = () => {
                speechDetectorActiveRef.current = false;
                if (speechDetectorWantedRef.current && callActiveRef.current && !callMicMuted && callStateRef.current !== 'idle') {
                    setTimeout(() => {
                        try { recognizer.start(); } catch { }
                    }, 300);
                }
            };
            recognizer.onspeechstart = () => {
                if (!callActiveRef.current || callStateRef.current === 'idle' || callMicMuted) return;
                markUserSpoke();
                if (!callVoiceCapturingRef.current && !voiceProcessingRef.current) {
                    beginVoiceCapture(true);
                } else {
                    lastVoiceAtRef.current = Date.now();
                    hasSpeechRef.current = true;
                }
            };
            recognizer.onresult = () => {
                if (!callActiveRef.current || callStateRef.current === 'idle' || callMicMuted) return;
                lastVoiceAtRef.current = Date.now();
                hasSpeechRef.current = true;
            };
            recognizer.onerror = (e: any) => {
                if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
                    speechDetectorWantedRef.current = false;
                }
            };
            speechDetectorRef.current = recognizer;
        }

        speechDetectorWantedRef.current = true;
        try { speechDetectorRef.current.start(); } catch { }
        return true;
    }, [beginVoiceCapture, callMicMuted, markUserSpoke]);

    const stopSpeechDetector = useCallback(() => {
        speechDetectorWantedRef.current = false;
        const recognizer = speechDetectorRef.current;
        if (recognizer && speechDetectorActiveRef.current) {
            try { recognizer.onend = null; recognizer.stop(); } catch { }
        }
        speechDetectorActiveRef.current = false;
    }, []);

    useEffect(() => {
        const now = Date.now();
        if (callMicMuted || callState === 'idle') {
            callVoiceRecorder.stopMonitoring();
            return;
        }
        if (!callActiveRef.current) return;
        if (!callVoiceCapturingRef.current) {
            if (callVolumeLevel > VOICE_ACTIVITY_THRESHOLD) {
                if (!gatingStartAtRef.current) gatingStartAtRef.current = now;
                if (now - gatingStartAtRef.current >= GATING_WINDOW_MS) {
                    beginVoiceCapture(false);
                }
            } else {
                gatingStartAtRef.current = 0;
            }
            return;
        }
        if (callVoiceCapturingRef.current) {
            if (callVolumeLevel > VOICE_ACTIVITY_THRESHOLD) {
                lastVoiceAtRef.current = now;
                hasSpeechRef.current = true;
                markUserSpoke();
            }
            const segmentElapsed = segmentStartAtRef.current ? (now - segmentStartAtRef.current) : 0;
            if (hasSpeechRef.current) {
                if (lastVoiceAtRef.current && (now - lastVoiceAtRef.current) >= pauseThresholdMs) {
                    (async () => {
                        await stopCallVoiceCapture(true);
                        if (callActiveRef.current && !callMicMuted) {
                            startCallVoiceCapture();
                        }
                    })();
                } else if (segmentElapsed >= segmentDurationMs) {
                    (async () => {
                        await stopCallVoiceCapture(true);
                        if (callActiveRef.current && !callMicMuted) {
                            startCallVoiceCapture();
                        }
                    })();
                }
            } else if (segmentElapsed >= segmentDurationMs) {
                (async () => {
                    await stopCallVoiceCapture(false);
                    clearPendingUserBubble();
                    if (callActiveRef.current && !callMicMuted) {
                        startCallVoiceCapture();
                    }
                })();
            }
        }
    }, [callVolumeLevel, callMicMuted, callState, markUserSpoke, pauseThresholdMs, segmentDurationMs, stopCallVoiceCapture, startCallVoiceCapture, callVoiceRecorder, beginVoiceCapture]);

    // --- Core Actions ---
    const startCall = useCallback(async () => {
        if (!char || callState !== 'idle') return;
        if (!canUseCallTts()) {
            addToast('未配置语音服务（MiniMax），当前为文字模式通话', 'info');
        }
        pendingReplyAfterAgentRef.current = false;
        stopCallAudio();
        clearSuspendedCall();
        const sessionId = `call-${Date.now()}`;
        lastCallAtRef.current = Date.now();
        callActiveRef.current = true;
        callSessionIdRef.current = sessionId;
        setCallSessionId(sessionId);
        setInternalCallDirection('user_outgoing');
        callDirectionRef.current = 'user_outgoing';
        updateCallBubbles([]);
        setCallInput('');
        setCallInputMode('voice');
        updateCallStartedAt(null);
        setCallElapsed(0);
        setCallMicMuted(true);
        setInternalCallState('dialing');
        callStateRef.current = 'dialing';
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
                callStateRef.current = 'idle';
                setInternalCallDirection(null);
                callDirectionRef.current = null;
                await saveCallLog('对方已拒绝', 'declined', sessionId);
                await maybeSendAgentFollowup(sessionId, 'agent_decline');
                return;
            }
            setInternalCallState('connected');
            callStateRef.current = 'connected';
            const connectedAt = Date.now();
            updateCallStartedAt(connectedAt);
            setCallElapsed(0);
            // FIX 4: 接通时不写聊天界面气泡，只在挂断后写摘要卡片
            scheduleAgentGreeting(connectedAt);
        }, delay);
    }, [char, callState, stopCallAudio, clearSuspendedCall, setGlobalShowCallOverlay, startRingtone, stopRingtone, decideCallAccept, saveCallLog, maybeSendAgentFollowup, scheduleAgentGreeting, updateCallBubbles, updateCallStartedAt, canUseCallTts, addToast]);

    const startAgentCall = useCallback(async () => {
        if (!char || callState !== 'idle') return;
        // Agent should not auto-call when TTS is unavailable (text-only call is awkward)
        if (!canUseCallTts()) return;
        pendingReplyAfterAgentRef.current = false;
        stopCallAudio();
        clearSuspendedCall();
        const sessionId = `call-${Date.now()}`;
        lastCallAtRef.current = Date.now();
        callActiveRef.current = false;
        callSessionIdRef.current = sessionId;
        setCallSessionId(sessionId);
        setInternalCallDirection('agent_outgoing');
        callDirectionRef.current = 'agent_outgoing';
        updateCallBubbles([]);
        setCallInput('');
        setCallInputMode('voice');
        updateCallStartedAt(null);
        setCallElapsed(0);
        setCallMicMuted(true);
        setInternalCallState('ringing');
        callStateRef.current = 'ringing';
        setGlobalShowCallOverlay(true);
        startRingtone('incoming');
        const ringTimeout = 12000 + Math.floor(Math.random() * 8000);
        callIncomingTimerRef.current = setTimeout(async () => {
            if (callActiveRef.current) return;
            if (callSessionIdRef.current !== sessionId) return;
            await hangup();
        }, ringTimeout);
    }, [char, callState, stopCallAudio, clearSuspendedCall, setGlobalShowCallOverlay, startRingtone, canUseCallTts]);

    const acceptIncomingCall = useCallback(async () => {
        if (!char || callDirection !== 'agent_outgoing' || callState !== 'ringing') return;
        stopRingtone();
        if (callIncomingTimerRef.current) { clearTimeout(callIncomingTimerRef.current); callIncomingTimerRef.current = null; }
        pendingReplyAfterAgentRef.current = false;
        callActiveRef.current = true;
        setInternalCallState('connected');
        callStateRef.current = 'connected';
        const connectedAt = Date.now();
        updateCallStartedAt(connectedAt);
        setCallElapsed(0);
        // FIX 4 同上: 接通时不写聊天界面气泡
        scheduleAgentGreeting(connectedAt);
    }, [char, callDirection, callState, stopRingtone, scheduleAgentGreeting, updateCallStartedAt]);

    const hangup = useCallback(async () => {
        const wasActive = callActiveRef.current;
        const stateAtHangup = callStateRef.current;
        const sessionId = callSessionIdRef.current || callSessionId;
        const directionAtHangup = callDirectionRef.current;
        // 使用 ref 读取气泡和开始时间，不依赖 state
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
        clearPendingUserBubble();
        stopSpeechDetector();
        stopWebSpeechRecognition(true);
        callVoiceRecorder.cancelRecording();
        callVoiceRecorder.stopMonitoring();
        setGlobalShowCallOverlay(false);
        setInternalCallState('idle');
        callStateRef.current = 'idle';
        setInternalCallDirection(null);
        callDirectionRef.current = null;
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
            if (stateAtHangup === 'ringing' && directionAtHangup === 'agent_outgoing') {
                await saveCallLog('用户已拒绝', 'declined', sessionId);
            } else {
                await saveCallLog('通话已结束', 'canceled', sessionId);
            }
            await maybeSendAgentFollowup(sessionId, scenario);
        }

        // 通话完全结束后统一刷新一次 messages
        await refreshMessages();

        if (wasConnected && (stateAtHangup === 'thinking' || stateAtHangup === 'speaking')) {
            await maybeSendAgentFollowup(sessionId, 'user_hangup_during_call', bubblesSnapshot);
        }

        updateCallBubbles([]);
        updateCallStartedAt(null);
        setCallElapsed(0);
    }, [callState, callSessionId, callDirection, callVoiceRecorder, clearAgentGreeting, clearPendingReply, clearSilenceNudge, abortCallReply, stopRingtone, stopCallAudio, stopCallVoiceCapture, clearPendingUserBubble, stopSpeechDetector, stopWebSpeechRecognition, setGlobalShowCallOverlay, clearSuspendedCall, saveCallSummary, saveCallLog, refreshMessages, maybeSendAgentFollowup, updateCallBubbles, updateCallStartedAt]);

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
        if (apiConfig?.callAsrProvider === 'web-speech') {
            stopCallVoiceCapture(false);
            if (callMicActive) {
                callVoiceRecorder.stopRecording();
            }
            if (!callActiveRef.current || callState === 'idle' || callMicMuted) {
                stopWebSpeechRecognition(true);
                callVoiceRecorder.stopMonitoring();
            } else {
                callVoiceRecorder.startMonitoring().then(ok => {
                    if (!ok) {
                        const now = Date.now();
                        if (now - lastAsrToastAtRef.current > 2000) {
                            addToast('麦克风不可用或权限被拒绝', 'error');
                            lastAsrToastAtRef.current = now;
                        }
                    }
                });
                startWebSpeechRecognition();
            }
            return;
        }
        callVoiceRecorder.stopMonitoring();
        stopWebSpeechRecognition(false);
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) {
            stopCallVoiceCapture(true);
        } else {
            startCallVoiceCapture();
        }
    }, [callState, callMicMuted, callMicActive, apiConfig?.callAsrProvider, addToast, startCallVoiceCapture, stopCallVoiceCapture, startWebSpeechRecognition, stopWebSpeechRecognition]);

    useEffect(() => {
        if (apiConfig?.callAsrProvider === 'web-speech') {
            stopSpeechDetector();
            return;
        }
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) {
            stopSpeechDetector();
            return;
        }
        startSpeechDetector();
        return () => stopSpeechDetector();
    }, [callState, callMicMuted, apiConfig?.callAsrProvider, startSpeechDetector, stopSpeechDetector]);

    useEffect(() => {
        if (apiConfig?.callAsrProvider === 'web-speech') return;
        if (!callActiveRef.current || callState === 'idle' || callMicMuted) return;
        if (!callMicActive && !callVoiceCapturingRef.current && !voiceProcessingRef.current) {
            startCallVoiceCapture();
        }
    }, [callMicActive, callMicMuted, callState, apiConfig?.callAsrProvider, startCallVoiceCapture]);

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

    // 计时器在通话全过程（connected / thinking / speaking）保持更新
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



