


import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB, ScheduledMessage } from '../utils/db';
import { Message, MessageType, ChatTheme, BubbleStyle, MemoryFragment, AppID, CharacterProfile, UserProfile } from '../types';
import Modal from '../components/os/Modal';
import { processImage } from '../utils/file';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ContextBuilder } from '../utils/context';
import { useChatAI } from '../hooks/useChatAI';
import { fsBridge } from '../utils/fsBridge';
import { buildRenamedFileName, buildTempRelativePath, classifyChatFile, extractTextPreview, fileToBase64, isForbiddenMediaFile } from '../utils/chatFiles';
import ChatModals from '../components/chat/ChatModals';
import ChatMessageItem from '../components/chat/MessageItem';
import { EventBus } from '../utils/eventBus';
import VoiceRecorder, { VoiceAction } from '../components/chat/VoiceRecorder';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import VoiceToast, { useVoiceToast } from '../components/chat/VoiceToast';
import { synthesizeSpeech } from '../utils/ttsService';
import { getSTTService } from '../utils/sttService';
import { StickerParser, StickerSet, StickerItem } from '../utils/stickerParser';
import StickerPicker from '../components/chat/StickerPicker';
import { voiceStopIntent, voiceStartIntent } from '../utils/voiceIntent';
import { resolveApiEndpoint } from '../utils/apiResolver';

// Built-in presets map to the new data structure for consistency
const PRESET_THEMES: Record<string, ChatTheme> = {
    default: {
        id: 'default', name: 'Indigo', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#6366f1', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    dream: {
        id: 'dream', name: 'Dream', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#f472b6', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    forest: {
        id: 'forest', name: 'Forest', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#10b981', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
};

type PickerMedia = {
    name: string;
    path: string;
    album: string;
    updatedAt: number;
    mediaType: 'image' | 'video';
};

const CHAT_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const CHAT_VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];

const chatExtOf = (name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
};

const chatIsImageName = (name: string) => CHAT_IMAGE_EXTS.includes(chatExtOf(name));
const chatIsVideoName = (name: string) => CHAT_VIDEO_EXTS.includes(chatExtOf(name));
const chatIsMediaName = (name: string) => chatIsImageName(name) || chatIsVideoName(name);
const chatToRelPath = (absolutePath: string) => absolutePath.replace(/^\/+/, '');
const chatSanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
type VideoProviderMode = 'auto' | 'kimi' | 'volcengine' | 'gemini';

const detectVideoProviderMode = (baseUrl: string, model: string): Exclude<VideoProviderMode, 'auto'> => {
    const modelLc = (model || '').toLowerCase();
    const baseLc = (baseUrl || '').toLowerCase();
    if (modelLc.includes('kimi') || modelLc.includes('moonshot') || baseLc.includes('moonshot')) return 'kimi';
    if (modelLc.includes('doubao') || modelLc.includes('seed') || baseLc.includes('volces') || baseLc.includes('volcengine') || baseLc.includes('ark')) return 'volcengine';
    if (modelLc.includes('gemini') || baseLc.includes('generativelanguage') || baseLc.includes('googleapis') || baseLc.includes('google')) return 'gemini';
    return 'kimi';
};

const chatResolveApiBaseUrl = (baseUrl: string) => {
    const clean = (baseUrl || '').replace(/\/+$/, '');
    if (window.location.hostname === 'localhost' && clean.includes('ark.cn-beijing.volces.com')) {
        const relativePath = clean.replace('https://ark.cn-beijing.volces.com', '');
        return `/api/proxy/volcengine${relativePath}`;
    }
    return clean;
};

const chatDataUrlToFile = (dataUrl: string, fileName: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    try {
        const bin = atob(base64);
        const len = bin.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], fileName, { type: mime || 'video/mp4' });
    } catch {
        return null;
    }
};

const chatExtractResponseText = (data: any) => {
    const direct = String(data?.output_text || '').trim();
    if (direct) return direct;
    const out = Array.isArray(data?.output) ? data.output : [];
    for (const item of out) {
        const content = Array.isArray(item?.content) ? item.content : [];
        for (const c of content) {
            const txt = String(c?.text || c?.output_text || '').trim();
            if (txt) return txt;
        }
    }
    return '';
};

const chatMimeFromName = (name: string) => {
    const ext = chatExtOf(name);
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    if (ext === '.mp4') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.mkv') return 'video/x-matroska';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.avi') return 'video/x-msvideo';
    if (ext === '.m4v') return 'video/mp4';
    return 'image/jpeg';
};

const chatFileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('读取失败'));
    r.readAsDataURL(file);
});

const captureVideoFrames = async (videoDataUrl: string, frameCount: number = 3): Promise<string[]> => {
    return await new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = videoDataUrl;
        let done = false;
        const finish = (vals: string[]) => {
            if (done) return;
            done = true;
            resolve(vals.filter(Boolean));
        };
        const drawFrame = () => {
            try {
                const w = Math.max(1, video.videoWidth || 1);
                const h = Math.max(1, video.videoHeight || 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(960, w);
                canvas.height = Math.max(1, Math.round((canvas.width / w) * h));
                const ctx = canvas.getContext('2d');
                if (!ctx) return '';
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.75);
            } catch {
                return '';
            }
        };
        const once = (event: string, timeoutMs: number = 3000) => new Promise<void>((r) => {
            let timeout: any = null;
            const handler = () => {
                if (timeout) clearTimeout(timeout);
                video.removeEventListener(event, handler as any);
                r();
            };
            video.addEventListener(event, handler as any, { once: true });
            timeout = setTimeout(handler, timeoutMs);
        });
        const run = async () => {
            await once('loadeddata', 4000);
            const duration = Number(video.duration || 0);
            let times: number[] = [];
            if (duration <= 1) {
                times = [duration * 0.5];
            } else {
                const count = Math.max(1, frameCount);
                if (count === 1) times = [duration * 0.5];
                else {
                    for (let i = 0; i < count; i++) {
                        times.push((duration * i) / (count - 1));
                    }
                }
            }
            const uniqueTimes = Array.from(new Set(times.map(t => Number(t.toFixed(2))))).slice(0, Math.max(1, frameCount));
            const frames: string[] = [];
            for (const t of uniqueTimes) {
                try {
                    if (duration > 0) {
                        video.currentTime = Math.min(Math.max(0, t), Math.max(0, duration - 0.01));
                        await once('seeked', 2500);
                    }
                    const frame = drawFrame();
                    if (frame) frames.push(frame);
                } catch { }
            }
            finish(frames);
        };
        run().catch(() => finish([]));
        video.addEventListener('error', () => finish([]), { once: true });
        setTimeout(() => finish([]), 9000);
    });
};

const Chat: React.FC = () => {
    const { characters, activeCharacterId, setActiveCharacterId, updateCharacter, apiConfig, closeApp, openApp, customThemes, removeCustomTheme, addToast, userProfile, updateUserProfile, lastMsgTimestamp, activeApp, realtimeConfig } = useOS();
    const [messages, setMessages] = useState<Message[]>([]);
    const [visibleCount, setVisibleCount] = useState(30);
    const [input, setInput] = useState('');
    const [showPanel, setShowPanel] = useState<'none' | 'actions' | 'emojis' | 'chars'>('none');
    const [emojis, setEmojis] = useState<{ name: string, url: string }[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const chatImageInputRef = useRef<HTMLInputElement>(null);
    const chatFileInputRef = useRef<HTMLInputElement>(null);
    const pickerUploadInputRef = useRef<HTMLInputElement>(null);

    const [modalType, setModalType] = useState<'none' | 'transfer' | 'emoji-import' | 'chat-settings' | 'message-options' | 'edit-message' | 'delete-emoji' | 'history-manager'>('none');
    const [transferAmt, setTransferAmt] = useState('');
    const [emojiImportText, setEmojiImportText] = useState('');
    const [settingsContextLimit, setSettingsContextLimit] = useState(500);
    const [settingsHideSysLogs, setSettingsHideSysLogs] = useState(false);
    const [settingsReplySplitInterval, setSettingsReplySplitInterval] = useState(0);
    const [preserveContext, setPreserveContext] = useState(true);
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<{ name: string, url: string } | null>(null);
    const [editContent, setEditContent] = useState('');
    const [replyTarget, setReplyTarget] = useState<Message | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    const [allHistoryMessages, setAllHistoryMessages] = useState<Message[]>([]);
    const [pickerKey, setPickerKey] = useState(0);
    const [translationEnabled, setTranslationEnabled] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [translateSourceLang, setTranslateSourceLang] = useState(() => localStorage.getItem('chat_translate_source_lang') || '日本語');
    const [translateTargetLang, setTranslateTargetLang] = useState(() => localStorage.getItem('chat_translate_lang') || '中文');
    const [showingTargetIds, setShowingTargetIds] = useState<Set<number>>(new Set());
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [showGalleryPicker, setShowGalleryPicker] = useState(false);
    const [pickerPhotos, setPickerPhotos] = useState<PickerMedia[]>([]);
    const [pickerSelected, setPickerSelected] = useState<Record<string, boolean>>({});
    const [pickerPreviewMap, setPickerPreviewMap] = useState<Record<string, string>>({});
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerVisibleCount, setPickerVisibleCount] = useState(45);
    const mediaDetailCacheRef = useRef<Map<string, { detail: string; ts: number; videoFrames?: string[] }>>(new Map());

    // ── Voice Mode State & TTS ──
    const [voiceMode, setVoiceMode] = useState(false);
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const [sessionVoiceActive, setSessionVoiceActive] = useState(false);
    const [consecutiveTextCount, setConsecutiveTextCount] = useState(0);
    const [voiceEnergy, setVoiceEnergy] = useState(100);
    const [voiceLock, setVoiceLock] = useState(false);
    const voiceRecorder = useVoiceRecorder();
    const voiceResultRef = useRef<Promise<{ url: string; blob: Blob; duration: number; } | null> | null>(null);
    const sttTranscriptRef = useRef<string>('');
    const { toastMsg: voiceToastMsg, toastVisible: voiceToastVisible, showToast: showVoiceToast, dismissToast: dismissVoiceToast } = useVoiceToast();

    // ── Phase 2.5: Message Coalescing ──
    const [chatWaitTime, setChatWaitTime] = useState(3000); // ms
    const triggerDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // double-layer TTS generation tracker
    const prevIsTypingRef = useRef(false);

    const char = characters.find(c => c.id === activeCharacterId) || characters[0];
    const charDisplayName = char?.nickname || char?.name || 'Agent';
    const charDisplayAvatar = char?.displayAvatar || char?.avatar || '';
    const userDisplayName = userProfile.nickname || userProfile.name;
    const userDisplayAvatar = userProfile.displayAvatar || userProfile.avatar;
    const galleryRootPath = apiConfig.galleryWorkspacePath?.trim() || '';
    const workspaceRootPath = apiConfig.nativeWorkspacePath?.trim() || '';
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const currentThemeId = char?.bubbleStyle || 'default';
    const activeTheme = useMemo(() => customThemes.find(t => t.id === currentThemeId) || PRESET_THEMES[currentThemeId] || PRESET_THEMES.default, [currentThemeId, customThemes]);
    const draftKey = `chat_draft_${activeCharacterId}`;
    const updateAgentDisplay = useCallback(async (updates: Partial<CharacterProfile>) => {
        if (!char) return;
        await updateCharacter(char.id, updates as any);
    }, [char, updateCharacter]);
    const updateUserProfileDisplay = useCallback(async (updates: Partial<UserProfile>) => {
        await updateUserProfile(updates);
    }, [updateUserProfile]);
    const { isTyping, recallStatus, lastTokenUsage, setLastTokenUsage, triggerAI } = useChatAI({
        char,
        userProfile,
        apiConfig,
        emojis: emojis as any,
        activeApp,
        perceptionConfig: realtimeConfig.perceptionConfig,
        addToast,
        setMessages,
        updateAgent: updateAgentDisplay as any,
        updateUserProfile: updateUserProfileDisplay as any,
        translationConfig: translationEnabled
            ? { enabled: true, sourceLang: translateSourceLang, targetLang: translateTargetLang }
            : undefined,
        xhsEnabled: !!realtimeConfig?.xhsEnabled,
        xhsMcpConfig: realtimeConfig?.xhsMcpConfig,
        sessionVoiceActive,
        setVoiceEnergy,
    });

    // Auto-TTS removed (moved to ChatParser for unified handling)

    // Reroll Logic Helpers
    const canReroll = !isTyping && messages.length > 0 && messages[messages.length - 1].role === 'assistant';

    useEffect(() => {
        if (activeCharacterId) {
            DB.getMessagesByCharId(activeCharacterId).then(setMessages);
            DB.getEmojis().then(setEmojis);
            const savedDraft = localStorage.getItem(draftKey);
            setInput(savedDraft || '');
            if (char) {
                setSettingsContextLimit(char.contextLimit || 500);
                setSettingsHideSysLogs(!!char.hideSystemLogs);
                setSettingsReplySplitInterval(char.replySplitInterval || 0);
            }
            try { setTranslationEnabled(JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false')); } catch { setTranslationEnabled(false); }
            setShowingTargetIds(new Set());
            setReplyTarget(null);
            setSelectionMode(false);
            setSelectedMsgIds(new Set());
            setVisibleCount(30);
            setLastTokenUsage(null);

            // Phase 3.3: Load stickers - now handled internally by StickerPicker
        }
    }, [activeCharacterId, workspaceRootPath]);

    useEffect(() => {
        if (modalType === 'history-manager' && activeCharacterId) {
            DB.getMessagesByCharId(activeCharacterId).then(allMsgs => {
                const filtered = allMsgs.filter(m => m.metadata?.source !== 'date').filter(m => !(char?.hideSystemLogs && m.role === 'system'));
                setAllHistoryMessages(filtered);
            });
        }
    }, [modalType, activeCharacterId, char?.hideSystemLogs]);

    // New: Listen for global scheduled message signals
    useEffect(() => {
        if (activeCharacterId && lastMsgTimestamp > 0) {
            DB.getMessagesByCharId(activeCharacterId).then(setMessages);
        }
    }, [lastMsgTimestamp]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
        if (val.trim()) localStorage.setItem(draftKey, val);
        else localStorage.removeItem(draftKey);
    };

    useLayoutEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length, activeCharacterId]);

    useEffect(() => {
        if (isTyping && scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [messages, isTyping, recallStatus]);

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const collectGalleryPhotos = useCallback(async (): Promise<PickerMedia[]> => {
        if (!galleryRootPath) return [];
        const rootItems = await fsBridge.readDir(galleryRootPath, '/', allowGlobal);
        const rootFiles = rootItems
            .filter(i => i.type === 'file' && chatIsMediaName(i.name))
            .map(i => ({
                name: i.name,
                path: `/${i.name}`,
                album: '最近项目',
                updatedAt: i.updatedAt || Date.now(),
                mediaType: chatIsVideoName(i.name) ? 'video' as const : 'image' as const
            }));
        const folders = rootItems.filter(i => i.type === 'folder');
        const nested = await Promise.all(folders.map(async f => {
            const dirPath = `/${f.name}/`;
            const items = await fsBridge.readDir(galleryRootPath, dirPath, allowGlobal);
            return items
                .filter(i => i.type === 'file' && chatIsMediaName(i.name))
                .map(i => ({
                    name: i.name,
                    path: `${dirPath}${i.name}`,
                    album: f.name,
                    updatedAt: i.updatedAt || Date.now(),
                    mediaType: chatIsVideoName(i.name) ? 'video' as const : 'image' as const
                }));
        }));
        return [...rootFiles, ...nested.flat()].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allowGlobal, galleryRootPath]);

    const inferImageDetail = useCallback(async (imageDataUrl: string, mediaLabel: '图片' | '视频' = '图片'): Promise<string> => {
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl || !apiConfig?.model) return '';
        try {
            const resolved = resolveApiEndpoint(apiConfig);
            const response = await fetch(resolved.chatUrl, {
                method: 'POST',
                headers: resolved.headers,
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: `请用中文生成不超过30字的${mediaLabel}详情，仅输出描述文本。` },
                            { type: 'image_url', image_url: { url: imageDataUrl } }
                        ]
                    }],
                    temperature: 0.2,
                    max_tokens: 80
                })
            });
            if (!response.ok) return '';
            const data = await response.json();
            const text = String(data?.choices?.[0]?.message?.content || '').trim().replace(/[\r\n]+/g, ' ');
            return text.slice(0, 30);
        } catch {
            return '';
        }
    }, [apiConfig?.apiKey, apiConfig?.baseUrl, apiConfig?.model]);

    const inferVideoDetail = useCallback(async (videoDataUrl: string, videoFrames: string[]): Promise<string> => {
        const prompt = '请用中文生成不超过30字的视频详情，仅输出描述文本。';
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl || !apiConfig?.model) return '';
        const rawBaseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
        const baseUrl = chatResolveApiBaseUrl(apiConfig.baseUrl);
        const providerMode = apiConfig.videoUnderstanding?.providerMode || 'auto';
        const resolvedMode = providerMode === 'auto' ? detectVideoProviderMode(rawBaseUrl, apiConfig.model) : providerMode;
        const nativeFirst = apiConfig.videoUnderstanding?.nativeFirst ?? true;

        const call = async (content: any[]): Promise<string> => {
            try {
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.apiKey}`
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'user', content }],
                        temperature: 0.2,
                        max_tokens: 120
                    })
                });
                if (!response.ok) return '';
                const data = await response.json();
                const text = String(data?.choices?.[0]?.message?.content || '').trim().replace(/[\r\n]+/g, ' ');
                return text.slice(0, 30);
            } catch {
                return '';
            }
        };

        const callVolcengineResponsesWithFile = async (): Promise<string> => {
            try {
                const file = chatDataUrlToFile(videoDataUrl, `chat_video_${Date.now()}.mp4`);
                if (!file) return '';
                const form = new FormData();
                form.append('purpose', 'user_data');
                form.append('file', file);
                const uploadResp = await fetch(`${baseUrl}/files`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: form
                });
                if (!uploadResp.ok) return '';
                const uploadData = await uploadResp.json();
                const fileId = String(uploadData?.id || '').trim();
                if (!fileId) return '';
                const response = await fetch(`${baseUrl}/responses`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.apiKey}`
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        input: [{
                            role: 'user',
                            content: [
                                { type: 'input_video', file_id: fileId },
                                { type: 'input_text', text: prompt }
                            ]
                        }]
                    })
                });
                if (!response.ok) return '';
                const data = await response.json();
                const text = chatExtractResponseText(data).replace(/[\r\n]+/g, ' ');
                return text.slice(0, 30);
            } catch {
                return '';
            }
        };

        const tryPayloadsByMode: Record<Exclude<VideoProviderMode, 'auto'>, any[][]> = {
            kimi: [
                [{ type: 'text', text: prompt }, { type: 'video_url', video_url: { url: videoDataUrl } }],
                [{ type: 'video_url', video_url: { url: videoDataUrl } }, { type: 'text', text: prompt }]
            ],
            volcengine: [
                [{ type: 'text', text: prompt }, { type: 'video_url', video_url: { url: videoDataUrl } }],
                [{ type: 'input_text', text: prompt }, { type: 'input_video', video_url: { url: videoDataUrl } }],
                [{ type: 'video_url', video_url: { url: videoDataUrl } }, { type: 'text', text: prompt }]
            ],
            gemini: [
                [{ type: 'video_url', video_url: { url: videoDataUrl } }, { type: 'text', text: prompt }],
                [{ type: 'text', text: prompt }, { type: 'video_url', video_url: { url: videoDataUrl } }]
            ]
        };

        if (nativeFirst) {
            if (resolvedMode === 'volcengine') {
                const volcText = await callVolcengineResponsesWithFile();
                if (volcText && volcText.length > 5) return volcText;
            }
            const payloads = tryPayloadsByMode[resolvedMode] || tryPayloadsByMode.kimi;
            for (const payload of payloads) {
                const nativeText = await call(payload as any[]);
                if (nativeText && nativeText.length > 5) return nativeText;
            }
        }

        const maxFrames = apiConfig.videoUnderstanding?.maxFrames || 12;
        const framePayload = [{ type: 'text', text: `${prompt} 下面是该视频的多帧画面。` }, ...videoFrames.slice(0, maxFrames).map(f => ({ type: 'image_url', image_url: { url: f } }))];
        const fallbackText = await call(framePayload);
        return fallbackText;
    }, [apiConfig?.apiKey, apiConfig?.baseUrl, apiConfig?.model, apiConfig.videoUnderstanding?.maxFrames, apiConfig.videoUnderstanding?.nativeFirst, apiConfig.videoUnderstanding?.providerMode]);

    const persistChatUploadIfNeeded = useCallback(async (file: File, dataUrl: string, mediaType: 'image' | 'video') => {
        const CACHE_TTL = 10 * 60 * 1000;
        const safeName = chatSanitizeName(file.name || `chat_${Date.now()}.jpg`);
        if (!galleryRootPath) return { saved: false, fileName: safeName, galleryPath: '' as string, imageDetail: '', videoFrame: '', videoFrames: [] as string[] };
        const allPhotos = await collectGalleryPhotos();
        const duplicate = allPhotos.find(p => p.name.trim().toLowerCase() === safeName.trim().toLowerCase());
        if (duplicate) {
            let detail = (await DB.getImageDetailByFileName(safeName).catch(() => null))?.detail || '';
            let videoFrames: string[] = [];
            if (!detail) {
                const cacheKey = `${mediaType}|${duplicate.path.toLowerCase()}`;
                const cached = mediaDetailCacheRef.current.get(cacheKey);
                const now = Date.now();
                if (cached && now - cached.ts < CACHE_TTL) {
                    detail = cached.detail;
                    videoFrames = cached.videoFrames || [];
                } else {
                    if (mediaType === 'video') {
                        const maxFrames = apiConfig.videoUnderstanding?.maxFrames || 10;
                        videoFrames = await captureVideoFrames(dataUrl, maxFrames);
                        detail = await inferVideoDetail(dataUrl, videoFrames);
                    } else {
                        detail = await inferImageDetail(dataUrl, '图片');
                    }
                    mediaDetailCacheRef.current.set(cacheKey, { detail: detail || '', ts: now, videoFrames });
                }
                if (detail) {
                    await DB.saveImageDetail({
                        fileName: safeName,
                        detail,
                        source: 'agent',
                        relatedPath: duplicate.path
                    });
                }
            }
            if (mediaType === 'video' && videoFrames.length === 0) {
                const cacheKey = `${mediaType}|${duplicate.path.toLowerCase()}`;
                const cached = mediaDetailCacheRef.current.get(cacheKey);
                const now = Date.now();
                if (cached && now - cached.ts < CACHE_TTL && cached.videoFrames?.length) {
                    videoFrames = cached.videoFrames || [];
                } else {
                    const maxFrames = apiConfig.videoUnderstanding?.maxFrames || 10;
                    videoFrames = await captureVideoFrames(dataUrl, maxFrames);
                    // Do not re-infer detail if we already have it, just cache frames
                    mediaDetailCacheRef.current.set(cacheKey, { detail: detail || '', ts: now, videoFrames });
                }
            }
            return { saved: false, fileName: safeName, galleryPath: duplicate.path, imageDetail: detail || '', videoFrame: videoFrames[0] || '', videoFrames };
        }

        const relPath = `/${safeName}`;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        await fsBridge.writeFileBase64(galleryRootPath, chatToRelPath(relPath), base64, allowGlobal);
        let videoFrames: string[] = [];
        const defaultDetail = mediaType === 'image'
            ? await inferImageDetail(dataUrl, '图片')
            : '';
        let finalDetail = defaultDetail;
        if (mediaType === 'video') {
            const cacheKey = `${mediaType}|${relPath.toLowerCase()}`;
            const cached = mediaDetailCacheRef.current.get(cacheKey);
            const now = Date.now();
            if (cached && now - cached.ts < CACHE_TTL) {
                finalDetail = cached.detail;
                videoFrames = cached.videoFrames || [];
            } else {
                const maxFrames = apiConfig.videoUnderstanding?.maxFrames || 10;
                videoFrames = await captureVideoFrames(dataUrl, maxFrames);
                finalDetail = await inferVideoDetail(dataUrl, videoFrames);
                mediaDetailCacheRef.current.set(cacheKey, { detail: finalDetail || '', ts: now, videoFrames });
            }
        }
        if (finalDetail) {
            await DB.saveImageDetail({
                fileName: safeName,
                detail: finalDetail,
                source: 'agent',
                relatedPath: relPath
            });
        }
        return { saved: true, fileName: safeName, galleryPath: relPath, imageDetail: finalDetail, videoFrame: videoFrames[0] || '', videoFrames };
    }, [allowGlobal, collectGalleryPhotos, galleryRootPath, inferImageDetail, inferVideoDetail]);

    const loadGalleryPicker = useCallback(async () => {
        if (!galleryRootPath) {
            setPickerPhotos([]);
            setPickerSelected({});
            setPickerPreviewMap({});
            setPickerVisibleCount(45);
            return;
        }
        setPickerLoading(true);
        try {
            const photos = await collectGalleryPhotos();
            setPickerPhotos(photos);
            setPickerSelected({});
            setPickerPreviewMap({});
            setPickerVisibleCount(45);
        } catch (e: any) {
            addToast(`读取相册失败: ${e.message || e}`, 'error');
        } finally {
            setPickerLoading(false);
        }
    }, [addToast, collectGalleryPhotos, galleryRootPath]);

    const openGalleryPicker = useCallback(async () => {
        setShowPanel('none');
        setShowGalleryPicker(true);
        await loadGalleryPicker();
    }, [loadGalleryPicker]);

    const handleChatImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        let sent = 0;
        try {
            setShowPanel('none');
            for (const file of files) {
                const isImage = file.type.startsWith('image/');
                const isVideo = file.type.startsWith('video/');
                if (!isImage && !isVideo) continue;
                const dataUrl = isImage
                    ? await processImage(file, { maxWidth: 720, quality: 0.65, forceJpeg: true })
                    : await chatFileToDataUrl(file);
                const persisted = await persistChatUploadIfNeeded(file, dataUrl, isVideo ? 'video' : 'image');
                await handleSendText(dataUrl, isVideo ? 'video' : 'image', {
                    source: isVideo ? 'chat_upload_video' : 'chat_upload',
                    fileName: persisted.fileName,
                    galleryPath: persisted.galleryPath,
                    imageDetail: isImage ? (persisted.imageDetail || '') : '',
                    videoDetail: isVideo ? (persisted.imageDetail || '') : '',
                    videoFrame: isVideo ? (persisted.videoFrame || '') : '',
                    videoFrames: isVideo ? (persisted.videoFrames || []) : [],
                    mediaType: isVideo ? 'video' : 'image'
                });
                sent += 1;
            }
            if (sent > 0) {
                addToast(`已发送 ${sent} 个媒体`, 'success');
            }
            if (showGalleryPicker) {
                await loadGalleryPicker();
            }
        } catch (err: any) {
            addToast(err.message || '媒体处理失败', 'error');
        } finally {
            if (chatImageInputRef.current) chatImageInputRef.current.value = '';
            if (pickerUploadInputRef.current) pickerUploadInputRef.current.value = '';
        }
    };

    const handleChatFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (!workspaceRootPath) {
            addToast('请先在系统设置中配置实体工作区路径', 'error');
            if (chatFileInputRef.current) chatFileInputRef.current.value = '';
            return;
        }
        let sent = 0;
        let skipped = 0;
        try {
            setShowPanel('none');
            for (const file of files) {
                if (isForbiddenMediaFile(file.name) || file.type.startsWith('image/') || file.type.startsWith('video/')) {
                    skipped += 1;
                    continue;
                }
                const category = classifyChatFile(file);
                await fsBridge.createFolder(workspaceRootPath, `temp/${category}`, allowGlobal);
                const existing = await fsBridge.readDir(workspaceRootPath, `/temp/${category}/`, allowGlobal).catch(() => []);
                const existingNames = new Set(existing.filter(i => i.type === 'file').map(i => i.name.toLowerCase()));
                let candidateName = file.name;
                let tryIndex = 0;
                while (existingNames.has(buildRenamedFileName(file.name, tryIndex).toLowerCase())) {
                    tryIndex += 1;
                    if (tryIndex > 999) break;
                }
                candidateName = buildRenamedFileName(file.name, tryIndex);
                const relPath = buildTempRelativePath(candidateName, category);
                const base64 = await fileToBase64(file);
                await fsBridge.writeFileBase64(workspaceRootPath, relPath, base64, allowGlobal);
                const previewText = await extractTextPreview(file);
                await handleSendText(`[文件] ${file.name}`, 'file', {
                    source: 'chat_file_upload',
                    fileName: candidateName,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    category,
                    workspacePath: `/${relPath}`,
                    previewText: previewText || ''
                });
                sent += 1;
            }
            if (sent > 0) addToast(`已发送 ${sent} 个文件${skipped > 0 ? `，跳过 ${skipped} 个媒体文件` : ''}`, 'success');
            else addToast('未发送文件：仅支持文档/音频/压缩包等非图像视频文件', 'info');
        } catch (err: any) {
            addToast(err.message || '文件发送失败', 'error');
        } finally {
            if (chatFileInputRef.current) chatFileInputRef.current.value = '';
        }
    };

    const handleTouchStart = (item: Message | { name: string, url: string }, type: 'message' | 'emoji') => {
        longPressTimer.current = setTimeout(() => {
            if (type === 'message') {
                setSelectedMessage(item as Message);
                setModalType('message-options');
            } else {
                setSelectedEmoji(item as any);
                setModalType('delete-emoji');
            }
        }, 600);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleDeleteMessage = async () => {
        if (!selectedMessage) return;
        await DB.deleteMessage(selectedMessage.id);
        setMessages(prev => prev.filter(m => m.id !== selectedMessage.id));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除', 'success');
    };

    const handleDirectDelete = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        addToast('语音消息已删除', 'success');
    };

    const handleDeleteEmoji = async () => {
        if (!selectedEmoji) return;
        await DB.deleteEmoji(selectedEmoji.name);
        setEmojis(prev => prev.filter(e => e.name !== selectedEmoji.name));
        setModalType('none');
        setSelectedEmoji(null);
        addToast('表情包已删除', 'success');
    };

    const handleEditMessage = () => {
        if (!selectedMessage) return;
        setEditContent(selectedMessage.content);
        setModalType('edit-message');
    };

    const confirmEditMessage = async () => {
        if (!selectedMessage) return;
        await DB.updateMessage(selectedMessage.id, editContent);
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, content: editContent } : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已修改', 'success');
    };

    const handleClearHistory = async () => {
        if (!char) return;
        if (preserveContext) {
            const toDelete = messages.slice(0, -10);
            if (toDelete.length === 0) {
                addToast('消息太少，无需清理', 'info');
                return;
            }
            await DB.deleteMessages(toDelete.map(m => m.id));
            setMessages(messages.slice(-10));
            addToast(`已清理 ${toDelete.length} 条历史，保留最近10条`, 'success');
        } else {
            await DB.clearMessages(char.id);
            setMessages([]);
            addToast('已清空 (包含见面记录)', 'success');
        }
        setModalType('none');
    };

    const handleReroll = async () => {
        if (isTyping || messages.length === 0) return;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        const toDeleteIds: number[] = [];
        const assistantMsgsToClean: Message[] = [];
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role === 'assistant') {
            const m = messages[index];
            toDeleteIds.push(m.id);
            if (m.type === 'voice' && m.content?.startsWith('workspace://voice_cache/agent/')) {
                assistantMsgsToClean.push(m);
            }
            index--;
        }

        if (toDeleteIds.length === 0) return;

        // Cleanup physical files
        if (workspaceRootPath) {
            for (const m of assistantMsgsToClean) {
                try {
                    const relPath = m.content.replace('workspace://', '');
                    await fsBridge.deleteFile(workspaceRootPath, relPath, allowGlobal);
                } catch (e) {
                    console.error("Failed to delete rerolled voice file:", e);
                }
            }
        }

        await DB.deleteMessages(toDeleteIds);
        const newHistory = messages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        triggerAI(newHistory, sessionVoiceActive);
    };

    const handleFullArchive = async () => {
        if (!apiConfig.apiKey || !char) {
            addToast('请先配置 API Key', 'error');
            return;
        }

        const msgsByDate: Record<string, Message[]> = {};
        messages.forEach(m => {
            // FIX: Use local date construction to avoid UTC offset issues
            const d = new Date(m.timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
            msgsByDate[dateStr].push(m);
        });

        const dates = Object.keys(msgsByDate).sort();
        // REMOVED FILTER: Blindly process ALL dates present in logs
        const datesToProcess = dates;

        if (datesToProcess.length === 0) {
            addToast('聊天记录为空，无法归档', 'info');
            return;
        }

        setIsSummarizing(true);
        setShowPanel('none');

        try {
            let processedCount = 0;
            const newMemories: MemoryFragment[] = [];

            for (const dateStr of datesToProcess) {
                const dayMsgs = msgsByDate[dateStr];
                const rawLog = dayMsgs.map((m: Message) => {
                    const time = `[${formatTime(m.timestamp)}]`;
                    const sender = m.role === 'user' ? userDisplayName : charDisplayName;
                    let body = '';
                    if (m.type === 'image') body = '[Image]';
                    else if (m.type === 'video') body = '[Video]';
                    else if (m.type === 'voice') {
                        const emo = m.metadata?.emotion ? ` (${m.metadata.emotion})` : '';
                        body = `[语音消息]: ${m.metadata?.transcription || '(无内容)'}${emo}`;
                    } else {
                        body = m.content;
                    }
                    return `${time} ${sender}: ${body}`;
                }).join('\n');

                // Enhanced Prompt for concise memory
                const prompt = `系统: 你是 ${charDisplayName}（真实名 ${char.name}）。
用户: ${userDisplayName}（真实名 ${userProfile.name}）。
任务: 将 ${dateStr} 的聊天记录压缩为一条“核心记忆”。
核心目的: 节省长期记忆Token，同时保留关键信息。
要求:
1. **第一人称** (“我”)。
2. **极其简练**：用最少的字数把事情和互动重点说清楚。
3. **微带情绪**：保留一点你的态度，但绝对不要写成冗长的日记。
4. **语言**: 必须使用中文。
日志:
${rawLog.substring(0, 8000)}`;

                const resolved = resolveApiEndpoint(apiConfig);
                let sumBody: any = {
                        model: apiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.5,
                        // FIX: Increased token limit for reasoning models
                        max_tokens: 4000
                    };
                if (resolved.transformBody) sumBody = resolved.transformBody(sumBody);
                const response = await fetch(resolved.chatUrl, {
                    method: 'POST',
                    headers: resolved.headers,
                    body: JSON.stringify(sumBody)
                });

                if (!response.ok) throw new Error(`API Error on ${dateStr}`);

                const data = await response.json();

                // Fallback Logic for empty content (reasoning models sometimes cut off)
                let summary = data.choices?.[0]?.message?.content || '';

                if (!summary && data.choices?.[0]?.message?.reasoning_content) {
                    // If main content is empty but reasoning exists, try to salvage.
                    // But ideally 4000 tokens fixes this.
                    console.warn("Content empty, checking reasoning...");
                }

                summary = summary.trim();
                summary = summary.replace(/^["']|["']$/g, ''); // Remove surrounding quotes

                if (summary) {
                    newMemories.push({
                        id: `mem-${Date.now()}`,
                        date: dateStr,
                        summary: summary,
                        mood: 'archive'
                    });
                    processedCount++;
                } else {
                    console.error(`Empty summary for ${dateStr}`);
                }

                await new Promise(r => setTimeout(r, 500));
            }

            const finalMemories = [...(char.memories || []), ...newMemories];
            updateCharacter(char.id, { memories: finalMemories });

            if (processedCount > 0) {
                addToast(`成功归档 ${processedCount} 天的记忆`, 'success');
            } else {
                addToast('归档完成，但没有生成有效内容', 'info');
            }

        } catch (e: any) {
            addToast(`归档中断: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
        }
    };

    const pickerVisiblePhotos = useMemo(() => pickerPhotos.slice(0, pickerVisibleCount), [pickerPhotos, pickerVisibleCount]);

    useEffect(() => {
        if (!showGalleryPicker || !galleryRootPath) return;
        const missing = pickerVisiblePhotos.filter(p => pickerPreviewMap[p.path] === undefined).slice(0, 12);
        if (missing.length === 0) return;
        let aborted = false;

        Promise.all(missing.map(async p => {
            try {
                const base64 = await fsBridge.readFileBase64(galleryRootPath, chatToRelPath(p.path), allowGlobal);
                return [p.path, `data:${chatMimeFromName(p.name)};base64,${base64}`] as const;
            } catch {
                return [p.path, ''] as const;
            }
        })).then(entries => {
            if (aborted) return;
            setPickerPreviewMap(prev => {
                const next = { ...prev };
                entries.forEach(([path, dataUrl]) => {
                    if (next[path] === undefined) next[path] = dataUrl;
                });
                return next;
            });
        });

        return () => { aborted = true; };
    }, [allowGlobal, galleryRootPath, pickerPreviewMap, pickerVisiblePhotos, showGalleryPicker]);

    const togglePickerSelect = useCallback((path: string) => {
        setPickerSelected(prev => ({ ...prev, [path]: !prev[path] }));
    }, []);

    const handleSendText = async (customContent?: string, customType?: MessageType, metadata?: any) => {
        if (!char || (!input.trim() && !customContent)) return;
        const text = customContent || input.trim();
        const type = customType || 'text';

        if (!apiConfig || !apiConfig.baseUrl) {
            addToast('⚠️ 请先在系统设置中配置 API', 'error');
            // Still allow saving user message locally, but warn about no AI response
        }

        if (!customContent) { setInput(''); localStorage.removeItem(draftKey); }

        // == Phase 2.4: Proactive Voice & Intent Lock Logic ==
        // Restore energy on every message (Text or Voice)
        setVoiceEnergy(prev => Math.min(100, prev + 15));

        let nextVoiceActive = sessionVoiceActive;
        // 1. Check for explicit intent first (Highest Priority)
        if (voiceStopIntent.test(text)) {
            nextVoiceActive = false;
            setSessionVoiceActive(false);
            setVoiceLock(true); // Lock the mode to text-only
            setConsecutiveTextCount(0);
        } else if (voiceStartIntent.test(text)) {
            nextVoiceActive = true;
            setSessionVoiceActive(true);
            setVoiceLock(false); // Release the lock
            setConsecutiveTextCount(0);
        } else {
            // 2. No explicit intent, follow message type if NOT locked
            if (type === 'voice') {
                if (!voiceLock) {
                    nextVoiceActive = true;
                    setSessionVoiceActive(true);
                }
                setConsecutiveTextCount(0);
            } else if (type === 'text' && sessionVoiceActive) {
                // Natural decay: check if we are hitting the limit (2 consecutive texts)
                if (consecutiveTextCount + 1 >= 2) {
                    nextVoiceActive = false;
                    setSessionVoiceActive(false);
                    setConsecutiveTextCount(0);
                } else {
                    setConsecutiveTextCount(prev => prev + 1);
                }
            }
        }

        const msgPayload: any = { charId: char.id, role: 'user', type, content: text, metadata };
        if (replyTarget) {
            msgPayload.replyTo = {
                id: replyTarget.id,
                content: replyTarget.content,
                name: replyTarget.role === 'user' ? '我' : char.name,
                messageType: replyTarget.type,
                fileName: replyTarget.type === 'file' ? (replyTarget.metadata?.fileName || '') : '',
                workspacePath: replyTarget.type === 'file' ? (replyTarget.metadata?.workspacePath || '') : ''
            };
            setReplyTarget(null);
        }
        await DB.saveMessage(msgPayload);
        if (type === 'text') EventBus.emit('Chat', '发送文本', text.slice(0, 24));
        else if (type === 'image') EventBus.emit('Chat', '发送图片', (metadata?.fileName || 'image').toString().slice(0, 24));
        else if (type === 'video') EventBus.emit('Chat', '发送视频', (metadata?.fileName || 'video').toString().slice(0, 24));
        else EventBus.emit('Chat', `发送${type}`, text.slice(0, 24));

        const updatedMsgs = await DB.getMessagesByCharId(char.id);
        setMessages(updatedMsgs);
        setShowPanel('none');

        // Allow proactive voice if session is NOT currently in voice mode, we have enough energy, system is not locked, and random check passes.
        const proactiveVoiceAllowed = !nextVoiceActive && !voiceLock && voiceEnergy >= 60 && Math.random() < 0.15;

        // == Phase 2.5: Humanized Message Coalescing (Debounce) ==
        if (triggerDebounceTimerRef.current) {
            clearTimeout(triggerDebounceTimerRef.current);
        }

        // 1. Calculate base wait time
        let finalWaitTime = chatWaitTime;

        // 2. Content-aware bonus: if user mentions seeing/media, wait longer (Agent "looking at media")
        const mediaKeywords = /(视频|图|看|这张|那个)/i;
        if (mediaKeywords.test(text) || type === 'image' || type === 'video') {
            finalWaitTime += 1500;
        }

        // 3. Add random jitter (±500ms) to feel more human
        const jitter = Math.floor(Math.random() * 1001) - 500;
        finalWaitTime = Math.max(500, finalWaitTime + jitter);

        if (!isTyping) {
            triggerDebounceTimerRef.current = setTimeout(async () => {
                // Fetch the absolute latest messages just before triggering to ensure we capture multiple rapidly sent messages
                const latestMsgs = await DB.getMessagesByCharId(char.id);
                triggerAI(latestMsgs, nextVoiceActive, proactiveVoiceAllowed);
                triggerDebounceTimerRef.current = null;
            }, finalWaitTime);
        }

    };

    const handleSendFromPicker = useCallback(async () => {
        if (!galleryRootPath) return;
        const selectedPaths = Object.keys(pickerSelected).filter(k => pickerSelected[k]);
        if (selectedPaths.length === 0) {
            addToast('请先选择媒体', 'info');
            return;
        }
        let sent = 0;
        for (const path of selectedPaths) {
            const photo = pickerPhotos.find(p => p.path === path);
            if (!photo) continue;
            let dataUrl = pickerPreviewMap[path];
            if (!dataUrl) {
                const base64 = await fsBridge.readFileBase64(galleryRootPath, chatToRelPath(path), allowGlobal);
                dataUrl = `data:${chatMimeFromName(photo.name)};base64,${base64}`;
            }
            const CACHE_TTL = 10 * 60 * 1000;
            let detail = (await DB.getImageDetailByFileName(photo.name).catch(() => null))?.detail || '';
            let videoFrames: string[] = [];
            const cacheKey = `${photo.mediaType}|${path.toLowerCase()}`;
            const cached = mediaDetailCacheRef.current.get(cacheKey);
            const now = Date.now();
            if (cached && now - cached.ts < CACHE_TTL) {
                detail = detail || cached.detail;
                videoFrames = cached.videoFrames || [];
            }
            if (photo.mediaType === 'video' && videoFrames.length === 0) {
                const maxFrames = apiConfig.videoUnderstanding?.maxFrames || 10;
                videoFrames = await captureVideoFrames(dataUrl, maxFrames);
            }
            if (!detail) {
                if (photo.mediaType === 'video') {
                    detail = await inferVideoDetail(dataUrl, videoFrames);
                } else {
                    detail = await inferImageDetail(dataUrl, '图片');
                }
                if (detail) {
                    await DB.saveImageDetail({
                        fileName: photo.name,
                        detail,
                        source: 'agent',
                        relatedPath: path
                    });
                }
            }
            mediaDetailCacheRef.current.set(cacheKey, { detail: detail || '', ts: now, videoFrames });
            await handleSendText(dataUrl, photo.mediaType === 'video' ? 'video' : 'image', {
                source: photo.mediaType === 'video' ? 'gallery_picker_video' : 'gallery_picker',
                fileName: photo.name,
                galleryPath: path,
                imageDetail: detail,
                videoDetail: photo.mediaType === 'video' ? detail : '',
                videoFrame: photo.mediaType === 'video' ? (videoFrames[0] || '') : '',
                videoFrames: photo.mediaType === 'video' ? videoFrames : [],
                mediaType: photo.mediaType
            });
            sent += 1;
        }
        setShowGalleryPicker(false);
        setPickerSelected({});
        addToast(`已发送 ${sent} 个相册媒体`, 'success');
    }, [addToast, allowGlobal, apiConfig.videoUnderstanding?.maxFrames, galleryRootPath, inferImageDetail, inferVideoDetail, pickerPhotos, pickerPreviewMap, pickerSelected]);

    const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const dataUrl = await processImage(file);
            updateCharacter(char.id, { chatBackground: dataUrl });
            addToast('聊天背景已更新', 'success');
        } catch (err: any) {
            addToast(err.message, 'error');
        }
    };

    const handleBgUploadFile = async (file: File) => {
        await handleBgUpload({ target: { files: [file] } } as any);
    };

    const handleImportEmoji = async () => {
        const lines = emojiImportText.split('\n');
        for (const line of lines) {
            const [n, u] = line.split('--');
            if (n && u) await DB.saveEmoji(n.trim(), u.trim());
        }
        setEmojis(await DB.getEmojis());
        setModalType('none');
    };

    const saveSettings = () => {
        updateCharacter(char.id, {
            contextLimit: settingsContextLimit,
            hideSystemLogs: settingsHideSysLogs,
            replySplitInterval: settingsReplySplitInterval
        });
        setModalType('none');
        addToast('设置已保存', 'success');
    };

    const langNameToVoiceCode = (name: string) => {
        if (name === '中文') return '';
        if (name === 'English') return 'en';
        if (name === '日本語') return 'ja';
        if (name === '한국어') return 'ko';
        if (name === 'Français') return 'fr';
        if (name === 'Español') return 'es';
        return '';
    };

    const handleToggleTranslation = useCallback(async () => {
        const next = !translationEnabled;
        setTranslationEnabled(next);
        localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next));

        // Voice Lang Sync Logic
        if (char) {
            const nextVoiceLang = next ? langNameToVoiceCode(translateSourceLang) : '';
            if (char.chatVoiceLang !== nextVoiceLang) {
                const newChar = { ...char, chatVoiceLang: nextVoiceLang };
                await DB.saveCharacter(newChar);
                updateCharacter(char.id, newChar);
            }
        }
    }, [translationEnabled, activeCharacterId, char, translateSourceLang, updateCharacter]);

    const handleSetTranslateSourceLang = useCallback(async (lang: string) => {
        setTranslateSourceLang(lang);
        localStorage.setItem('chat_translate_source_lang', lang);

        // Voice Lang Sync Logic
        if (translationEnabled && char) {
            const nextVoiceLang = langNameToVoiceCode(lang);
            if (char.chatVoiceLang !== nextVoiceLang) {
                const newChar = { ...char, chatVoiceLang: nextVoiceLang };
                await DB.saveCharacter(newChar);
                updateCharacter(char.id, newChar);
            }
        }
    }, [translationEnabled, char, updateCharacter]);

    const handleSetTranslateLang = useCallback((lang: string) => {
        setTranslateTargetLang(lang);
        localStorage.setItem('chat_translate_lang', lang);
    }, []);

    const handleTranslateToggle = useCallback((msgId: number) => {
        setShowingTargetIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const handleSetHistoryStart = (messageId: number | undefined) => {
        updateCharacter(char.id, { hideBeforeMessageId: messageId });
        setModalType('none');
        addToast(messageId ? '已隐藏历史消息' : '已恢复全部历史记录', 'success');
    };

    const handleMessageLongPress = useCallback((m: Message) => {
        if (selectionMode) {
            setSelectedMsgIds(prev => {
                const next = new Set(prev);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                return next;
            });
            return;
        }
        setSelectedMessage(m);
        setModalType('message-options');
    }, [selectionMode]);

    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectedMessage(null);
        } else {
            setSelectedMsgIds(new Set());
        }
        setSelectionMode(true);
        setModalType('none');
    };

    const handleSelectionToggle = (id: number) => {
        if (!selectionMode) return;
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBatchDeleteSelected = async () => {
        const ids = Array.from(selectedMsgIds);
        if (ids.length === 0) {
            addToast('请先选择消息', 'info');
            return;
        }
        await DB.deleteMessages(ids);
        const updated = await DB.getMessagesByCharId(char.id);
        setMessages(updated);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        addToast(`已删除 ${ids.length} 条消息`, 'success');
    };

    const handleReplyMessage = () => {
        if (!selectedMessage || selectedMessage.role === 'system') return;
        setReplyTarget(selectedMessage);
        setModalType('none');
        addToast('已选择引用消息', 'success');
    };

    const handleCopyMessage = async () => {
        if (!selectedMessage?.content) return;
        try {
            await navigator.clipboard.writeText(selectedMessage.content);
            addToast('已复制消息', 'success');
        } catch {
            addToast('复制失败', 'error');
        }
        setModalType('none');
    };

    const displayMessages = messages
        .filter(m => m.metadata?.source !== 'date')
        .filter(m => !char?.hideBeforeMessageId || m.id >= char.hideBeforeMessageId)
        .filter(m => !(char?.hideSystemLogs && m.role === 'system'))
        .slice(-visibleCount);

    return (
        <div
            className="flex flex-col h-full bg-[#f1f5f9] overflow-hidden relative font-sans transition-all duration-500"
            style={{
                backgroundImage: char.chatBackground ? `url(${char.chatBackground})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
        >
            {/* Dynamic Style Injection for Custom CSS */}
            {activeTheme.customCss && <style>{activeTheme.customCss}</style>}

            <ChatModals
                modalType={modalType}
                setModalType={setModalType}
                transferAmt={transferAmt}
                setTransferAmt={setTransferAmt}
                emojiImportText={emojiImportText}
                setEmojiImportText={setEmojiImportText}
                settingsContextLimit={settingsContextLimit}
                setSettingsContextLimit={setSettingsContextLimit}
                settingsHideSysLogs={settingsHideSysLogs}
                setSettingsHideSysLogs={setSettingsHideSysLogs}
                preserveContext={preserveContext}
                setPreserveContext={setPreserveContext}
                editContent={editContent}
                setEditContent={setEditContent}
                selectedMessage={selectedMessage}
                selectedEmoji={selectedEmoji}
                activeCharacter={char}
                allHistoryMessages={allHistoryMessages}
                chatVoiceEnabled={char.chatVoiceEnabled}
                onToggleChatVoice={async () => {
                    const val = !char.chatVoiceEnabled;
                    const newChar = { ...char, chatVoiceEnabled: val };
                    await DB.saveCharacter(newChar);
                    updateCharacter(char.id, newChar);
                    if (val) addToast('已开启语音回复', 'success');
                    else addToast('已关闭语音回复', 'info');
                }}
                chatVoiceLang={char.chatVoiceLang}
                onSetChatVoiceLang={async (lang) => {
                    const newChar = { ...char, chatVoiceLang: lang };
                    await DB.saveCharacter(newChar);
                    updateCharacter(char.id, newChar);
                }}
                translationEnabled={translationEnabled}
                onToggleTranslation={handleToggleTranslation}
                translateSourceLang={translateSourceLang}
                translateTargetLang={translateTargetLang}
                onSetTranslateSourceLang={handleSetTranslateSourceLang}
                onSetTranslateLang={handleSetTranslateLang}
                onTransfer={() => { if (transferAmt) handleSendText('[转账]', 'transfer', { amount: transferAmt }); setModalType('none'); }}
                onImportEmoji={handleImportEmoji}
                onSaveSettings={saveSettings}
                onBgUpload={handleBgUploadFile}
                onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                onClearHistory={handleClearHistory}
                onSetHistoryStart={handleSetHistoryStart}
                onEnterSelectionMode={handleEnterSelectionMode}
                onReplyMessage={handleReplyMessage}
                onEditMessageStart={handleEditMessage}
                onConfirmEditMessage={confirmEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onCopyMessage={handleCopyMessage}
                onDeleteEmoji={handleDeleteEmoji}
                onFavoriteSticker={async () => {
                    if (selectedMessage?.type === 'emoji' && workspaceRootPath) {
                        const url = selectedMessage.content;
                        // Infer name from metadata or URL
                        const name = selectedMessage.metadata?.stickerName || url.split('/').pop()?.split('.')[0] || '收藏表情';
                        const ok = await StickerParser.favoriteSticker(workspaceRootPath, name, url, allowGlobal);
                        if (ok) {
                            setPickerKey(prev => prev + 1);
                            addToast('已收藏到表情包', 'success');
                        } else {
                            addToast('收藏失败', 'error');
                        }
                        setModalType('none');
                    }
                }}
                chatWaitTime={chatWaitTime}
                onSetChatWaitTime={setChatWaitTime}
                replySplitInterval={settingsReplySplitInterval}
                onSetReplySplitInterval={setSettingsReplySplitInterval}
            />

            <Modal
                isOpen={showGalleryPicker}
                title="从相册选择"
                onClose={() => setShowGalleryPicker(false)}
                footer={
                    <>
                        <button onClick={() => pickerUploadInputRef.current?.click()} className="flex-1 py-3 bg-slate-100 rounded-2xl">上传</button>
                        <button onClick={handleSendFromPicker} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">发送所选</button>
                    </>
                }
            >
                <input type="file" ref={pickerUploadInputRef} className="hidden" accept="image/*,video/*" multiple onChange={handleChatImageSelect} />
                {pickerLoading ? (
                    <div className="h-48 flex items-center justify-center text-sm text-slate-400">正在读取相册...</div>
                ) : pickerPhotos.length === 0 ? (
                    <div className="h-48 flex flex-col items-center justify-center text-sm text-slate-400 gap-3">
                        <span>相册暂无可发送媒体</span>
                        <button onClick={() => pickerUploadInputRef.current?.click()} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">上传媒体</button>
                    </div>
                ) : (
                    <div>
                        <div className="text-[11px] text-slate-400 mb-2">支持单选/多选，已选 {Object.values(pickerSelected).filter(Boolean).length} 个</div>
                        <div className="grid grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto no-scrollbar pr-1">
                            {pickerVisiblePhotos.map(photo => {
                                const checked = !!pickerSelected[photo.path];
                                const preview = pickerPreviewMap[photo.path];
                                return (
                                    <button
                                        key={photo.path}
                                        onClick={() => togglePickerSelect(photo.path)}
                                        className={`aspect-square rounded-xl border overflow-hidden relative ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200'}`}
                                    >
                                        {preview ? (
                                            <div className="w-full h-full p-1 bg-slate-100">
                                                {photo.mediaType === 'video' ? (
                                                    <div className="w-full h-full relative rounded-lg overflow-hidden">
                                                        <video src={preview} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                                        <div className="absolute inset-0 flex items-center justify-center">
                                                            <div className="w-7 h-7 rounded-full bg-black/35 flex items-center justify-center">
                                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white"><path d="M8.28 5.22A.75.75 0 0 0 7 5.75v12.5a.75.75 0 0 0 1.28.53l9.25-6.25a.75.75 0 0 0 0-1.06L8.28 5.22Z" /></svg>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <img src={preview} className="w-full h-full object-contain" />
                                                )}
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">🖼️</div>
                                        )}
                                        <div className="absolute left-1 right-1 bottom-1 px-1.5 py-0.5 bg-black/40 text-white text-[10px] rounded truncate">{photo.album} · {photo.mediaType === 'video' ? '视频' : '图片'}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {pickerPhotos.length > pickerVisibleCount && (
                            <button onClick={() => setPickerVisibleCount(v => v + 45)} className="w-full mt-2 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">
                                加载更多 ({pickerPhotos.length - pickerVisibleCount})
                            </button>
                        )}
                    </div>
                )}
            </Modal>

            {/* Header */}
            <div className="h-24 bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shrink-0 z-30 sticky top-0 shadow-sm relative">
                <div className="flex items-center gap-3 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg></button>
                    <div onClick={() => setShowPanel('chars')} className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer">
                        <img src={charDisplayAvatar} className="w-10 h-10 rounded-xl object-cover shadow-sm" alt="a" />
                        <div>
                            <div className="font-bold text-slate-800">{charDisplayName}</div>
                            <div className="flex items-center gap-2">
                                {!apiConfig?.baseUrl ? (
                                    <div className="text-[10px] text-red-500 uppercase font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                                        API 未配置
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-slate-400 uppercase">Online</div>
                                )}
                                {lastTokenUsage && (
                                    <div className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded-md font-mono border border-slate-200">
                                        ⚡ {lastTokenUsage}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => triggerAI(messages)} disabled={isTyping} className={`p-2 rounded-full ${isTyping ? 'bg-slate-100' : 'bg-primary/10 text-primary'}`}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg></button>
                </div>
                {isSummarizing && (
                    <div className="absolute top-full left-0 w-full bg-indigo-50 border-b border-indigo-100 p-2 flex items-center justify-center gap-2">
                        <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                        <span className="text-xs text-indigo-600 font-medium">正在整理记忆档案，请稍候...</span>
                    </div>
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto pt-6 pb-6 no-scrollbar" style={{ backgroundImage: activeTheme.type === 'custom' && activeTheme.user.backgroundImage ? 'none' : undefined }}>

                {messages.length > visibleCount && (
                    <div className="flex justify-center mb-6">
                        <button
                            onClick={() => setVisibleCount(prev => prev + 30)}
                            className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors"
                        >
                            加载历史消息 ({messages.length - visibleCount})
                        </button>
                    </div>
                )}

                {displayMessages.map((m, i) => {
                    const prevRole = i > 0 ? displayMessages[i - 1].role : null;
                    const nextRole = i < displayMessages.length - 1 ? displayMessages[i + 1].role : null;
                    return (
                        <ChatMessageItem
                            key={m.id || i}
                            msg={m}
                            isFirstInGroup={prevRole !== m.role}
                            isLastInGroup={nextRole !== m.role}
                            activeTheme={activeTheme}
                            charAvatar={charDisplayAvatar}
                            charName={charDisplayName}
                            userAvatar={userDisplayAvatar}
                            onLongPress={handleMessageLongPress}
                            translationEnabled={translationEnabled}
                            isShowingTarget={showingTargetIds.has(m.id)}
                            onTranslateToggle={handleTranslateToggle}
                            selectionMode={selectionMode}
                            isSelected={selectedMsgIds.has(m.id)}
                            onSelectionToggle={handleSelectionToggle}
                            workspaceRootPath={workspaceRootPath}
                            allowGlobal={allowGlobal}
                            onDirectDelete={handleDirectDelete}
                        />
                    );
                })}

                {(isTyping || recallStatus) && (
                    <div className="flex items-end gap-3 px-3 mb-6 animate-fade-in">
                        <img src={charDisplayAvatar} className="w-9 h-9 rounded-[10px] object-cover" />
                        <div className="bg-white px-4 py-3 rounded-2xl shadow-sm">
                            {recallStatus ? (
                                <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {recallStatus}
                                </div>
                            ) : (
                                <div className="flex gap-1"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className={`bg-white/90 backdrop-blur-2xl border-t border-slate-200/50 pb-safe shrink-0 z-40 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] relative ${selectionMode ? 'pb-3' : ''}`}>
                {selectionMode ? (
                    <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                        <button onClick={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); }} className="text-[16px] text-slate-500 px-2 py-1 active:opacity-70 transition-opacity">取消</button>
                        <div className="text-[14px] font-bold text-slate-700">已选择 {selectedMsgIds.size} 项</div>
                        <button onClick={handleBatchDeleteSelected} disabled={selectedMsgIds.size === 0} className={`text-[16px] px-2 py-1 active:opacity-70 transition-opacity ${selectedMsgIds.size > 0 ? 'text-red-500' : 'text-slate-300'}`}>删除</button>
                    </div>
                ) : (
                    <>
                        {replyTarget && (
                            <div className="px-4 pt-2">
                                <div className="bg-slate-100 rounded-xl px-3 py-2 flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[10px] text-slate-500">正在回复 {replyTarget.role === 'user' ? '我' : charDisplayName}</div>
                                        <div className="text-xs text-slate-700 truncate">{replyTarget.type === 'file' ? `[文件] ${replyTarget.metadata?.fileName || replyTarget.content}` : replyTarget.content}</div>
                                    </div>
                                    <button onClick={() => setReplyTarget(null)} className="text-slate-400 text-xs px-2">取消</button>
                                </div>
                            </div>
                        )}

                        <div className="p-3 px-4 flex gap-3 items-end">
                            <button onClick={() => setShowPanel(showPanel === 'actions' ? 'none' : 'actions')} className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg></button>

                            {/* Voice/Text Mode Toggle */}
                            <button
                                onClick={() => setVoiceMode(!voiceMode)}
                                className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors shrink-0"
                            >
                                {voiceMode ? (
                                    /* Keyboard icon */
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                                    </svg>
                                ) : (
                                    /* Microphone icon */
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                                    </svg>
                                )}
                            </button>

                            {voiceMode ? (
                                /* Voice Mode: Press-to-Talk Button */
                                <button
                                    className="flex-1 bg-slate-100 rounded-[24px] py-3 text-center text-[15px] font-bold text-slate-500 active:bg-slate-200 active:scale-[0.98] transition-all select-none border border-transparent"
                                    onTouchStart={async (e) => {
                                        e.preventDefault();
                                        setShowVoiceRecorder(true);
                                        voiceResultRef.current = voiceRecorder.startRecording();
                                        // Start STT simultaneously
                                        const stt = getSTTService();
                                        sttTranscriptRef.current = '';
                                        if (stt.isSupported) {
                                            stt.start((result) => { sttTranscriptRef.current = result.text; });
                                        }
                                    }}
                                    onMouseDown={async () => {
                                        setShowVoiceRecorder(true);
                                        voiceResultRef.current = voiceRecorder.startRecording();
                                        const stt = getSTTService();
                                        sttTranscriptRef.current = '';
                                        if (stt.isSupported) {
                                            stt.start((result) => { sttTranscriptRef.current = result.text; });
                                        }
                                    }}
                                >
                                    按住 说话
                                </button>
                            ) : (
                                /* Text Mode: Normal Input */
                                <div className="flex-1 bg-slate-100 rounded-[24px] flex items-center px-1 border border-transparent focus-within:bg-white focus-within:border-primary/30 transition-all">
                                    <textarea rows={1} value={input} onChange={handleInputChange} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }} className="flex-1 bg-transparent px-4 py-3 text-[15px] resize-none max-h-24" placeholder="Message..." style={{ height: 'auto' }} />
                                    <button onClick={() => setShowPanel(showPanel === 'emojis' ? 'none' : 'emojis')} className="p-2 text-slate-400 hover:text-primary"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg></button>
                                </div>
                            )}

                            <button onClick={() => handleSendText()} disabled={voiceMode || !input.trim()} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${!voiceMode && input.trim() ? 'bg-primary text-white shadow-lg' : 'bg-slate-200 text-slate-400'}`}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg></button>
                        </div>
                    </>
                )}

                {/* Voice Recorder Overlay — appears while finger held down */}
                {showVoiceRecorder && (
                    <VoiceRecorder
                        isRecording={voiceRecorder.isRecording}
                        duration={voiceRecorder.duration}
                        volumeLevel={voiceRecorder.volumeLevel}
                        onAction={async (action: VoiceAction) => {
                            const stt = getSTTService();
                            if (action === 'too_short') {
                                voiceRecorder.cancelRecording();
                                stt.cancel();
                                setShowVoiceRecorder(false);
                                showVoiceToast('说话时间太短');
                                return;
                            }
                            if (action === 'cancel') {
                                voiceRecorder.cancelRecording();
                                stt.cancel();
                                setShowVoiceRecorder(false);
                                return;
                            }
                            // Stop STT and get final transcription
                            const transcription = stt.stop() || sttTranscriptRef.current;
                            voiceRecorder.stopRecording();
                            const result = await voiceResultRef.current;
                            setShowVoiceRecorder(false);
                            if (!result) return;

                            const saveVoiceToWorkspace = async (blob: Blob, fallbackUrl: string) => {
                                if (!workspaceRootPath) return fallbackUrl;
                                try {
                                    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
                                    const fileName = `voice_cache/user/${Date.now()}_voice.${ext}`;
                                    const base64data = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => resolve(reader.result as string);
                                        reader.readAsDataURL(blob);
                                    });
                                    const base64 = base64data.split(',')[1];
                                    await fsBridge.writeFileBase64(workspaceRootPath, fileName, base64, allowGlobal);
                                    return `workspace://${fileName}`;
                                } catch (err) {
                                    console.error('Failed to save voice cache:', err);
                                    return fallbackUrl;
                                }
                            };

                            if (action === 'send') {
                                const finalUrl = await saveVoiceToWorkspace(result.blob, result.url);
                                handleSendText(finalUrl, 'voice', { duration: result.duration, transcription });
                            } else if (action === 'text') {
                                // Convert to text: send as text message 
                                if (transcription) {
                                    handleSendText(transcription, 'text');
                                } else {
                                    const finalUrl = await saveVoiceToWorkspace(result.blob, result.url);
                                    handleSendText(finalUrl, 'voice', { duration: result.duration, transcription: '' });
                                    showVoiceToast('语音转文字失败');
                                }
                            }
                        }}
                    />
                )}

                {/* WeChat-style centered voice toast */}
                <VoiceToast message={voiceToastMsg} visible={voiceToastVisible} onDismiss={dismissVoiceToast} />

                {/* ... Panel Content (Kept same) ... */}
                {showPanel !== 'none' && (
                    <div className="bg-slate-50 h-72 border-t border-slate-200/60 overflow-y-auto no-scrollbar relative z-0">
                        {showPanel === 'actions' && (
                            <div className="p-6 grid grid-cols-4 gap-8">
                                <button onClick={() => setModalType('transfer')} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform"><div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center shadow-sm text-orange-400 border border-orange-100"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" /><path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75-.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div><span className="text-xs font-bold">转账</span></button>
                                <button onClick={() => handleSendText('[戳一戳]', 'interaction')} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform"><div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center shadow-sm text-2xl border border-sky-100">👉</div><span className="text-xs font-bold">戳一戳</span></button>
                                <button onClick={handleFullArchive} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform"><div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center shadow-sm text-indigo-400 border border-indigo-100"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg></div><span className="text-xs font-bold">{isSummarizing ? '归档中...' : '记忆归档'}</span></button>
                                <button onClick={() => setModalType('chat-settings')} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform"><div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center shadow-sm text-slate-500 border border-slate-100"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 2.555c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.212 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-2.555c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg></div><span className="text-xs font-bold">设置</span></button>

                                <button onClick={openGalleryPicker} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform">
                                    <div className="w-14 h-14 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm text-pink-400 border border-pink-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                            <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-bold">相册</span>
                                </button>
                                <button onClick={() => chatFileInputRef.current?.click()} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform">
                                    <div className="w-14 h-14 bg-cyan-50 rounded-2xl flex items-center justify-center shadow-sm text-cyan-500 border border-cyan-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12h6m-6 3h6m2.25-13.5H6.375a1.125 1.125 0 0 0-1.125 1.125v15.75c0 .621.504 1.125 1.125 1.125h11.25c.621 0 1.125-.504 1.125-1.125V7.5Z" />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-bold">文件</span>
                                </button>
                                <button onClick={() => { setShowPanel('none'); openApp(AppID.User); }} className="flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform">
                                    <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center shadow-sm text-violet-500 border border-violet-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-bold">我们的设置</span>
                                </button>
                                <input type="file" ref={chatImageInputRef} className="hidden" accept="image/*,video/*" multiple onChange={handleChatImageSelect} />
                                <input type="file" ref={chatFileInputRef} className="hidden" accept=".txt,.md,.pdf,.doc,.docx,.rtf,.csv,.json,.xml,.yaml,.yml,.ppt,.pptx,.xls,.xlsx,.mp3,.wav,.ogg,.m4a,.flac,.aac,.zip,.rar,.7z,.tar,.gz,audio/*,text/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={handleChatFileSelect} />

                                {/* Moved Regenerate Button Here */}
                                <button onClick={handleReroll} disabled={!canReroll} className={`flex flex-col items-center gap-2 active:scale-95 transition-transform ${canReroll ? 'text-slate-600' : 'text-slate-300 opacity-50'}`}>
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm border ${canReroll ? 'bg-emerald-50 text-emerald-400 border-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-bold">重新生成</span>
                                </button>

                            </div>
                        )}
                        {showPanel === 'emojis' && (
                            <StickerPicker
                                key={pickerKey}
                                workspaceRootPath={workspaceRootPath || ''}
                                onSelect={(item) => handleSendText(item.url, 'emoji', { stickerName: item.name })}
                                addToast={addToast}
                                onDeleteFav={async (item) => {
                                    if (await StickerParser.deleteFavorite(workspaceRootPath || '', item.url)) {
                                        addToast('表情已从收藏移除', 'success');
                                        setPickerKey(prev => prev + 1);
                                    }
                                }}
                            />
                        )}
                        {showPanel === 'chars' && (
                            <div className="p-5 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 px-1 tracking-wider uppercase mb-3">气泡样式</h3>
                                    <div className="flex gap-3 px-1 overflow-x-auto no-scrollbar pb-2">
                                        {Object.values(PRESET_THEMES).map(t => (
                                            <button key={t.id} onClick={() => updateCharacter(char.id, { bubbleStyle: t.id })} className={`px-6 py-3 rounded-2xl text-xs font-bold border shrink-0 transition-all ${char.bubbleStyle === t.id ? 'bg-primary text-white border-primary' : 'bg-white border-slate-200 text-slate-600'}`}>{t.name}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 px-1 tracking-wider uppercase mb-3">我的形象</h3>
                                    <div className="flex flex-wrap gap-3 px-1">
                                        {characters.map(c => (
                                            <button key={c.id} onClick={() => { setActiveCharacterId(c.id); setShowPanel('none'); }} className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all ${activeCharacterId === c.id ? 'bg-slate-100 text-primary border-primary/20' : 'bg-white border-slate-200 text-slate-500'}`}>
                                                <img src={c.avatar} className="w-5 h-5 rounded-full object-cover" alt={c.name} />
                                                {c.nickname || c.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* Persistent Hidden Inputs */}
        </div>
    );
};

export default Chat;
