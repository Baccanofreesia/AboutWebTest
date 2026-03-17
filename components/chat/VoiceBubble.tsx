/**
 * VoiceBubble — 语音消息气泡 (v3)
 * 
 * 功能:
 * - 播放/暂停 + 声波 + 时长 (全在气泡内)
 * - 最大宽度 60vw
 * - 播放互斥 (全局只能播放一个)
 * - 语音转文字: 气泡下方显示转写文字 (可复制)
 * - 长按菜单: 「转文字」选项
 * - 气泡旁 "文" 按钮: 点击触发转文字
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

// Global audio tracking for mutual exclusion
let currentPlayingId: string | null = null;
let currentAudio: HTMLAudioElement | null = null;
const stopCurrentAudio = () => {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
        currentPlayingId = null;
    }
};

interface VoiceBubbleProps {
    audioUrl: string;
    duration: number;
    isUser: boolean;
    transcription?: string;   // 已有的转写文本
    onRequestTranscription?: () => void;  // 请求转写回调
    onDelete?: () => void;               // 暴露给外部的删除操作
    bubbleColor?: string;
    textColor?: string;
}

const VoiceBubble: React.FC<VoiceBubbleProps> = ({
    audioUrl,
    duration,
    isUser,
    transcription,
    onRequestTranscription,
    onDelete,
    bubbleColor,
    textColor,
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [showTranscription, setShowTranscription] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [copied, setCopied] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const animRef = useRef<number>(0);
    const instanceId = useRef(`voice_${Date.now()}_${Math.random()}`);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return () => {
            if (currentPlayingId === instanceId.current) stopCurrentAudio();
            if (animRef.current) cancelAnimationFrame(animRef.current);
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
        };
    }, []);

    // NOTE: transcription is NOT auto-shown — user must click '文' button to reveal

    // Close menu on outside click
    useEffect(() => {
        if (!showMenu) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('touchstart', handleClick as any);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('touchstart', handleClick as any);
        };
    }, [showMenu]);

    // Mutual exclusion check
    useEffect(() => {
        const check = setInterval(() => {
            if (isPlaying && currentPlayingId !== instanceId.current) {
                setIsPlaying(false);
                setProgress(0);
            }
        }, 200);
        return () => clearInterval(check);
    }, [isPlaying]);

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            stopCurrentAudio();
            setIsPlaying(false);
            setProgress(0);
            if (animRef.current) cancelAnimationFrame(animRef.current);
            return;
        }
        stopCurrentAudio();
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        currentAudio = audio;
        currentPlayingId = instanceId.current;
        audio.onended = () => {
            setIsPlaying(false);
            setProgress(0);
            if (animRef.current) cancelAnimationFrame(animRef.current);
            if (currentPlayingId === instanceId.current) { currentAudio = null; currentPlayingId = null; }
        };
        audio.play().catch(() => {});
        setIsPlaying(true);
        const update = () => {
            if (audio && !audio.paused) {
                setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
                animRef.current = requestAnimationFrame(update);
            }
        };
        update();
    }, [audioUrl, isPlaying]);

    const handlePressStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        e.stopPropagation();
        longPressTimer.current = setTimeout(() => {
            setShowMenu(true);
            longPressTimer.current = null;
        }, 500); // Trigger slightly faster
    }, []);

    const handlePressEnd = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        e.stopPropagation();
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handlePressClick = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        e.stopPropagation();
        if (!showMenu) togglePlay();
    }, [showMenu, togglePlay]);

    const handleCopyTranscription = useCallback(() => {
        if (transcription) {
            navigator.clipboard.writeText(transcription).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            });
        }
    }, [transcription]);

    const handleTranscribe = useCallback(() => {
        setShowMenu(false);
        if (transcription) {
            // Already transcribed — toggle visibility
            setShowTranscription(prev => !prev);
        } else {
            onRequestTranscription?.();
        }
    }, [transcription, onRequestTranscription]);

    // Width based on duration
    const bubbleWidth = Math.min(
        typeof window !== 'undefined' ? window.innerWidth * 0.6 : 220,
        Math.max(100, 80 + duration * 10)
    );

    const defaultBg = isUser ? '#3b82f6' : '#f1f5f9';
    const defaultFg = isUser ? '#ffffff' : '#334155';
    const bg = bubbleColor || defaultBg;
    const fg = textColor || defaultFg;

    const barCount = Math.min(16, Math.max(6, Math.floor(duration * 1.5) + 4));
    const barHeights = Array.from({ length: barCount }).map((_, i) => {
        const seed = (i * 7 + 3) % 11;
        return 4 + seed * 1.2;
    });

    return (
        <div className="flex flex-col gap-1" style={{ maxWidth: '65vw' }}>
            {/* Voice bubble row */}
            <div className={`flex items-center gap-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Main bubble */}
                <div
                    onMouseDown={handlePressStart}
                    onMouseUp={handlePressEnd}
                    onMouseLeave={handlePressEnd}
                    onTouchStart={handlePressStart}
                    onTouchEnd={handlePressEnd}
                    onClick={handlePressClick}
                    className="rounded-2xl cursor-pointer select-none active:scale-[0.97] transition-transform overflow-hidden relative"
                    style={{ backgroundColor: bg, width: bubbleWidth, maxWidth: '60vw' }}
                >
                    <div className="flex items-center gap-2 px-3 py-2.5">
                        {/* Play/Pause */}
                        <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                            {isPlaying ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill={fg}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill={fg}><path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" /></svg>
                            )}
                        </div>
                        {/* Waveform */}
                        <div className="flex-1 flex items-center justify-center gap-[2px] min-w-0 overflow-hidden">
                            {barHeights.map((h, i) => {
                                const isActive = isPlaying && progress >= i / barCount;
                                return (
                                    <div key={i} className="rounded-full transition-all duration-150 shrink-0"
                                        style={{ width: 2, height: h, backgroundColor: fg, opacity: isActive ? 1 : 0.3 }} />
                                );
                            })}
                        </div>
                        {/* Duration */}
                        <span className="text-[11px] font-bold shrink-0 tabular-nums ml-1" style={{ color: fg, opacity: 0.75 }}>
                            {duration}"
                        </span>
                    </div>

                    {/* Long-press context menu */}
                    {showMenu && (
                        <div
                            ref={menuRef}
                            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[#2c2c2c] rounded-xl shadow-xl py-1 min-w-[120px] z-50"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {!showTranscription && transcription && (
                                <button onClick={() => { setShowTranscription(true); setShowMenu(false); }}
                                    className="w-full px-4 py-2.5 text-white text-sm text-center hover:bg-white/10 transition-colors">
                                    显示转写
                                </button>
                            )}
                            {!transcription && (
                                <button onClick={(e) => { e.stopPropagation(); handleTranscribe(); }}
                                    className="w-full px-4 py-2.5 text-white text-sm text-center hover:bg-white/10 transition-colors">
                                    转文字
                                </button>
                            )}
                            {transcription && (
                                <button onClick={handleCopyTranscription}
                                    className="w-full px-4 py-2.5 text-white text-sm text-center hover:bg-white/10 transition-colors">
                                    {copied ? '已复制' : '复制文字'}
                                </button>
                            )}
                            {onDelete && (
                                <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }}
                                    className="w-full px-4 py-2.5 text-red-400 text-sm text-center hover:bg-white/10 transition-colors border-t border-white/10 mt-1">
                                    删除
                                </button>
                            )}
                            <button onClick={() => setShowMenu(false)}
                                className="w-full px-4 py-2.5 text-white/50 text-sm text-center hover:bg-white/10 transition-colors border-t border-white/10">
                                取消
                            </button>
                        </div>
                    )}
                </div>

                {/* Transcribe/Toggle button (beside bubble, like translation button) */}
                {transcription && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowTranscription(prev => !prev); }}
                        className={`shrink-0 text-[11px] transition-colors px-1 py-0.5 rounded ${showTranscription ? 'text-primary' : 'text-slate-400 hover:text-primary'
                            }`}
                        title={showTranscription ? '隐藏转写' : '显示转写'}
                    >
                        <span className="flex items-center gap-0.5">
                            文
                        </span>
                    </button>
                )}
                {!transcription && onRequestTranscription && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRequestTranscription(); }}
                        className="shrink-0 text-[11px] text-slate-400 hover:text-primary transition-colors px-1 py-0.5 rounded"
                        title="语音转文字"
                    >
                        <span className="flex items-center gap-0.5">
                            文
                        </span>
                    </button>
                )}
            </div>

            {/* Transcription text (below bubble, copyable) */}
            {showTranscription && transcription && (
                <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                        className={`text-[13px] leading-relaxed px-3 py-1.5 rounded-lg select-text cursor-text max-w-full ${isUser ? 'bg-blue-50 text-slate-700' : 'bg-slate-50 text-slate-600'
                            }`}
                        style={{ maxWidth: bubbleWidth }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {transcription}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VoiceBubble;
