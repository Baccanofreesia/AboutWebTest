import React, { useEffect, useRef, useState } from 'react';
import { CallState, CallDirection, CallInputMode, CallBubble } from '../../types';
import { useOS } from '../../context/OSContext';

interface CallOverlayProps {
    visible: boolean;
    callState: CallState;
    callDirection: CallDirection | null;
    callStatusLabel: string;
    callStartedAt: number | null;
    callElapsed: number;
    charDisplayName: string;
    charDisplayAvatar: string;
    callBubbles: CallBubble[];
    callInputMode: CallInputMode;
    callInput: string;
    callBusy: boolean;
    callMicMuted: boolean;
    callMicActive: boolean;
    callVolumeLevel?: number;
    formatDuration: (seconds: number) => string;
    scrollRef?: React.Ref<HTMLDivElement>;
    onChangeInput: (val: string) => void;
    onSendText: () => void;
    onToggleInputMode: () => void;
    onToggleMute: () => void;
    onMinimize?: () => void;
    onCancelOutgoing: () => void;
    onAcceptIncoming: () => void;
    onDeclineIncoming: () => void;
    onHangup: () => void;
}

const DEFAULT_CALL_PAUSE_THRESHOLD = 800;
const DEFAULT_CALL_SEGMENT_DURATION = 12000;
const CALL_PAUSE_MIN = 200;
const CALL_PAUSE_MAX = 3000;
const CALL_SEGMENT_MIN = 4000;
const CALL_SEGMENT_MAX = 30000;
const WEB_SPEECH_DB_MIN = -60;
const WEB_SPEECH_DB_MAX = 0;
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
};

const toDb = (linear: number) => {
    if (!Number.isFinite(linear) || linear <= 0) return WEB_SPEECH_DB_MIN;
    const db = 20 * Math.log10(linear);
    return clampNumber(db, WEB_SPEECH_DB_MIN, WEB_SPEECH_DB_MAX, WEB_SPEECH_DB_MIN);
};

const useStreamingTypewriter = (text: string, enabled: boolean, speed: number = 18, resetOnEnable: boolean = false) => {
    const [displayed, setDisplayed] = useState(() => (enabled && resetOnEnable ? '' : text));
    const displayedRef = useRef(text);
    const targetRef = useRef(text);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const wasEnabledRef = useRef(false);

    useEffect(() => {
        targetRef.current = text;
        if (enabled && resetOnEnable && !wasEnabledRef.current) {
            displayedRef.current = '';
            setDisplayed('');
        }
        wasEnabledRef.current = enabled;
        if (!enabled) {
            displayedRef.current = text;
            setDisplayed(text);
            return;
        }
        if (displayedRef.current.length > text.length || !text.startsWith(displayedRef.current)) {
            displayedRef.current = text;
            setDisplayed(text);
        }
    }, [text, enabled]);

    useEffect(() => {
        if (!enabled) {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
            const target = targetRef.current;
            const current = displayedRef.current;
            if (current.length >= target.length) {
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                return;
            }
            const gap = target.length - current.length;
            const step = gap > 24 ? Math.ceil(gap / 3) : 1;
            const next = target.slice(0, Math.min(target.length, current.length + step));
            displayedRef.current = next;
            setDisplayed(next);
        }, speed);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [enabled, speed]);

    return displayed;
};

// 单条气泡，带打字机效果
const CallBubbleItem: React.FC<{
    bubble: CallBubble;
    isLatestAssistant: boolean;
    isLatestUser: boolean;
    isSpeaking: boolean;
}> = ({ bubble, isLatestAssistant, isLatestUser, isSpeaking }) => {
    const isUser = bubble.role === 'user';
    const assistantSpeaking = !isUser && isLatestAssistant && isSpeaking;
    const assistantStreaming = !isUser && isLatestAssistant && !!bubble.streaming;
    const userStreaming = isUser && isLatestUser && !!bubble.streaming;
    const hasAudioProgress = assistantStreaming && typeof bubble.audioDuration === 'number' && typeof bubble.audioProgress === 'number' && bubble.audioDuration > 0;

    const assistantTyped = useStreamingTypewriter(bubble.text, assistantSpeaking && !hasAudioProgress, 16, true);
    const userTyped = useStreamingTypewriter(bubble.text, userStreaming, 18, true);
    const audioSyncedText = hasAudioProgress
        ? bubble.text.slice(0, Math.max(0, Math.min(
            bubble.text.length,
            Math.ceil((bubble.audioProgress! / bubble.audioDuration!) * bubble.text.length)
        )))
        : '';
    const assistantText = hasAudioProgress ? audioSyncedText : (assistantSpeaking ? assistantTyped : '');
    const text = assistantStreaming
        ? assistantText
        : (userStreaming ? userTyped : bubble.text);
    const isTyping = assistantStreaming
        ? (hasAudioProgress ? audioSyncedText.length < bubble.text.length : (assistantSpeaking ? assistantTyped.length < bubble.text.length : true))
        : (userStreaming && text.length < bubble.text.length);

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isTyping ? 'typing-glow' : ''}
                    ${isUser
                        ? 'bg-white/20 text-white rounded-br-sm'
                        : 'bg-white/10 text-white/90 rounded-bl-sm'
                    }`}
            >
                {text}
                {isTyping && (
                    <span className="inline-block w-0.5 h-3.5 bg-white/60 ml-0.5 animate-pulse align-middle" />
                )}
            </div>
        </div>
    );
};

// 脉冲波纹动画（拨号/来电状态）
const PulseRing: React.FC<{ color: string }> = ({ color }) => (
    <div className="relative w-24 h-24 flex items-center justify-center">
        {[0, 1, 2].map(i => (
            <span
                key={i}
                className="absolute rounded-full border opacity-0"
                style={{
                    width: `${60 + i * 24}px`,
                    height: `${60 + i * 24}px`,
                    borderColor: color,
                    animation: `call-pulse 2s ease-out ${i * 0.6}s infinite`,
                }}
            />
        ))}
        <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ backgroundColor: color + '33', border: `2px solid ${color}66` }}
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={color} className="w-7 h-7">
                <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 0 0 6.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
            </svg>
        </div>
    </div>
);

const CallOverlay: React.FC<CallOverlayProps> = ({
    visible,
    callState,
    callDirection,
    callStatusLabel,
    callStartedAt,
    callElapsed,
    charDisplayName,
    charDisplayAvatar,
    callBubbles,
    callInputMode,
    callInput,
    callBusy,
    callMicMuted,
    callMicActive,
    callVolumeLevel = 0,
    formatDuration,
    scrollRef,
    onChangeInput,
    onSendText,
    onToggleInputMode,
    onToggleMute,
    onMinimize,
    onCancelOutgoing,
    onAcceptIncoming,
    onDeclineIncoming,
    onHangup,
}) => {
    const { apiConfig, updateApiConfig } = useOS();
    const [isComposing, setIsComposing] = useState(false);
    const [localInput, setLocalInput] = useState(callInput);
    const [showSettings, setShowSettings] = useState(false);
    const pauseValue = clampNumber(apiConfig.callPauseThreshold, CALL_PAUSE_MIN, CALL_PAUSE_MAX, DEFAULT_CALL_PAUSE_THRESHOLD);
    const segmentValue = clampNumber(apiConfig.callSegmentDuration, CALL_SEGMENT_MIN, CALL_SEGMENT_MAX, DEFAULT_CALL_SEGMENT_DURATION);
    const asrProviderValue = apiConfig.callAsrProvider || 'faster-whisper';
    const webSpeechMinDb = clampNumber(apiConfig.webSpeechMinVolume, WEB_SPEECH_DB_MIN, WEB_SPEECH_DB_MAX, -45);
    const volumeDb = toDb(callVolumeLevel);
    const hasWebSpeechSignal = volumeDb > (WEB_SPEECH_DB_MIN + 1);
    const belowWebSpeechThreshold = asrProviderValue === 'web-speech' && hasWebSpeechSignal && volumeDb < webSpeechMinDb;
    const noWebSpeechSignal = asrProviderValue === 'web-speech' && !hasWebSpeechSignal;
    const [draftPause, setDraftPause] = useState(pauseValue);
    const [draftSegment, setDraftSegment] = useState(segmentValue);
    const [draftAsrProvider, setDraftAsrProvider] = useState<'web-speech' | 'faster-whisper' | 'bytedance'>(asrProviderValue);
    const [draftBytAppKey, setDraftBytAppKey] = useState(apiConfig.bytedanceAsrAppKey || '');
    const [draftBytAccessKey, setDraftBytAccessKey] = useState(apiConfig.bytedanceAsrAccessKey || '');
    const [draftBytResourceId, setDraftBytResourceId] = useState(apiConfig.bytedanceAsrResourceId || '');
    const [draftBytMode, setDraftBytMode] = useState<'fast' | 'standard' | 'dual' | 'file'>(apiConfig.bytedanceAsrMode || 'fast');
    const [draftBytLang, setDraftBytLang] = useState(apiConfig.bytedanceAsrLanguage || 'zh-CN');
    const [draftBytPunc, setDraftBytPunc] = useState(apiConfig.bytedanceAsrEnablePunc ?? true);
    const [draftBytItn, setDraftBytItn] = useState(apiConfig.bytedanceAsrEnableItn ?? true);
    const [draftBytEmotion, setDraftBytEmotion] = useState(apiConfig.bytedanceAsrEnableEmotion ?? false);
    const [draftBytAucBaseUrl, setDraftBytAucBaseUrl] = useState(apiConfig.bytedanceAucPublicBaseUrl || '');
    const [draftWebSpeechMinVolume, setDraftWebSpeechMinVolume] = useState(webSpeechMinDb);
    const liveWebSpeechDelta = Math.round(volumeDb - webSpeechMinDb);
    const liveWebSpeechHint = !hasWebSpeechSignal
        ? `实时输入 ${Math.round(volumeDb)} dB · 等待声音输入`
        : liveWebSpeechDelta >= 0
            ? `实时输入 ${Math.round(volumeDb)} dB · 已达到识别阈值`
            : `实时输入 ${Math.round(volumeDb)} dB · 声音偏弱`;

    useEffect(() => {
        if (!isComposing) setLocalInput(callInput);
    }, [callInput, isComposing]);

    useEffect(() => {
        setDraftPause(pauseValue);
    }, [pauseValue]);

    useEffect(() => {
        setDraftSegment(segmentValue);
    }, [segmentValue]);

    useEffect(() => {
        setDraftAsrProvider(asrProviderValue);
        setDraftBytAppKey(apiConfig.bytedanceAsrAppKey || '');
        setDraftBytAccessKey(apiConfig.bytedanceAsrAccessKey || '');
        setDraftBytResourceId(apiConfig.bytedanceAsrResourceId || '');
        setDraftBytMode(apiConfig.bytedanceAsrMode || 'fast');
        setDraftBytLang(apiConfig.bytedanceAsrLanguage || 'zh-CN');
        setDraftBytPunc(apiConfig.bytedanceAsrEnablePunc ?? true);
        setDraftBytItn(apiConfig.bytedanceAsrEnableItn ?? true);
        setDraftBytEmotion(apiConfig.bytedanceAsrEnableEmotion ?? false);
        setDraftBytAucBaseUrl(apiConfig.bytedanceAucPublicBaseUrl || '');
        setDraftWebSpeechMinVolume(clampNumber(apiConfig.webSpeechMinVolume, WEB_SPEECH_DB_MIN, WEB_SPEECH_DB_MAX, -45));
    }, [
        asrProviderValue,
        apiConfig.bytedanceAsrAppKey,
        apiConfig.bytedanceAsrAccessKey,
        apiConfig.bytedanceAsrResourceId,
        apiConfig.bytedanceAsrMode,
        apiConfig.bytedanceAsrLanguage,
        apiConfig.bytedanceAsrEnablePunc,
        apiConfig.bytedanceAsrEnableItn,
        apiConfig.bytedanceAsrEnableEmotion,
        apiConfig.bytedanceAucPublicBaseUrl,
        apiConfig.webSpeechMinVolume
    ]);

    useEffect(() => {
        if (!visible) setShowSettings(false);
    }, [visible]);

    const updatePause = (value: number) => {
        const next = clampNumber(value, CALL_PAUSE_MIN, CALL_PAUSE_MAX, pauseValue);
        setDraftPause(next);
        updateApiConfig({ callPauseThreshold: next });
    };

    const updateSegment = (value: number) => {
        const next = clampNumber(value, CALL_SEGMENT_MIN, CALL_SEGMENT_MAX, segmentValue);
        setDraftSegment(next);
        updateApiConfig({ callSegmentDuration: next });
    };

    const updateAsrProvider = (value: 'web-speech' | 'faster-whisper' | 'bytedance') => {
        setDraftAsrProvider(value);
        updateApiConfig({ callAsrProvider: value });
    };

    if (!visible) return null;
    const isOutgoingPending = callState === 'dialing' && callDirection === 'user_outgoing';
    const isIncomingPending = callState === 'ringing' && callDirection === 'agent_outgoing';
    const isConnected = callState === 'connected' || callState === 'thinking' || callState === 'speaking';

    // 找到最新一个 assistant / user 气泡的 index
    const latestAssistantIdx = callBubbles.reduce((acc, b, i) => b.role === 'assistant' ? i : acc, -1);
    const latestUserIdx = callBubbles.reduce((acc, b, i) => b.role === 'user' ? i : acc, -1);
    const latestAssistantBubble = latestAssistantIdx >= 0 ? callBubbles[latestAssistantIdx] : null;
    const assistantStreamingActive = !!latestAssistantBubble && !!latestAssistantBubble.streaming;

    // 顶部状态文案
    const headerLabel = isOutgoingPending
        ? '正在呼叫...'
        : isIncomingPending
            ? '来电中'
            : callState === 'connected'
                ? '通话中'
                : callState === 'thinking' || callState === 'speaking'
                    ? '通话中'
                    : callStatusLabel;

    return (
        <>
            {/* 脉冲动画 keyframe 注入 */}
            <style>{`
                @keyframes call-pulse {
                    0% { transform: scale(0.8); opacity: 0.6; }
                    70% { transform: scale(1.4); opacity: 0; }
                    100% { opacity: 0; }
                }
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes typing-glow {
                    0% { box-shadow: 0 0 0 rgba(255,255,255,0); }
                    50% { box-shadow: 0 0 14px rgba(255,255,255,0.18); }
                    100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
                }
                .animate-fade-in { animation: fade-in 0.25s ease forwards; }
                .typing-glow { animation: typing-glow 1.6s ease-in-out infinite; }
            `}</style>

            <div className="fixed inset-0 z-[180] bg-[#0d1117] text-white flex flex-col">
                {/* 背景渐变 */}
                <div
                    className="absolute inset-0 opacity-30 pointer-events-none"
                    style={{
                        background: isConnected
                            ? 'radial-gradient(ellipse at 30% 20%, #1a3a2a 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, #1a2040 0%, transparent 60%)'
                            : 'radial-gradient(ellipse at 50% 30%, #1a1f35 0%, transparent 70%)',
                    }}
                />

                {showSettings && (
                    <div
                        className="absolute inset-0 z-[190] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
                        onClick={() => setShowSettings(false)}
                    >
                        <div
                            className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-white/10 shadow-2xl p-5 pb-6 space-y-4 max-h-[72vh] overflow-y-auto no-scrollbar"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-base font-semibold">Call Settings</div>
                                    <div className="text-xs text-white/45 mt-0.5">仅对电话聊天生效</div>
                                </div>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                                >
                                    <CloseIcon />
                                </button>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/80">停顿阈值</span>
                                    <span className="text-white/50">{draftPause} ms</span>
                                </div>
                                <input
                                    type="range"
                                    min={CALL_PAUSE_MIN}
                                    max={CALL_PAUSE_MAX}
                                    step={50}
                                    value={draftPause}
                                    onChange={(e) => updatePause(Number(e.target.value))}
                                    className="w-full accent-emerald-400"
                                />
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={CALL_PAUSE_MIN}
                                        max={CALL_PAUSE_MAX}
                                        step={50}
                                        value={draftPause}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            if (!Number.isFinite(next)) return;
                                            updatePause(next);
                                        }}
                                        className="flex-1 bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-sm outline-none"
                                    />
                                    <span className="text-xs text-white/40">ms</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/80">分段时长</span>
                                    <span className="text-white/50">{draftSegment} ms · {(draftSegment / 1000).toFixed(1)}s</span>
                                </div>
                                <input
                                    type="range"
                                    min={CALL_SEGMENT_MIN}
                                    max={CALL_SEGMENT_MAX}
                                    step={200}
                                    value={draftSegment}
                                    onChange={(e) => updateSegment(Number(e.target.value))}
                                    className="w-full accent-sky-400"
                                />
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={CALL_SEGMENT_MIN}
                                        max={CALL_SEGMENT_MAX}
                                        step={200}
                                        value={draftSegment}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            if (!Number.isFinite(next)) return;
                                            updateSegment(next);
                                        }}
                                        className="flex-1 bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-sm outline-none"
                                    />
                                    <span className="text-xs text-white/40">ms</span>
                                </div>
                            </div>

                            <div className="h-px bg-white/10"></div>

                            <div className="space-y-3">
                                <div className="text-sm font-semibold text-white/85">语音识别 (ASR)</div>
                                <div className="space-y-2">
                                    <div className="text-xs text-white/50">通话语音识别引擎</div>
                                    <select
                                        value={draftAsrProvider}
                                        onChange={(e) => updateAsrProvider(e.target.value as 'web-speech' | 'faster-whisper' | 'bytedance')}
                                        className="w-full bg-white/90 text-slate-900 rounded-lg px-3 py-2 text-sm outline-none"
                                    >
                                        <option value="web-speech">Web Speech API</option>
                                        <option value="faster-whisper">Faster-Whisper (待优化)</option>
                                        <option value="bytedance">字节语音识别 (待优化)</option>
                                    </select>
                                </div>

                                {draftAsrProvider === 'web-speech' && (
                                    <div className="space-y-3">
                                        <div className="text-[11px] text-white/45">浏览器内置识别，受系统/浏览器限制。</div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-xs text-white/70">
                                                <span>识别阈值</span>
                                                <span className="text-white/50">{Math.round(draftWebSpeechMinVolume)} dB</span>
                                            </div>
                                            <input
                                                type="range"
                                                min={WEB_SPEECH_DB_MIN}
                                                max={WEB_SPEECH_DB_MAX}
                                                step={1}
                                                value={draftWebSpeechMinVolume}
                                                onChange={(e) => {
                                                    const next = Number(e.target.value);
                                                    setDraftWebSpeechMinVolume(next);
                                                    updateApiConfig({ webSpeechMinVolume: next });
                                                }}
                                                className="w-full accent-emerald-400"
                                            />
                                            <div className="text-[10px] text-white/35">
                                                阈值越接近 0 dB 越敏感，越接近 -60 dB 越不敏感。
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {draftAsrProvider === 'bytedance' && (
                                    <div className="space-y-3">
                                        <div className="space-y-1.5">
                                            <div className="text-xs text-white/50">App Key</div>
                                            <input
                                                value={draftBytAppKey}
                                                onChange={(e) => {
                                                    const next = e.target.value.trim();
                                                    setDraftBytAppKey(next);
                                                    updateApiConfig({ bytedanceAsrAppKey: next });
                                                }}
                                                className="w-full bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-xs font-mono outline-none"
                                                placeholder="X-Api-App-Key"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs text-white/50">Access Key</div>
                                            <input
                                                value={draftBytAccessKey}
                                                onChange={(e) => {
                                                    const next = e.target.value.trim();
                                                    setDraftBytAccessKey(next);
                                                    updateApiConfig({ bytedanceAsrAccessKey: next });
                                                }}
                                                className="w-full bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-xs font-mono outline-none"
                                                placeholder="X-Api-Access-Key"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs text-white/50">Resource ID</div>
                                            <input
                                                value={draftBytResourceId}
                                                onChange={(e) => {
                                                    const next = e.target.value.trim();
                                                    setDraftBytResourceId(next);
                                                    updateApiConfig({ bytedanceAsrResourceId: next });
                                                }}
                                                className="w-full bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-xs font-mono outline-none"
                                                placeholder={draftBytMode === 'file' ? 'volc.seedasr.auc' : 'volc.seedasr.sauc.duration'}
                                            />
                                            <div className="text-[10px] text-white/40">
                                                {draftBytMode === 'file'
                                                    ? 'AUC 常用：volc.seedasr.auc / volc.bigasr.auc'
                                                    : '流式常用：volc.seedasr.sauc.duration'}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="text-xs text-white/50">模式</div>
                                            <select
                                                value={draftBytMode}
                                                onChange={(e) => {
                                                    const next = e.target.value as 'fast' | 'standard' | 'dual' | 'file';
                                                    setDraftBytMode(next);
                                                    updateApiConfig({ bytedanceAsrMode: next });
                                                }}
                                                className="w-full bg-white/90 text-slate-900 rounded-lg px-3 py-2 text-sm outline-none"
                                            >
                                                <option value="fast">双向流式优化版 (bigmodel_async)</option>
                                                <option value="dual">双向流式 (bigmodel)</option>
                                                <option value="standard">流式输入/二遍 (bigmodel_nostream)</option>
                                                <option value="file">录音文件识别 (AUC)</option>
                                            </select>
                                        </div>

                                        {draftBytMode === 'file' && (
                                            <div className="space-y-1.5">
                                                <div className="text-xs text-white/50">公网访问地址前缀</div>
                                                <input
                                                    value={draftBytAucBaseUrl}
                                                    onChange={(e) => {
                                                        const next = e.target.value.trim();
                                                        setDraftBytAucBaseUrl(next);
                                                        updateApiConfig({ bytedanceAucPublicBaseUrl: next });
                                                    }}
                                                    className="w-full bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-xs font-mono outline-none"
                                                    placeholder="https://xxxxx.ngrok.app"
                                                />
                                                <div className="text-[10px] text-white/40">
                                                    AUC 需要公网可访问的音频 URL，可用内网穿透将本地服务映射到公网。
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-1.5">
                                            <div className="text-xs text-white/50">语言 (可选)</div>
                                            <input
                                                value={draftBytLang}
                                                onChange={(e) => {
                                                    const next = e.target.value.trim();
                                                    setDraftBytLang(next);
                                                    updateApiConfig({ bytedanceAsrLanguage: next });
                                                }}
                                                className="w-full bg-white/90 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 text-xs font-mono outline-none"
                                                placeholder="zh-CN"
                                            />
                                        </div>

                                        <div className="flex items-center justify-between text-xs text-white/70">
                                            <span>标点</span>
                                            <button
                                                onClick={() => {
                                                    const next = !draftBytPunc;
                                                    setDraftBytPunc(next);
                                                    updateApiConfig({ bytedanceAsrEnablePunc: next });
                                                }}
                                                className={`px-3 py-1 rounded-full text-[11px] font-bold ${draftBytPunc ? 'bg-emerald-400/80 text-emerald-900' : 'bg-white/10 text-white/60'}`}
                                            >
                                                {draftBytPunc ? '开启' : '关闭'}
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between text-xs text-white/70">
                                            <span>ITN 规范化</span>
                                            <button
                                                onClick={() => {
                                                    const next = !draftBytItn;
                                                    setDraftBytItn(next);
                                                    updateApiConfig({ bytedanceAsrEnableItn: next });
                                                }}
                                                className={`px-3 py-1 rounded-full text-[11px] font-bold ${draftBytItn ? 'bg-emerald-400/80 text-emerald-900' : 'bg-white/10 text-white/60'}`}
                                            >
                                                {draftBytItn ? '开启' : '关闭'}
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between text-xs text-white/70">
                                            <span>情绪识别</span>
                                            <button
                                                onClick={() => {
                                                    const next = !draftBytEmotion;
                                                    setDraftBytEmotion(next);
                                                    updateApiConfig({ bytedanceAsrEnableEmotion: next });
                                                }}
                                                className={`px-3 py-1 rounded-full text-[11px] font-bold ${draftBytEmotion ? 'bg-emerald-400/80 text-emerald-900' : 'bg-white/10 text-white/60'}`}
                                            >
                                                {draftBytEmotion ? '开启' : '关闭'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 顶部区域 */}
                <div className="relative pt-[calc(env(safe-area-inset-top)+12px)] px-5 pb-5">
                    {/* 导航栏 */}
                    <div className="flex items-center justify-between mb-6">
                        <button
                            onClick={onMinimize}
                            className={`w-9 h-9 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors ${!onMinimize ? 'opacity-0 pointer-events-none' : ''}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 9.75 12 17.25 4.5 9.75" />
                            </svg>
                        </button>
                        <div className="text-xs text-white/50 font-medium tracking-wide">{headerLabel}</div>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="w-9 h-9 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors"
                            title="Call Settings"
                        >
                            <GearIcon />
                        </button>
                    </div>

                    {/* 头像 + 名字 + 计时 */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="relative">
                            <img
                                src={charDisplayAvatar}
                                className="w-20 h-20 rounded-full object-cover ring-2 ring-white/15 shadow-xl"
                                alt={charDisplayName}
                            />
                            {/* 说话时的音量指示 */}
                            {(callState === 'speaking') && (
                                <div
                                    className="absolute inset-0 rounded-full border-2 border-emerald-400/60 transition-all duration-150"
                                    style={{ transform: `scale(${1 + callVolumeLevel * 0.12})` }}
                                />
                            )}
                        </div>

                        <div className="text-center">
                            <div className="text-xl font-semibold tracking-tight">{charDisplayName}</div>
                            {isConnected ? (
                                <div className="text-sm text-white/50 mt-1 font-mono tabular-nums">
                                    {formatDuration(callElapsed)}
                                </div>
                            ) : (
                                <div className="text-sm text-white/40 mt-1">
                                    {isOutgoingPending ? '等待接听' : isIncomingPending ? `${charDisplayName} 来电` : ''}
                                </div>
                            )}
                        </div>

                        {/* 拨号/来电状态的脉冲 */}
                        {(isOutgoingPending || isIncomingPending) && (
                            <div className="mt-2">
                                <PulseRing color={isIncomingPending ? '#34d399' : '#60a5fa'} />
                            </div>
                        )}
                    </div>
                </div>

                {/* 通话气泡区域 */}
                {isConnected && (
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto px-5 py-3 space-y-3 no-scrollbar"
                    >
                        {callBubbles.length === 0 && (
                            <div className="flex justify-center">
                                <div className="text-xs text-white/25">通话中，开始说话吧</div>
                            </div>
                        )}
                        {callBubbles.map((b, i) => (
                            <CallBubbleItem
                                key={b.id}
                                bubble={b}
                                isLatestAssistant={i === latestAssistantIdx}
                                isLatestUser={i === latestUserIdx}
                                isSpeaking={callState === 'speaking'}
                            />
                        ))}
                        {/* 正在思考的状态：点点（若文本正在流式输出则不显示） */}
                        {callState === 'thinking' && !assistantStreamingActive && (
                            <div className="flex justify-start">
                                <div className="bg-white/10 rounded-2xl rounded-bl-sm px-4 py-3">
                                    <div className="flex gap-1 items-center">
                                        <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '120ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '240ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 占位：非通话状态撑开空间 */}
                {!isConnected && <div className="flex-1" />}

                {/* 底部操作栏 */}
                <div className="relative px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 border-t border-white/8">

                    {/* 拨出等待：取消按钮 */}
                    {isOutgoingPending && (
                        <div className="flex justify-center">
                            <button
                                onClick={onCancelOutgoing}
                                className="w-16 h-16 rounded-full bg-red-500 active:bg-red-600 flex items-center justify-center shadow-lg transition-colors"
                            >
                                <HangupIcon />
                            </button>
                        </div>
                    )}

                    {/* 来电：接听/拒绝 */}
                    {isIncomingPending && (
                        <div className="flex items-center justify-center gap-20">
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    onClick={onDeclineIncoming}
                                    className="w-16 h-16 rounded-full bg-white/15 active:bg-white/25 flex items-center justify-center transition-colors"
                                >
                                    <HangupIcon />
                                </button>
                                <span className="text-xs text-white/50">拒绝</span>
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    onClick={onAcceptIncoming}
                                    className="w-16 h-16 rounded-full bg-emerald-500 active:bg-emerald-400 flex items-center justify-center shadow-lg transition-colors"
                                >
                                    <AnswerIcon />
                                </button>
                                <span className="text-xs text-white/50">接听</span>
                            </div>
                        </div>
                    )}

                    {/* 通话中控制栏 */}
                    {isConnected && (
                        <div className="space-y-3">
                            {/* 输入栏 */}
                            <div className="flex items-center gap-2.5">
                                {/* 输入模式切换 */}
                                <button
                                    onClick={onToggleInputMode}
                                    className="w-11 h-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white/70 transition-colors shrink-0"
                                    title={callInputMode === 'voice' ? '切换文字输入' : '切换语音输入'}
                                >
                                    {callInputMode === 'voice' ? <KeyboardIcon /> : <MicIcon />}
                                </button>

                                {/* 静音按钮（始终可用） */}
                                <button
                                    onClick={onToggleMute}
                                    className={`flex-1 h-11 rounded-full flex items-center justify-center gap-2 text-sm font-medium transition-all active:scale-[0.97]
                                        ${callMicMuted
                                            ? 'bg-white/10 text-white/50'
                                            : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                                        }`}
                                >
                                    {callMicMuted ? (
                                        <>
                                            <MicOffIcon />
                                            <span>已静音 · 点击解除</span>
                                        </>
                                    ) : (
                                        <>
                                            <MicIcon />
                                            <span>通话中 · 点击静音</span>
                                        </>
                                    )}
                                </button>

                                {/* 挂断 */}
                                <button
                                    onClick={onHangup}
                                    className="w-11 h-11 rounded-full bg-red-500 active:bg-red-600 flex items-center justify-center shadow-md transition-colors shrink-0"
                                >
                                    <HangupIcon />
                                </button>
                            </div>

                            {/* 文字输入框（仅文字模式） */}
                            {callInputMode === 'text' && (
                                <div className="flex items-center gap-2 bg-white/10 rounded-2xl px-3 py-2 select-text">
                                    <input
                                        value={localInput}
                                        onChange={e => {
                                            setLocalInput(e.target.value);
                                            if (!isComposing) onChangeInput(e.target.value);
                                        }}
                                        onCompositionStart={() => setIsComposing(true)}
                                        onCompositionEnd={(e) => {
                                            setIsComposing(false);
                                            setLocalInput(e.currentTarget.value);
                                            onChangeInput(e.currentTarget.value);
                                        }}
                                        onKeyDown={e => {
                                            if ((e as any).isComposing || isComposing) return;
                                            if (e.key === 'Enter' && localInput.trim()) {
                                                e.preventDefault();
                                                onChangeInput(localInput);
                                                onSendText();
                                            }
                                        }}
                                        placeholder="说点什么.."
                                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 outline-none select-text"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => {
                                            if (!localInput.trim()) return;
                                            onChangeInput(localInput);
                                            onSendText();
                                        }}
                                        disabled={!localInput.trim()}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                                            ${localInput.trim() ? 'bg-white/20 text-white' : 'bg-transparent text-white/20'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                                        </svg>
                                    </button>
                                </div>
                            )}

                            {/* 语音模式状态提示 */}
                            {callInputMode === 'voice' && (
                                <div className={`text-center text-[11px] ${asrProviderValue === 'web-speech' && !callMicMuted && (belowWebSpeechThreshold || noWebSpeechSignal) ? 'text-amber-300' : 'text-white/35'}`}>
                                    {callMicMuted
                                        ? '麦克风已关闭'
                                        : asrProviderValue === 'web-speech'
                                            ? liveWebSpeechHint
                                            : callMicActive
                                                ? `正在收音 · ${Math.round(callVolumeLevel * 100)}%`
                                                : '麦克风准备就绪'}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

// 图标组件
const GearIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/80">
        <path d="M11.983 2.25a1.5 1.5 0 0 1 1.5 1.5v.53a7.497 7.497 0 0 1 2.1.878l.375-.375a1.5 1.5 0 0 1 2.121 0l.658.659a1.5 1.5 0 0 1 0 2.12l-.375.376c.39.65.673 1.38.83 2.147h.532a1.5 1.5 0 0 1 1.5 1.5v.933a1.5 1.5 0 0 1-1.5 1.5h-.531a7.48 7.48 0 0 1-.83 2.147l.374.376a1.5 1.5 0 0 1 0 2.12l-.658.659a1.5 1.5 0 0 1-2.12 0l-.376-.376a7.496 7.496 0 0 1-2.1.878v.53a1.5 1.5 0 0 1-1.5 1.5h-.934a1.5 1.5 0 0 1-1.5-1.5v-.53a7.496 7.496 0 0 1-2.1-.878l-.376.376a1.5 1.5 0 0 1-2.12 0l-.659-.659a1.5 1.5 0 0 1 0-2.12l.376-.376a7.48 7.48 0 0 1-.83-2.147H3.75a1.5 1.5 0 0 1-1.5-1.5v-.933a1.5 1.5 0 0 1 1.5-1.5h.531a7.48 7.48 0 0 1 .83-2.147l-.376-.376a1.5 1.5 0 0 1 0-2.12l.659-.659a1.5 1.5 0 0 1 2.12 0l.376.376a7.496 7.496 0 0 1 2.1-.878v-.53a1.5 1.5 0 0 1 1.5-1.5h.933Zm.017 6.75a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/80">
        <path d="M6.22 6.22a.75.75 0 0 1 1.06 0L12 10.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L13.06 12l4.72 4.72a.75.75 0 1 1-1.06 1.06L12 13.06l-4.72 4.72a.75.75 0 1 1-1.06-1.06L10.94 12 6.22 7.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
);

const HangupIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white rotate-[135deg]">
        <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 0 0 6.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
    </svg>
);

const AnswerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
        <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 0 0 6.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
    </svg>
);

const MicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
    </svg>
);

const MicOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
    </svg>
);

const KeyboardIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Zm-9.75 3.75h.008v.008H11.25v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM9 9h.008v.008H9V9Zm.375 0A.375.375 0 1 1 9 9a.375.375 0 0 1 .375 0Zm-.375 3h.008v.008H9V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3-3H12v.008h-.008V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3-3h.008v.008H15V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM15 12h.008v.008H15V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
);

export default CallOverlay;
