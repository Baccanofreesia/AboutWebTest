/**
 * VoiceRecorder — 微信风格录音面板 (v4 - 精确复刻微信)
 * 
 * 参考微信截图:
 * - 全屏半透明暗色遮罩，聊天内容可见
 * - 底部: 左「取消」 右「滑到这里 转文字」
 * - 最底部: 「松开 发送」大字
 * - 上方: 绿色/蓝色语音波形气泡
 * 
 * 交互: 长按 → 录音 → 松手发送 / 滑左取消 / 滑右转文字
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';

export type VoiceAction = 'send' | 'text' | 'cancel' | 'too_short';

interface VoiceRecorderProps {
    isRecording: boolean;
    duration: number;
    volumeLevel: number;
    onAction: (action: VoiceAction) => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    isRecording,
    duration,
    volumeLevel,
    onAction,
}) => {
    const [activeZone, setActiveZone] = useState<'send' | 'text' | 'cancel'>('send');
    const containerRef = useRef<HTMLDivElement>(null);

    const formatDuration = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const getZoneFromPoint = useCallback((clientX: number, clientY: number): 'send' | 'text' | 'cancel' => {
        if (!containerRef.current) return 'send';
        const rect = containerRef.current.getBoundingClientRect();
        const relX = (clientX - rect.left) / rect.width;
        const bottomY = rect.bottom - clientY;
        // Bottom 140px area contains the action zones
        if (bottomY > 60 && bottomY < 200) {
            if (relX < 0.35) return 'cancel';
            if (relX > 0.65) return 'text';
        }
        return 'send';
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (touch) setActiveZone(getZoneFromPoint(touch.clientX, touch.clientY));
    }, [getZoneFromPoint]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isRecording) setActiveZone(getZoneFromPoint(e.clientX, e.clientY));
    }, [isRecording, getZoneFromPoint]);

    const handleRelease = useCallback(() => {
        if (duration < 1) {
            onAction('too_short');
            return;
        }
        onAction(activeZone);
    }, [duration, activeZone, onAction]);

    // 60s Auto-send limit
    useEffect(() => {
        if (duration >= 60 && isRecording) {
            handleRelease();
        }
    }, [duration, isRecording, handleRelease]);

    // Waveform bars for the voice indicator
    const waveformBars = Array.from({ length: 16 }).map((_, i) => {
        const center = 8;
        const dist = Math.abs(i - center) / center;
        const base = 0.2 + (1 - dist) * 0.3;
        const dynamic = isRecording ? volumeLevel * (1 - dist * 0.4) * 0.8 : 0;
        return Math.min(1, base + dynamic);
    });

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-[200] flex flex-col justify-end select-none"
            style={{ touchAction: 'none' }}
            onTouchMove={handleTouchMove}
            onMouseMove={handleMouseMove}
            onTouchEnd={(e) => { e.preventDefault(); handleRelease(); }}
            onMouseUp={handleRelease}
        >
            {/* Semi-transparent dark overlay */}
            <div className="absolute inset-0 bg-black/50" />

            {/* Voice waveform indicator (floating in center area) */}
            <div className="relative z-10 flex-1 flex items-center justify-center -translate-y-8">
                {/* WeChat recording bubble usually is slightly transparent or solid. Using grayish-purple as requested */}
                <div className="bg-[#b5b8d6]/95 rounded-[24px] px-8 py-5 flex flex-col items-center gap-3 shadow-2xl backdrop-blur-sm min-w-[160px]">
                    {/* Waveform */}
                    <div className="flex items-center justify-center gap-[3px] h-10">
                        {waveformBars.map((h, i) => (
                            <div
                                key={i}
                                className="rounded-full transition-all duration-75"
                                style={{
                                    width: 3.5,
                                    height: `${h * 32}px`,
                                    backgroundColor: 'white',
                                    opacity: 0.5 + h * 0.5,
                                }}
                            />
                        ))}
                    </div>
                    {/* Timer */}
                    <div className="text-white text-base font-bold tracking-widest tabular-nums mt-1">
                        {formatDuration(duration)}
                    </div>
                </div>
            </div>

            {/* Bottom action panel */}
            <div className="relative z-10 bg-[#3a3a3a] px-8 pt-8 pb-10 rounded-t-[32px] shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
                {/* Cancel + Text zones */}
                <div className="flex items-start justify-between px-4 mb-6">
                    {/* Cancel zone */}
                    <div className={`flex flex-col items-center gap-3 transition-transform duration-200 ${activeZone === 'cancel' ? 'scale-110 -translate-y-2' : ''
                        }`}>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-200 ${activeZone === 'cancel'
                            ? 'bg-red-500 shadow-xl shadow-red-500/30'
                            : 'bg-[#4c4c4c]'
                            }`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="white" className="w-8 h-8">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <span className={`text-[13px] font-medium transition-colors ${activeZone === 'cancel' ? 'text-red-400' : 'text-white/60'
                            }`}>取消</span>
                    </div>

                    {/* Text conversion zone */}
                    <div className={`flex flex-col items-center gap-3 transition-transform duration-200 ${activeZone === 'text' ? 'scale-110 -translate-y-2' : ''
                        }`}>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-200 ${activeZone === 'text'
                            ? 'bg-[#b5b8d6] shadow-xl shadow-[#b5b8d6]/30'
                            : 'bg-[#4c4c4c]'
                            }`}>
                            <span className="text-white text-2xl font-bold">文</span>
                        </div>
                        <span className={`text-[13px] font-medium transition-colors whitespace-nowrap ${activeZone === 'text' ? 'text-[#b5b8d6]' : 'text-white/60'
                            }`}>滑到这里 转文字</span>
                    </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-white/10 mx-4 mb-4" />

                {/* Bottom hint */}
                <div className="text-center">
                    <span className={`text-base font-bold ${activeZone === 'cancel' ? 'text-red-400'
                        : activeZone === 'text' ? 'text-blue-400'
                            : 'text-white/60'
                        }`}>
                        {activeZone === 'send' && '松开 发送'}
                        {activeZone === 'cancel' && '松开手指，取消发送'}
                        {activeZone === 'text' && '松开手指，转文字发送'}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default VoiceRecorder;
