import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Message, ChatTheme } from '../../types';
import { fsBridge } from '../../utils/fsBridge';
import { DB } from '../../utils/db';
import { fileExt } from '../../utils/chatFiles';
import VoiceBubble from './VoiceBubble';

interface MessageItemProps {
    msg: Message;
    isFirstInGroup: boolean;
    isLastInGroup: boolean;
    activeTheme: ChatTheme;
    charAvatar: string;
    charName: string;
    userAvatar: string;
    onLongPress: (m: Message) => void;
    translationEnabled?: boolean;
    isShowingTarget?: boolean;
    onTranslateToggle?: (msgId: number) => void;
    selectionMode?: boolean;
    isSelected?: boolean;
    onSelectionToggle?: (msgId: number) => void;
    workspaceRootPath?: string;
    allowGlobal?: boolean;
    onUpdateMessage?: (msgId: number, metadata: any) => void;
    onDirectDelete?: (msg: Message) => void;
}

interface LinkPreviewData {
    url: string;
    title: string;
    description?: string;
    image?: string;
    siteName?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"'）)\]]+/gi;
const linkPreviewCache = new Map<string, LinkPreviewData | null>();

const normalizeUrlToken = (token: string) => token.replace(/[.,!?;:]+$/g, '').trim();
const extractUrls = (text: string): string[] => {
    const matches = text.match(URL_REGEX) || [];
    const list = matches.map(normalizeUrlToken).filter(Boolean);
    return Array.from(new Set(list)).slice(0, 3);
};

const hostOf = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const fetchLinkPreview = async (url: string): Promise<LinkPreviewData | null> => {
    try {
        const m = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=false&meta=true`);
        if (m.ok) {
            const data = await m.json();
            const d = data?.data;
            if (d?.title) {
                return { url, title: d.title, description: d.description || '', image: d.image?.url || d.logo?.url || '', siteName: d.publisher || hostOf(url) };
            }
        }
    } catch { }
    try {
        const j = await fetch(`https://jsonlink.io/api/extract?url=${encodeURIComponent(url)}`);
        if (j.ok) {
            const data = await j.json();
            if (data?.title) {
                return { url, title: data.title, description: data.description || '', image: data.images?.[0] || '', siteName: data.site_name || hostOf(url) };
            }
        }
    } catch { }
    return null;
};

const VoiceMessageRenderer: React.FC<{
    m: Message;
    isUser: boolean;
    styleConfig: any;
    workspaceRootPath: string;
    allowGlobal: boolean;
    onUpdateMessage?: (msgId: number, metadata: any) => void;
    onDirectDelete?: (msg: Message) => void;
}> = ({ m, isUser, styleConfig, workspaceRootPath, allowGlobal, onUpdateMessage, onDirectDelete }) => {
    const [audioUrl, setAudioUrl] = useState(m.content?.startsWith('workspace://') ? '' : m.content || '');
    const stripVoiceLogPrefix = (text: string) =>
        text.replace(/^\s*(?:\[\s*)?(?:你|用户|User|Assistant)\s*发送了语音消息\s*\d+(?:\.\d+)?\s*秒(?:\s*,\s*无法转写)?\s*(?:\]\s*)?[:：]?\s*/i, '').trim();

    useEffect(() => {
        if (m.content?.startsWith('workspace://')) {
            const relPath = m.content.replace('workspace://', '');
            if (workspaceRootPath) {
                fsBridge.readFileBase64(workspaceRootPath, relPath, allowGlobal)
                    .then(b64 => {
                        const ext = relPath.split('.').pop() || 'webm';
                        setAudioUrl(`data:audio/${ext};base64,${b64}`);
                    })
                    .catch(e => console.error("Failed to load voice", e));
            }
        } else {
            setAudioUrl(m.content || '');
        }
    }, [m.content, workspaceRootPath, allowGlobal]);

    const voiceDuration = m.metadata?.duration || 0;
    const voiceTranscription = stripVoiceLogPrefix(m.metadata?.transcription || '');

    return (
        <VoiceBubble
            audioUrl={audioUrl}
            duration={voiceDuration}
            isUser={isUser}
            transcription={voiceTranscription}
            onRequestTranscription={onUpdateMessage ? () => {
                if (!voiceTranscription) {
                    onUpdateMessage(m.id, { ...m.metadata, transcription: '(转写功能需要在录音时使用)' });
                }
            } : undefined}
            onDelete={onDirectDelete ? () => onDirectDelete(m) : undefined}
            bubbleColor={styleConfig.backgroundColor}
            textColor={styleConfig.textColor}
        />
    );
};

const MessageItem = React.memo(({
    msg: m,
    isFirstInGroup,
    isLastInGroup,
    activeTheme,
    charAvatar,
    charName,
    userAvatar,
    onLongPress,
    translationEnabled = false,
    isShowingTarget = false,
    onTranslateToggle,
    selectionMode = false,
    isSelected = false,
    onSelectionToggle,
    workspaceRootPath = '',
    allowGlobal = false,
    onUpdateMessage,
    onDirectDelete,
}: MessageItemProps) => {
    const isUser = m.role === 'user';
    const isSystem = m.role === 'system';
    const marginBottom = isLastInGroup ? 'mb-6' : 'mb-1.5';
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const styleConfig = isUser ? activeTheme.user : activeTheme.ai;
    const [fileDownloading, setFileDownloading] = useState(false);
    const [fileAudioSrc, setFileAudioSrc] = useState('');
    const [filePreviewOpen, setFilePreviewOpen] = useState(false);
    const [filePreviewLoading, setFilePreviewLoading] = useState(false);
    const [filePreviewText, setFilePreviewText] = useState('');
    const [filePreviewPdfDataUrl, setFilePreviewPdfDataUrl] = useState('');
    const [callDetailOpen, setCallDetailOpen] = useState(false);
    const [callDetailLoading, setCallDetailLoading] = useState(false);
    const [callDetailItems, setCallDetailItems] = useState<Message[]>([]);
    const callSessionId = m.metadata?.callSessionId;

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!callDetailOpen || m.metadata?.source !== 'call-end-popup' || !callSessionId) return;
            if (callDetailItems.length > 0) return;
            setCallDetailLoading(true);
            try {
                const all = await DB.getMessagesByCharId(m.charId);
                const list = all.filter(msg => msg.metadata?.source === 'call' && msg.metadata?.callSessionId === callSessionId);
                if (!cancelled) setCallDetailItems(list);
            } catch {
                if (!cancelled) setCallDetailItems([]);
            } finally {
                if (!cancelled) setCallDetailLoading(false);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [callDetailOpen, callSessionId, callDetailItems.length, m.charId, m.metadata?.source]);

    const handleTouchStart = () => {
        if (selectionMode) return;
        longPressTimer.current = setTimeout(() => onLongPress(m), 600);
    };

    const handleTouchEnd = () => {
        if (selectionMode) return;
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const interactionProps = {
        onMouseDown: handleTouchStart,
        onMouseUp: handleTouchEnd,
        onMouseLeave: handleTouchEnd,
        onTouchStart: handleTouchStart,
        onTouchEnd: handleTouchEnd,
        onClick: () => {
            if (selectionMode) onSelectionToggle?.(m.id);
        },
        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            if (selectionMode) onSelectionToggle?.(m.id);
            else onLongPress(m);
        }
    };

    const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    const renderAvatar = (src: string) => (
        <div className="relative w-9 h-9 shrink-0 self-end mb-5 z-0">
            {isLastInGroup && (
                <>
                    <img src={src} className="w-full h-full rounded-full object-cover shadow-sm ring-1 ring-black/5 relative z-0" alt="avatar" loading="lazy" decoding="async" />
                    {styleConfig.avatarDecoration && (
                        <img
                            src={styleConfig.avatarDecoration}
                            className="absolute pointer-events-none z-10 max-w-none"
                            style={{
                                left: `${styleConfig.avatarDecorationX ?? 50}%`,
                                top: `${styleConfig.avatarDecorationY ?? 50}%`,
                                width: `${36 * (styleConfig.avatarDecorationScale ?? 1)}px`,
                                height: 'auto',
                                transform: `translate(-50%, -50%) rotate(${styleConfig.avatarDecorationRotate ?? 0}deg)`
                            }}
                        />
                    )}
                </>
            )}
        </div>
    );

    if (isSystem) {
        const isCallSummary = m.metadata?.source === 'call-end-popup';
        const isCallLog = m.metadata?.source === 'call-log';
        const displayText = m.content.replace(/^\[(System|系统|System Log|系统记录)\s*[:：]?\s*/i, '').replace(/\]$/, '').trim();

        const renderSystemWrapper = (content: React.ReactNode) => (
            <div
                className={`flex items-center w-full ${selectionMode ? 'pl-14' : ''} animate-fade-in relative transition-[padding] duration-300`}
                onClick={(e) => {
                    if (selectionMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectionToggle?.(m.id);
                    }
                }}
            >
                {selectionMode && (
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full border-[1.5px] border-slate-300 bg-white shadow-sm flex items-center justify-center transition-all z-50">
                        {isSelected && <div className="w-[12px] h-[12px] rounded-full bg-blue-500"></div>}
                    </div>
                )}
                <div className="flex justify-center my-6 px-10 w-full" {...(!selectionMode ? interactionProps : {})}>
                    {content}
                </div>
            </div>
        );

        if (isCallSummary) {
            const durationSec = Math.max(1, Number(m.metadata?.durationSec || 0));
            const turnCount = Math.max(1, Number(m.metadata?.turnCount || 1));
            const durationText = `${String(Math.floor(durationSec / 60)).padStart(2, '0')}:${String(durationSec % 60).padStart(2, '0')}`;
            const memoTitle = m.metadata?.characterName || charName;
            const memoAvatar = m.metadata?.characterAvatar || charAvatar;
            const callMemo = String(m.metadata?.keepsakeLine || `“今天这通电话，我会记很久。” —— ${memoTitle}`);

            return renderSystemWrapper(
                <div className="rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100/80 border border-slate-200/50 p-4 shadow-sm w-full max-w-[380px]">
                    <div className="flex items-center gap-3">
                        <img src={memoAvatar} alt={memoTitle} className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200/80" loading="lazy" decoding="async" />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-600 truncate">和 {memoTitle} 通了电话</div>
                            <div className="text-xs text-slate-400 mt-0.5">{durationText} · {turnCount} 轮对话</div>
                        </div>
                    </div>
                    <div className="mt-3 rounded-2xl bg-white/70 border border-slate-100 px-3.5 py-2.5 text-[13px] italic leading-relaxed text-slate-500">
                        {callMemo}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                        <button
                            className="text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                setCallDetailOpen(prev => !prev);
                            }}
                        >
                            {callDetailOpen ? '收起记录' : '查看记录'}
                        </button>
                        <span className="text-[10px] text-slate-400">通话记录</span>
                    </div>
                    {callDetailOpen && (
                        <div className="mt-2 rounded-2xl bg-white/80 border border-slate-100 px-3 py-2.5 text-[12px] text-slate-500 space-y-1.5 max-h-36 overflow-y-auto">
                            {callDetailLoading && <div className="text-slate-400">加载中...</div>}
                            {!callDetailLoading && callDetailItems.length === 0 && (
                                <div className="text-slate-400">暂无记录</div>
                            )}
                            {!callDetailLoading && callDetailItems.map(item => (
                                <div key={item.id} className="leading-relaxed">
                                    <span className="mr-1 text-slate-400">{item.role === 'user' ? '我' : memoTitle}:</span>
                                    <span>{item.content}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (isCallLog) {
            const variant = String(m.metadata?.variant || '').toLowerCase();
            const icon = variant === 'declined' ? '📵' : variant === 'canceled' ? '❌' : variant === 'missed' ? '☎️' : '📞';
            const toneClass = variant === 'declined'
                ? 'bg-red-50 text-red-500 border-red-100'
                : variant === 'connected'
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                    : 'bg-slate-200/40 text-slate-500 border-white/20';
            return renderSystemWrapper(
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full shadow-sm border select-none ${toneClass}`}>
                    <span>{icon}</span>
                    <span className="text-[10px] font-medium tracking-wide">{displayText}</span>
                </div>
            );
        }

        return renderSystemWrapper(
            <div className="flex items-center gap-1.5 bg-slate-200/40 backdrop-blur-md text-slate-500 px-3 py-1 rounded-full shadow-sm border border-white/20 select-none">
                {displayText.includes('任务') ? '✅' : displayText.includes('纪念日') || displayText.includes('Event') ? '📅' : displayText.includes('转账') ? '💵' : '🔔'}
                <span className="text-[10px] font-medium tracking-wide">{displayText}</span>
            </div>
        );
    }

    if (m.type === 'interaction') {

        return (
            <div className={`flex flex-col items-center ${marginBottom} w-full animate-fade-in`}>
                <div className="text-[10px] text-slate-400 mb-1 opacity-70">{formatTime(m.timestamp)}</div>
                <div className="group relative cursor-pointer active:scale-95 transition-transform" {...interactionProps}>
                    <div className="text-[11px] text-slate-500 bg-slate-200/50 backdrop-blur-sm px-4 py-1.5 rounded-full flex items-center gap-1.5 border border-white/40 shadow-sm select-none">
                        <span className="group-hover:animate-bounce">👉</span>
                        <span className="font-medium opacity-80">{isUser ? '你' : charName}</span>
                        <span className="opacity-60">戳了戳</span>
                        <span className="font-medium opacity-80">{isUser ? charName : '你'}</span>
                    </div>
                </div>
            </div>
        );
    }
    // MessageItem.tsx 里加这个 hook
    const useLocalImage = (url: string, workspaceRootPath: string, allowGlobal: boolean) => {
        const [dataUrl, setDataUrl] = useState<string>('');
        useEffect(() => {
            if (!url.startsWith('local://')) return;
            const relPath = url.replace('local://', '');
            fsBridge.readFileBase64(workspaceRootPath, relPath, allowGlobal)
                .then(base64 => {
                    const ext = relPath.split('.').pop()?.toLowerCase() || 'png';
                    const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
                    setDataUrl(`data:${mime};base64,${base64}`);
                })
                .catch(() => setDataUrl(''));
        }, [url, workspaceRootPath, allowGlobal]);
        return dataUrl;
    };

    const commonLayout = (content: React.ReactNode) => (
        <div
            className={`relative flex items-end ${isUser ? 'justify-end' : 'justify-start'} ${marginBottom} px-3 group select-none transition-all duration-200 ${selectionMode ? 'pl-14 bg-black/5 py-1.5' : ''}`}
            onClick={(e) => {
                if (selectionMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectionToggle?.(m.id);
                }
            }}
        >
            {selectionMode && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full border-[1.5px] border-slate-300 bg-white shadow-sm flex items-center justify-center transition-all z-50">
                    {isSelected && <div className="w-[12px] h-[12px] rounded-full bg-blue-500"></div>}
                </div>
            )}
            {!isUser && <div className="mr-3 pointer-events-auto">{renderAvatar(charAvatar)}</div>}
            <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%] ${selectionMode ? 'pointer-events-none' : 'pointer-events-auto'}`} {...(!selectionMode ? interactionProps : {})}>
                {content}
                {isLastInGroup && <div className="text-[9px] text-slate-400/80 px-1 mt-1 font-medium">{formatTime(m.timestamp)}</div>}
            </div>
            {isUser && <div className="ml-3 pointer-events-auto">{renderAvatar(userAvatar)}</div>}
        </div>
    );

    if (m.type === 'transfer') {
        return commonLayout(
            <div className="w-64 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-4 text-white shadow-lg relative overflow-hidden group active:scale-[0.98] transition-transform">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-white/20 rounded-full">💸</div>
                    <span className="font-medium text-white/90">Sully Pay</span>
                </div>
                <div className="text-2xl font-bold tracking-tight mb-1">₩ {m.metadata?.amount}</div>
                <div className="text-[10px] text-white/70">转账给{isUser ? charName : '你'}</div>
            </div>
        );
    }

    if (m.type === 'emoji') {
        const isLocal = m.content.startsWith('local://');
        const EmojiImg = ({ url }: { url: string }) => {
            const localSrc = useLocalImage(url, workspaceRootPath, allowGlobal);
            const src = isLocal ? localSrc : url;
            if (isLocal && !localSrc) return <div className="w-16 h-16 bg-slate-100 rounded-xl animate-pulse" />;
            return <img src={src} className="w-16 h-16 object-contain rounded-xl" alt="sticker" />;
        };
        return commonLayout(<EmojiImg url={m.content} />);
    }
    if (m.type === 'image') return commonLayout(<div className="relative group"><img src={m.content} className="max-w-[200px] max-h-[300px] rounded-2xl shadow-sm border border-black/5" alt="Uploaded" loading="lazy" decoding="async" /></div>);
    if (m.type === 'video') return commonLayout(
        <div className="relative group max-w-[220px]">
            <video
                src={m.content}
                controls
                className="max-w-[220px] max-h-[320px] rounded-2xl shadow-sm border border-black/5 bg-black"
                onClick={(e) => {
                    const v = e.currentTarget;
                    if (v.paused) v.play();
                    else v.pause();
                }}
            />
        </div>
    );
    if (m.type === 'file') {
        const fileName = (m.metadata?.fileName || '未命名文件').toString();
        const filePath = ((m.metadata?.workspacePath || '').toString()).replace(/^\/+/, '');
        const mimeType = (m.metadata?.mimeType || '').toString();
        const previewText = (m.metadata?.previewText || '').toString();
        const category = (m.metadata?.category || '').toString();
        const size = Number(m.metadata?.size || 0);
        const prettySize = size > 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(2)} MB` : size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
        const ext = fileExt(fileName);
        const canTextPreview = ['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext);
        const canPdfPreview = ext === 'pdf' || mimeType.includes('pdf');
        const canInlinePreview = canTextPreview || canPdfPreview;

        const handleDownload = async (playAudio: boolean = false) => {
            if (!workspaceRootPath || !filePath) return;
            setFileDownloading(true);
            try {
                const b64 = await fsBridge.readFileBase64(workspaceRootPath, filePath, allowGlobal);
                const mt = mimeType || 'application/octet-stream';
                const dataUrl = `data:${mt};base64,${b64}`;
                if (playAudio) {
                    setFileAudioSrc(dataUrl);
                    return;
                }
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } finally {
                setFileDownloading(false);
            }
        };

        const handlePreview = async () => {
            if (!workspaceRootPath || !filePath || !canInlinePreview) return;
            setFilePreviewOpen(true);
            setFilePreviewLoading(true);
            try {
                if (canTextPreview) {
                    const txt = await fsBridge.readFile(workspaceRootPath, filePath, allowGlobal);
                    setFilePreviewText((txt || '').slice(0, 200000));
                    setFilePreviewPdfDataUrl('');
                } else if (canPdfPreview) {
                    const b64 = await fsBridge.readFileBase64(workspaceRootPath, filePath, allowGlobal);
                    setFilePreviewPdfDataUrl(`data:application/pdf;base64,${b64}`);
                    setFilePreviewText('');
                }
            } finally {
                setFilePreviewLoading(false);
            }
        };

        return commonLayout(
            <div className="w-72 bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase">{ext || 'FILE'}</div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800 truncate">{fileName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{prettySize}</div>
                    </div>
                </div>
                <div className="mt-2 flex gap-2">
                    {canInlinePreview && <button onClick={(e) => { e.stopPropagation(); handlePreview(); }} disabled={filePreviewLoading || !workspaceRootPath || !filePath} className={`px-3 py-2 rounded-lg text-xs font-bold ${filePreviewLoading ? 'bg-slate-100 text-slate-400' : 'bg-blue-50 text-blue-600'}`}>{filePreviewLoading ? '载入中...' : '预览'}</button>}
                    <button onClick={(e) => { e.stopPropagation(); handleDownload(false); }} disabled={fileDownloading || !workspaceRootPath || !filePath} className={`flex-1 py-2 rounded-lg text-xs font-bold ${fileDownloading ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-700'}`}>{fileDownloading ? '处理中...' : '下载'}</button>
                    {(mimeType.startsWith('audio/') || category === 'audio') && (
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(true); }} disabled={fileDownloading || !workspaceRootPath || !filePath} className="px-3 py-2 rounded-lg text-xs font-bold bg-cyan-50 text-cyan-600">播放</button>
                    )}
                </div>
                {!!fileAudioSrc && <audio src={fileAudioSrc} controls className="mt-2 w-full h-8" />}
                {!canInlinePreview && !!previewText && <div className="mt-2 text-[11px] text-slate-500 line-clamp-2">{previewText}</div>}
                {filePreviewOpen && (
                    <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                        {filePreviewLoading && <div className="p-3 text-xs text-slate-500">预览加载中...</div>}
                        {!filePreviewLoading && !!filePreviewPdfDataUrl && <iframe src={filePreviewPdfDataUrl} className="w-full h-72 bg-white" />}
                        {!filePreviewLoading && !filePreviewPdfDataUrl && <pre className="max-h-72 overflow-auto p-3 text-xs text-slate-700 whitespace-pre-wrap break-words bg-slate-50">{filePreviewText || '暂无可预览内容'}</pre>}
                    </div>
                )}
            </div>
        );
    }

    if (m.type === 'xhs_card' && m.metadata?.xhsNote) {
        const note = m.metadata.xhsNote;
        return commonLayout(
            <div className="w-64 bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer active:opacity-90 transition-opacity">
                {note.coverUrl ? (
                    <div className="relative w-full h-36 bg-slate-100 overflow-hidden">
                        <img
                            src={note.coverUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            onError={(e: any) => {
                                const img = e.target;
                                const container = img.parentElement;
                                if (!container) return;
                                img.style.display = 'none';
                                if (container.querySelector('.xhs-cover-fallback')) return;
                                const fallback = document.createElement('div');
                                fallback.className = 'xhs-cover-fallback w-full h-full bg-gradient-to-br from-red-50 to-pink-100 flex items-center justify-center';
                                fallback.innerHTML = `<div class="text-center"><div class="text-2xl mb-1">📕</div><div class="text-[10px] text-red-300 font-medium">${note.title ? '封面加载失败' : '小红书笔记'}</div></div>`;
                                container.appendChild(fallback);
                            }}
                        />
                        {note.type === 'video' && (
                            <div className="absolute top-2 right-2 bg-black/50 rounded-full px-1.5 py-0.5 flex items-center gap-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
                                <span className="text-[9px] text-white font-medium">视频</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-14 bg-gradient-to-r from-red-400 to-pink-500 flex items-center justify-center">
                        <span className="text-white/80 text-xs font-medium tracking-wide">小红书笔记</span>
                    </div>
                )}
                <div className="p-3">
                    <div className="font-bold text-sm text-slate-800 line-clamp-2 leading-snug mb-1.5">{note.title || '无标题笔记'}</div>
                    {note.desc && <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed mb-2">{note.desc}</p>}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-red-400 to-pink-400 flex items-center justify-center text-[8px] text-white font-bold">{(note.author || '?')[0]}</div>
                            <span className="text-[10px] text-slate-500 truncate max-w-[100px]">{note.author || '小红书用户'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-red-300"><path d="m9.653 16.915-.005-.003-.019-.01a20.759 20.759 0 0 1-1.162-.682 22.045 22.045 0 0 1-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 0 1 8-2.828A4.5 4.5 0 0 1 18 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 0 1-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 0 1-.692 0l-.003-.002Z" /></svg>
                            <span>{note.likes || 0}</span>
                        </div>
                    </div>
                    <div className="mt-2 pt-1.5 flex items-center gap-1 text-[9px] text-slate-300">
                        <span className="text-red-400 font-bold">小红书</span> <span>·</span> <span>{note.type === 'video' ? '视频' : '笔记'}{isUser ? '分享' : '推荐'}</span>
                    </div>
                </div>
            </div>
        );
    }

    if (m.type === 'voice') {
        return commonLayout(
            <VoiceMessageRenderer
                m={m}
                isUser={isUser}
                styleConfig={styleConfig}
                workspaceRootPath={workspaceRootPath}
                allowGlobal={allowGlobal}
                onUpdateMessage={onUpdateMessage}
                onDirectDelete={onDirectDelete}
            />
        );
    }

    const radius = `${styleConfig.borderRadius}px`;
    const borderObj: React.CSSProperties = { borderTopLeftRadius: radius, borderTopRightRadius: radius, borderBottomLeftRadius: radius, borderBottomRightRadius: radius };
    if (!isFirstInGroup && !isLastInGroup) {
        if (isUser) {
            borderObj.borderTopRightRadius = '4px';
            borderObj.borderBottomRightRadius = '4px';
        } else {
            borderObj.borderTopLeftRadius = '4px';
            borderObj.borderBottomLeftRadius = '4px';
        }
    } else if (isFirstInGroup && !isLastInGroup) {
        if (isUser) borderObj.borderBottomRightRadius = '4px';
        else borderObj.borderBottomLeftRadius = '4px';
    } else if (!isFirstInGroup && isLastInGroup) {
        if (isUser) borderObj.borderTopRightRadius = '4px';
        else borderObj.borderTopLeftRadius = '4px';
    } else {
        if (isUser) borderObj.borderBottomRightRadius = '2px';
        else borderObj.borderBottomLeftRadius = '2px';
    }
    const containerStyle: React.CSSProperties = { backgroundColor: styleConfig.backgroundColor, opacity: styleConfig.opacity, ...borderObj };

    const renderContent = (text: string) => {
        const renderTextWithLinks = (segment: string, keyPrefix: string) => {
            const urls = segment.match(URL_REGEX) || [];
            if (urls.length === 0) return [segment];
            const parts = segment.split(URL_REGEX);
            const nodes: React.ReactNode[] = [];
            parts.forEach((part, i) => {
                if (part) nodes.push(<span key={`${keyPrefix}-t-${i}`}>{part}</span>);
                const url = urls[i];
                if (url) {
                    nodes.push(
                        <a
                            key={`${keyPrefix}-u-${i}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 text-blue-500 hover:text-blue-600"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            {url}
                        </a>
                    );
                }
            });
            return nodes;
        };

        const parts = text.split(/(```[\s\S]*?```)/g);
        return parts.map((part, index) => {
            if (part.startsWith('```') && part.endsWith('```')) {
                const codeContent = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
                return <pre key={index} className="bg-black/80 text-gray-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre shadow-inner border border-white/10">{codeContent}</pre>;
            }
            return part.split('\n').map((line, lineIdx) => {
                const key = `${index}-${lineIdx}`;
                if (line.trim().startsWith('>')) {
                    const quoteText = line.trim().substring(1).trim();
                    if (!quoteText) return null;
                    return <div key={key} className="my-1 pl-2.5 border-l-[3px] border-current opacity-70 italic text-[13px]">{quoteText}</div>;
                }
                const boldSegments = line.split(/(\*\*.*?\*\*)/g);
                const renderedLine = boldSegments.flatMap((seg, i) => {
                    if (seg.startsWith('**') && seg.endsWith('**')) {
                        return <strong key={`${key}-b-${i}`} className="font-bold">{seg.slice(2, -2)}</strong>;
                    }
                    return renderTextWithLinks(seg, `${key}-l-${i}`);
                });
                return <div key={key} className="min-h-[1.2em]">{renderedLine}</div>;
            });
        });
    };

    const stripJunk = (s: string) => s
        .replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '')  // strip <语音>...</语音> voice tags
        .replace(/<device>[\s\S]*?<\/device>/g, '')      // strip <device>...</device> Intiface tags
        .replace(/%%TRANS%%[\s\S]*/gi, '')
        .replace(/%%BILINGUAL%%/gi, '\n')
        .replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '')
        .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*/g, '')
        .replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, '')
        .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
        .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const rawContent = m.content || '';
    const bilingualIdx = rawContent.toLowerCase().indexOf('%%bilingual%%');
    const hasBilingual = bilingualIdx !== -1;
    const langAContent = hasBilingual ? stripJunk(rawContent.substring(0, bilingualIdx)) : stripJunk(rawContent);
    const langBContent = hasBilingual ? stripJunk(rawContent.substring(bilingualIdx + '%%BILINGUAL%%'.length)) : '';
    let displayContent = (isShowingTarget && langBContent) ? langBContent : langAContent;

    // ✅ Handle call interruption: truncate text if interrupted mid-speech
    const isInterrupted = m.metadata?.interrupted === true;
    const spokenCharCount = m.metadata?.spokenCharCount;
    if (isInterrupted && typeof spokenCharCount === 'number' && displayContent.length > spokenCharCount) {
        displayContent = displayContent.slice(0, spokenCharCount) + '...';
    }

    const hasVoiceTag = /<[语語]音>[\s\S]*?<\/[语語]音>/.test(rawContent);
    // Auto fallback textual UI indication for unrendered voice tags
    if (hasVoiceTag && !displayContent) {
        displayContent = '[🎤 语音内容]';
    }
    const showTranslateButton = !isUser && translationEnabled && hasBilingual && !!langBContent;
    const linkUrls = useMemo(() => extractUrls(displayContent), [displayContent]);
    const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreviewData | null>>({});
    useEffect(() => {
        let mounted = true;
        const run = async () => {
            const next: Record<string, LinkPreviewData | null> = {};
            for (const url of linkUrls) {
                if (linkPreviewCache.has(url)) {
                    next[url] = linkPreviewCache.get(url) ?? null;
                    continue;
                }
                const preview = await fetchLinkPreview(url);
                linkPreviewCache.set(url, preview);
                next[url] = preview;
            }
            if (mounted) setLinkPreviews(next);
        };
        if (linkUrls.length > 0) run();
        else setLinkPreviews({});
        return () => { mounted = false; };
    }, [linkUrls.join('|')]);
    if (!displayContent) return null;

    return commonLayout(
        <div className={`relative shadow-sm px-5 py-3 animate-fade-in border border-black/5 active:scale-[0.98] transition-transform overflow-hidden ${isUser ? 'sully-bubble-user' : 'sully-bubble-ai'}`} style={containerStyle}>
            {styleConfig.backgroundImage && (
                <div className="absolute inset-0 bg-cover bg-center pointer-events-none z-0" style={{ backgroundImage: `url(${styleConfig.backgroundImage})`, opacity: styleConfig.backgroundImageOpacity ?? 0.5 }} />
            )}
            {styleConfig.decoration && (
                <img
                    src={styleConfig.decoration}
                    className="absolute z-10 w-8 h-8 object-contain drop-shadow-sm pointer-events-none"
                    style={{
                        left: `${styleConfig.decorationX ?? (isUser ? 90 : 10)}%`,
                        top: `${styleConfig.decorationY ?? -10}%`,
                        transform: `translate(-50%, -50%) scale(${styleConfig.decorationScale ?? 1}) rotate(${styleConfig.decorationRotate ?? 0}deg)`
                    }}
                    alt=""
                />
            )}
            {m.replyTo && (
                <div
                    className={`relative z-10 mb-2.5 pl-3 py-1.5 pr-2 border-l-[3.5px] rounded-r-lg flex flex-col gap-1 max-w-full overflow-hidden transition-colors ${isUser
                        ? 'border-white/40 bg-white/10 text-white/90'
                        : 'border-blue-500/50 bg-black/5 text-slate-600'
                        }`}
                >
                    <div className="flex items-center gap-1.5 opacity-80">
                        <span className="font-bold text-[11px] tracking-wide uppercase">{m.replyTo.name}</span>
                    </div>
                    <span className="truncate text-[12.5px] leading-snug opacity-95 antialiased font-medium">
                        {m.replyTo.messageType === 'file' ? `[文件] ${m.replyTo.fileName || m.replyTo.content}` : `${m.replyTo.content}`}
                    </span>
                </div>
            )}
            <div className="relative z-10 text-[15px] leading-relaxed whitespace-pre-wrap break-all select-text" style={{ color: styleConfig.textColor }}>
                {renderContent(displayContent)}
            </div>
            {linkUrls.length > 0 && (
                <div className="relative z-10 mt-2 space-y-2">
                    {linkUrls.map((url) => {
                        const p = linkPreviews[url];
                        if (!p) return null;
                        return (
                            <button
                                key={url}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer'); }}
                                className="w-full text-left bg-white/80 rounded-2xl border border-black/10 overflow-hidden active:scale-[0.99] transition-transform shadow-sm hover:shadow-md"
                            >
                                {p.image ? (
                                    <img src={p.image} alt="" className="w-full h-36 object-cover border-b border-black/5" loading="lazy" decoding="async" />
                                ) : (
                                    <div className="w-full h-28 border-b border-black/5 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                                        <img src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}`} alt="" className="w-8 h-8 rounded-md" loading="lazy" decoding="async" />
                                    </div>
                                )}
                                <div className="p-3">
                                    <div className="text-[10px] text-slate-500 mb-1.5">{p.siteName || hostOf(url)}</div>
                                    <div className="text-[14px] font-semibold text-slate-800 break-words leading-snug">{p.title}</div>
                                    {p.description && <div className="text-[12px] text-slate-600 mt-1.5 break-words leading-relaxed">{p.description.slice(0, 180)}</div>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
            {showTranslateButton && (
                <div className="relative z-10 mt-2 flex justify-end">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onTranslateToggle?.(m.id);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all active:scale-95 select-none"
                        style={{ color: styleConfig.textColor, opacity: 0.45, backgroundColor: isShowingTarget ? 'rgba(0,0,0,0.06)' : 'transparent' }}
                    >
                        {isShowingTarget ? (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" /></svg>
                                <span>原文</span>
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M7.75 2.75a.75.75 0 0 0-1.5 0v1.258a32.987 32.987 0 0 0-3.599.278.75.75 0 1 0 .198 1.487A31.545 31.545 0 0 1 8.7 5.545 19.381 19.381 0 0 1 7.257 9.04a19.391 19.391 0 0 1-1.727-2.29.75.75 0 1 0-1.29.77 20.9 20.9 0 0 0 2.023 2.684 19.549 19.549 0 0 1-3.158 2.57.75.75 0 1 0 .86 1.229A21.056 21.056 0 0 0 7.5 11.03c1.1.95 2.3 1.79 3.593 2.49a.75.75 0 1 0 .69-1.331A19.545 19.545 0 0 1 8.46 9.89a20.893 20.893 0 0 0 1.91-4.644h2.38a.75.75 0 0 0 0-1.5h-3v-1a.75.75 0 0 0-.75-.75Z" /><path d="M12.75 10a.75.75 0 0 1 .692.462l2.5 6a.75.75 0 1 1-1.384.576l-.532-1.278h-3.052l-.532 1.278a.75.75 0 1 1-1.384-.576l2.5-6A.75.75 0 0 1 12.75 10Zm-1.018 4.26h2.036L12.75 11.6l-1.018 2.66Z" /></svg>
                                <span>译</span>
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}, (prev, next) => (
    prev.msg.id === next.msg.id &&
    prev.msg.content === next.msg.content &&
    prev.msg.metadata === next.msg.metadata &&
    prev.isFirstInGroup === next.isFirstInGroup &&
    prev.isLastInGroup === next.isLastInGroup &&
    prev.activeTheme === next.activeTheme &&
    prev.translationEnabled === next.translationEnabled &&
    prev.isShowingTarget === next.isShowingTarget &&
    prev.selectionMode === next.selectionMode &&
    prev.isSelected === next.isSelected &&
    prev.workspaceRootPath === next.workspaceRootPath &&
    prev.allowGlobal === next.allowGlobal
));

export default MessageItem;
