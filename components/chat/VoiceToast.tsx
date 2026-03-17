/**
 * VoiceToast — 微信风格居中提示弹窗
 * 
 * 改进: 使用 fixed + inset-0 确保在整个屏幕居中 (不受父容器影响)
 * 使用 React Portal 确保渲染在 body 级别
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface VoiceToastProps {
    message: string;
    visible: boolean;
    onDismiss: () => void;
    autoDismissMs?: number;
}

const VoiceToast: React.FC<VoiceToastProps> = ({
    message,
    visible,
    onDismiss,
    autoDismissMs = 1500,
}) => {
    const [show, setShow] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (visible) {
            setShow(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                setShow(false);
                setTimeout(onDismiss, 300);
            }, autoDismissMs);
        }
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [visible, autoDismissMs, onDismiss]);

    if (!visible && !show) return null;

    // Use Portal to render at document.body level — ensures true screen-center positioning
    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 9999 }}
        >
            <div className={`bg-[#4c4c4c] rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl transition-all duration-300 ${show ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
                }`}
                style={{ minWidth: '160px', maxWidth: '220px' }}
            >
                {/* Warning icon */}
                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                    <span className="text-[#4c4c4c] text-2xl font-bold">!</span>
                </div>
                <span className="text-white text-base font-bold text-center leading-snug">
                    {message}
                </span>
            </div>
        </div>,
        document.body
    );
};

export default VoiceToast;

/**
 * useVoiceToast — Hook 用于管理防抖弹窗状态
 */
export function useVoiceToast() {
    const [toastMsg, setToastMsg] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((msg: string) => {
        if (debounceRef.current) return;
        setToastMsg(msg);
        setToastVisible(true);
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
        }, 2000);
    }, []);

    const dismissToast = useCallback(() => {
        setToastVisible(false);
    }, []);

    return { toastMsg, toastVisible, showToast, dismissToast };
}
