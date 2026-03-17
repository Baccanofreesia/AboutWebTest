import { useState } from 'react';
import { CharacterProfile, UserProfile, Message, StickerUsageRecord } from '../types';
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { ChatParser } from '../utils/chatParser';
import { StickerParser, StickerItem, StickerSet } from '../utils/stickerParser';
import { ContextEnhancer } from '../utils/contextEnhancer';
import { fsBridge } from '../utils/fsBridge';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';
import { voiceStopIntent } from '../utils/voiceIntent';
import { resolveApiEndpoint } from '../utils/apiResolver';
import { RealtimeContextManager } from '../utils/realtimeContext';
import { AgentSoulData, UserProfileData } from '../utils/profileFiles';

// ── chatPrompts 集中管理 prompt 与消息历史 ──
import {
    buildSystemPrompt,
    buildMessageHistory,
    syncAgentSoulFile,
    syncUserProfileFile,
    extractDeltaText,
    formatDate,
} from '../utils/chatPrompts';

interface UseChatAIProps {
    char: CharacterProfile | undefined;
    userProfile: UserProfile;
    apiConfig: any;
    emojis: { name: string, url: string }[];
    activeApp?: string;
    perceptionConfig: any;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    setMessages: (msgs: Message[]) => void;
    updateAgent: (updates: Partial<CharacterProfile>) => Promise<void>;
    updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
    translationConfig?: { enabled: boolean; sourceLang: string; targetLang: string };
    realtimeConfig?: any;
    xhsEnabled?: boolean;
    xhsMcpConfig?: { enabled: boolean; serverUrl: string };
    sessionVoiceActive?: boolean;
    setVoiceEnergy: React.Dispatch<React.SetStateAction<number>>;
}

export const useChatAI = ({
    char,
    userProfile,
    apiConfig,
    emojis,
    activeApp,
    perceptionConfig,
    addToast,
    setMessages,
    updateAgent,
    updateUserProfile,
    translationConfig,
    realtimeConfig,
    xhsEnabled,
    xhsMcpConfig,
    sessionVoiceActive,
    setVoiceEnergy,
}: UseChatAIProps) => {
    const [isTyping, setIsTyping] = useState(false);
    const [recallStatus, setRecallStatus] = useState('');
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);


    // ── 记忆调取：获取某月详细日志 ──
    const getDetailedLogsForMonth = (year: string, month: string) => {
        if (!char?.memories) return null;
        const target = `${year}-${month.padStart(2, '0')}`;
        const logs = char.memories.filter(
            m => m.date.includes(target) || m.date.includes(`${year}年${parseInt(month)}月`),
        );
        if (logs.length === 0) return null;
        return logs.map(m => `[${m.date}] (${m.mood || 'normal'}): ${m.summary}`).join('\n');
    };

    // ── SSE 流式读取完整 aiContent ──
    const readStream = async (body: ReadableStream<Uint8Array>): Promise<string> => {
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        let content = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (line.trim() === 'data: [DONE]') break;
                    const delta = extractDeltaText(line);
                    if (delta) content += delta;
                }
            }
        } finally {
            reader.releaseLock();
        }
        return content;
    };

    // ── 清理 AI 输出中的常见噪声 ──
    const cleanAiContent = (raw: string): string =>
        raw
            .replace(/\[\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}.*?\]/g, '')
            .replace(/^[\w\u4e00-\u9fa5]+:\s*/, '')
            .replace(
                /\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*(.*?)\]/g,
                '[[SEND_EMOJI: $1]]',
            );

    // ── 调 LLM（返回流式读取后的完整文本）──
    const callLLM = async (
        chatUrl: string,
        headers: Record<string, string>,
        messages: any[],
        temperature = 0.85,
        transformBody?: (body: any) => any,
    ): Promise<string> => {
        let requestBody: any = {
            model: apiConfig.model,
            messages,
            temperature,
            stream: true,
        };
        if (transformBody) requestBody = transformBody(requestBody);

        const response = await fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(`API Error ${response.status}`);
        if (!response.body) throw new Error('ReadableStream not supported in fetch response.');
        return readStream(response.body);
    };

    const triggerAI = async (
        currentMsgs: Message[],
        voiceActiveOverride?: boolean,
        proactiveVoiceAllowed?: boolean,
    ) => {
        if (isTyping || !char || !apiConfig.baseUrl) return;
        setIsTyping(true);
        setRecallStatus('');

        try {
            const resolved = resolveApiEndpoint(apiConfig);
            const headers = resolved.headers;

            // ── 语音意图检测 ──
            const lastUserMsg = currentMsgs.filter(m => m.role === 'user').pop();
            const lastUserText =
                lastUserMsg?.type === 'voice'
                    ? String(lastUserMsg.metadata?.transcription || '')
                    : String(lastUserMsg?.content || '');
            const stopIntentDetected = !!lastUserText && voiceStopIntent.test(lastUserText);
            const isVoiceCurrentlyActive =
                (voiceActiveOverride !== undefined ? voiceActiveOverride : sessionVoiceActive) &&
                !stopIntentDetected;


            // ── 表情包索引构建 ──
            let stickerSets: StickerSet[] = [];
            let stickerIndex = '';
            let stickerRelevantNames: string[] = [];
            const stickerUrlNameMap = new Map<string, string>();
            const stickerNameItemMap = new Map<string, StickerItem>();
            const workspaceRootPath = apiConfig?.nativeWorkspacePath || '';

            if (workspaceRootPath) {
                try {
                    stickerSets = await StickerParser.loadAllStickers(workspaceRootPath);
                    const usageMap = await DB.getStickerUsageMap();
                    stickerIndex = StickerParser.buildStickerIndex(stickerSets, 4, 12);

                    const stickerQueryText = currentMsgs
                        .slice(-6)
                        .map(m => {
                            if (m.type === 'emoji') return String(m.metadata?.stickerName || '').trim();
                            if (typeof m.content === 'string') return m.content;
                            return '';
                        })
                        .join(' ');

                    const relevant = StickerParser.searchRelevantStickersWithCategory(
                        stickerSets, stickerQueryText, 15, undefined, usageMap,
                    );
                    stickerRelevantNames = Array.from(new Set(relevant.map(r => r.name))).slice(0, 15);

                    for (const set of stickerSets) {
                        for (const item of set.items) {
                            if (item.url) stickerUrlNameMap.set(item.url, item.name);
                            if (item.name && !stickerNameItemMap.has(item.name)) {
                                stickerNameItemMap.set(item.name, item);
                            }
                        }
                    }
                } catch {
                    stickerSets = [];
                }
            }

            for (const e of emojis) {
                if (!e?.name || !e?.url) continue;
                if (!stickerUrlNameMap.has(e.url)) stickerUrlNameMap.set(e.url, e.name);
                if (!stickerNameItemMap.has(e.name)) {
                    stickerNameItemMap.set(e.name, { name: e.name, url: e.url, category: '自定义' });
                }
            }

            // ── 感知层 ──
            const lastMsg = currentMsgs.length > 0 ? currentMsgs[currentMsgs.length - 1] : null;
            const lastContent = lastMsg && typeof lastMsg.content === 'string' ? lastMsg.content : '';
            const perceptionBlock = await ContextEnhancer.buildSnapshot(activeApp, perceptionConfig, lastContent);

            // ── 关系事件 ──
            const relationEvents = await DB.getRelationEvents(8).catch(() => []);

            // ── System Prompt（委托给 chatPrompts.ts）──
            const baseSystemPrompt = await buildSystemPrompt({
                char,
                userProfile,
                apiConfig,
                currentMsgs,
                emojis,
                perceptionBlock,
                stickerIndex,
                stickerRelevantNames,
                realtimeConfig,
                translationConfig,
                xhsEnabled: xhsEnabled && xhsMcpConfig?.enabled,
                isVoiceCurrentlyActive: !!isVoiceCurrentlyActive,
                stopIntentDetected,
                lastUserMsgType: lastUserMsg?.type,
                proactiveVoiceAllowed,
                relationEvents,
            });

            // ── 消息历史（委托给 chatPrompts.ts）──
            const limit = char.contextLimit || 500;
            const { apiMessages, historySlice } = buildMessageHistory({
                msgs: currentMsgs,
                limit,
                char,
                userProfile,
                emojis,
                stickerUrlNameMap,
                stickerNameItemMap,
                apiConfig,
            });

            const bilingualActive =
                translationConfig?.enabled && translationConfig.sourceLang && translationConfig.targetLang;

            let apiMessages_full: any[] = [
                { role: 'system', content: baseSystemPrompt },
                ...apiMessages,
            ];
            if (bilingualActive) {
                apiMessages_full.push({
                    role: 'system',
                    content: `[Reminder: 每句话必须用 <翻译><原文>...</原文><译文>...</译文></翻译> 标签包裹，一句一个标签，绝对不能省略。]`,
                } as any);
            }

            // ════════════════════════════════════════
            // 第一次 LLM 调用
            // ════════════════════════════════════════
            let aiContent = cleanAiContent(
                await callLLM(resolved.chatUrl, headers, apiMessages_full, 0.85, resolved.transformBody),
            );

            // ── RECALL ──
            const recallMatch = aiContent.match(/\[\[RECALL:\s*(\d{4})[-/年](\d{1,2})\]\]/);
            if (recallMatch) {
                const [, year, month] = recallMatch;
                setRecallStatus(`正在调阅 ${year}年${month}月 的档案...`);
                const detailedLogs = getDetailedLogsForMonth(year, month);
                if (detailedLogs) {
                    const injectionMessage = {
                        role: 'system',
                        content: `[系统: 已成功调取 ${year}-${month} 的日志]\n${detailedLogs}\n[系统: 现在结合这些细节回答。]`,
                    };
                    const recallMessages = [
                        ...apiMessages_full,
                        { role: 'assistant', content: aiContent },
                        injectionMessage,
                    ];
                    const recallContent = cleanAiContent(
                        await callLLM(resolved.chatUrl, headers, recallMessages, 0.8, resolved.transformBody),
                    );
                    if (recallContent) {
                        aiContent = recallContent;
                        addToast(`已调用 ${year}-${month} 记忆`, 'info');
                    }
                }
            }

            // ── 主动联网搜索 ──
            const searchMatch = aiContent.match(/\[\[SEARCH:\s*([\s\S]*?)\]\]/);
            if (searchMatch) {
                const searchQuery = searchMatch[1].trim();
                const provider = (realtimeConfig?.newsProvider || 'tavily') as 'brave' | 'tavily';
                const providerName = provider === 'tavily' ? 'Tavily' : 'Brave';

                if (searchQuery && realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey) {
                    // 有配置：正常执行搜索
                    addToast(`正在使用 ${providerName} 搜索: ${searchQuery}`, 'info');
                    try {
                        const searchResult = await RealtimeContextManager.performSearch(
                            searchQuery,
                            realtimeConfig.newsApiKey,
                            provider,
                        );

                        if (searchResult.success && searchResult.results.length > 0) {
                            const resultsStr = searchResult.results
                                .map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   ${r.url}`)
                                .join('\n\n');
                            const cleanedForSearch =
                                aiContent.replace(/\[\[SEARCH:[\s\S]*?\]\]/g, '').trim() || '让我搜一下...';
                            const searchMessages = [
                                ...apiMessages_full,
                                { role: 'assistant', content: cleanedForSearch },
                                {
                                    role: 'user',
                                    content:
                                        `[系统: 搜索完成！以下是关于"${searchQuery}"的搜索结果]\n\n${resultsStr}\n\n` +
                                        `[系统: 现在请根据这些真实信息回复用户。用自然的语气分享，比如"我刚搜了一下发现..."、"诶我看到说..."。不要再输出[[SEARCH:...]]了。]`,
                                },
                            ];
                            const searchContent = cleanAiContent(
                                await callLLM(resolved.chatUrl, headers, searchMessages, 0.8, resolved.transformBody),
                            );
                            if (searchContent) {
                                aiContent = searchContent;
                                addToast(`搜索完成: ${searchQuery}`, 'success');
                            }
                        } else {
                            addToast(`搜索失败: ${searchResult.message}`, 'error');
                            aiContent = aiContent.replace(searchMatch[0], '').trim();
                        }
                    } catch (e: any) {
                        addToast(`${providerName} 搜索失败: ${e?.message || '网络错误'}`, 'error');
                        aiContent = aiContent.replace(searchMatch[0], '').trim();
                    }
                } else {
                    // ── 未配置搜索 API：移除标记，注入说明，重新调 LLM 生成自然回复 ──
                    addToast('未配置联网搜索能力', 'info');
                    const cleanedForNoSearch =
                        aiContent.replace(/\[\[SEARCH:[\s\S]*?\]\]/g, '').trim() || '让我查一下...';
                    const noSearchMessages = [
                        ...apiMessages_full,
                        { role: 'assistant', content: cleanedForNoSearch },
                        {
                            role: 'user',
                            content:
                                `[系统: 你尝试使用联网搜索（关键词："${searchQuery}"），但当前未配置联网搜索能力。` +
                                `请你：\n1. 先正常回应用户刚才说的话\n2. 自然地说明你现在没有联网搜索功能（不要用固定套话，根据你的性格来），` +
                                `比如"哎我好像不能联网查呢"、"这个我没办法搜啊"\n3. 尝试用你已有的知识回答，或者换个方式帮助用户\n4. 严禁再输出[[SEARCH:...]]标记]`,
                        },
                    ];
                    const noSearchContent = cleanAiContent(
                        await callLLM(resolved.chatUrl, headers, noSearchMessages, 0.8, resolved.transformBody),
                    );
                    if (noSearchContent) aiContent = noSearchContent;
                }
            }
            // 清理残留的 SEARCH 标记
            aiContent = aiContent.replace(/\[\[SEARCH:[\s\S]*?\]\]/g, '').trim();

            // ── 关系动作（昵称、头像等）保持原逻辑 ──
            const relationActions: { type: any; summary: string }[] = [];

            const nicknameRegex = /\[\[ACTION:CHANGE_NICKNAME\s*[|｜]\s*([\s\S]*?)\s*[|｜]\s*([\s\S]*?)\]\]/gi;
            let nicknameMatch;
            while ((nicknameMatch = nicknameRegex.exec(aiContent)) !== null) {
                const rawTarget = nicknameMatch[1].trim().toLowerCase();
                const target = ['agent', 'assistant', 'nova', 'ai'].includes(rawTarget) ? 'agent' : 'user';
                const nextNick = nicknameMatch[2].replace(/[`"'""'']/g, '').trim().slice(0, 20);
                if (!nextNick) continue;
                if (target === 'agent') {
                    await updateAgent({ nickname: nextNick });
                    await syncAgentSoulFile({ nickname: nextNick }, char, apiConfig);
                    relationActions.push({ type: 'agent_nickname_changed', summary: `Agent 聊天昵称更新为「${nextNick}」` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: ${char.name} 的聊天昵称更新为「${nextNick}」]` });
                } else {
                    await updateUserProfile({ nickname: nextNick });
                    await syncUserProfileFile({ nickname: nextNick }, userProfile, apiConfig);
                    relationActions.push({ type: 'user_nickname_changed', summary: `用户聊天昵称更新为「${nextNick}」` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 你的聊天昵称更新为「${nextNick}」]` });
                }
            }
            aiContent = aiContent.replace(nicknameRegex, '').trim();

            // ── 相册工具（resolveGalleryPath / loadGalleryDataUrl 等）──
            let galleryEntriesCache: { name: string; path: string }[] | null = null;
            const listGalleryEntries = async () => {
                if (!apiConfig?.galleryWorkspacePath) throw new Error('未配置相册路径');
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                if (galleryEntriesCache) return galleryEntriesCache;
                const rootItems = await fsBridge.readDir(apiConfig.galleryWorkspacePath, '/', allowGlobal);
                const rootFiles = rootItems
                    .filter(i => i.type === 'file' && /\.(jpe?g|png|webp|gif|bmp)$/i.test(i.name))
                    .map(i => ({ name: i.name, path: `/${i.name}` }));
                const folders = rootItems.filter(i => i.type === 'folder');
                const nested = await Promise.all(
                    folders.map(async f => {
                        const dirPath = `/${f.name}/`;
                        const items = await fsBridge.readDir(apiConfig.galleryWorkspacePath, dirPath, allowGlobal);
                        return items
                            .filter(i => i.type === 'file' && /\.(jpe?g|png|webp|gif|bmp)$/i.test(i.name))
                            .map(i => ({ name: i.name, path: `${dirPath}${i.name}` }));
                    }),
                );
                galleryEntriesCache = [...rootFiles, ...nested.flat()];
                return galleryEntriesCache;
            };

            const resolveGalleryPath = async (input: string): Promise<string> => {
                const token = String(input || '')
                    .replace(/[`"'""'']/g, '')
                    .replace(/[，。！？；：,!?;:\)\]\}]+$/g, '')
                    .trim();
                if (!token) throw new Error('图片参数为空');
                const normalized = token.replace(/\\/g, '/');
                const entries = await listGalleryEntries();
                if (normalized.startsWith('/')) {
                    const direct = entries.find(e => e.path.toLowerCase() === normalized.toLowerCase());
                    if (direct) return direct.path;
                }
                const fileName = normalized.split('/').pop() || normalized;
                const found = entries.find(e => e.name.trim().toLowerCase() === fileName.trim().toLowerCase());
                if (found) return found.path;
                const fuzzy = entries.find(e => e.name.trim().toLowerCase().includes(fileName.trim().toLowerCase()));
                if (fuzzy) return fuzzy.path;
                throw new Error(`相册中未找到图片: ${token}`);
            };

            const loadGalleryDataUrl = async (galleryPath: string): Promise<string> => {
                if (!apiConfig?.galleryWorkspacePath) throw new Error('未配置相册路径');
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                const relPath = galleryPath.replace(/^\/+/, '');
                const base64 = await fsBridge.readFileBase64(apiConfig.galleryWorkspacePath, relPath, allowGlobal);
                const ext = galleryPath.toLowerCase().split('.').pop() || 'jpg';
                const mime =
                    ext === 'png' ? 'image/png' :
                        ext === 'webp' ? 'image/webp' :
                            ext === 'gif' ? 'image/gif' : 'image/jpeg';
                return `data:${mime};base64,${base64}`;
            };

            const resolveGalleryData = async (token: string) => {
                const resolvedPath = await resolveGalleryPath(token);
                const dataUrl = await loadGalleryDataUrl(resolvedPath);
                return { resolvedPath, dataUrl };
            };

            // 头像变更
            const avatarRegex = /\[\[ACTION:CHANGE_AVATAR_FROM_GALLERY\|(\s*agent|\s*user)\|([\s\S]*?)\]\]/gi;
            let avatarMatch;
            while ((avatarMatch = avatarRegex.exec(aiContent)) !== null) {
                const target = avatarMatch[1].trim().toLowerCase();
                const galleryPath = avatarMatch[2].trim();
                if (!galleryPath) continue;
                try {
                    const { resolvedPath, dataUrl } = await resolveGalleryData(galleryPath);
                    if (target === 'agent') {
                        await updateAgent({ avatar: resolvedPath, displayAvatar: dataUrl });
                        await syncAgentSoulFile({ avatar: resolvedPath }, char, apiConfig);
                        relationActions.push({ type: 'agent_avatar_changed', summary: `Agent 从相册更换头像: ${resolvedPath}` });
                    } else {
                        await updateUserProfile({ avatar: resolvedPath, displayAvatar: dataUrl });
                        await syncUserProfileFile({ avatar: resolvedPath }, userProfile, apiConfig);
                        relationActions.push({ type: 'user_avatar_changed', summary: `用户从相册更换头像: ${resolvedPath}` });
                    }
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已从相册完成头像更新]` });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 头像更换失败 ${galleryPath}: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(avatarRegex, '').trim();

            // 双人头像
            const coupleRegex = /\[\[ACTION:CHANGE_COUPLE_AVATAR_FROM_GALLERY\|([\s\S]*?)\|([\s\S]*?)\]\]/gi;
            let coupleMatch;
            while ((coupleMatch = coupleRegex.exec(aiContent)) !== null) {
                const userPath = coupleMatch[1].trim();
                const agentPath = coupleMatch[2].trim();
                if (!userPath || !agentPath) continue;
                try {
                    const [userResolved, agentResolved] = await Promise.all([
                        resolveGalleryData(userPath),
                        resolveGalleryData(agentPath),
                    ]);
                    await updateUserProfile({ avatar: userResolved.resolvedPath, displayAvatar: userResolved.dataUrl });
                    await updateAgent({ avatar: agentResolved.resolvedPath, displayAvatar: agentResolved.dataUrl });
                    await syncUserProfileFile({ avatar: userResolved.resolvedPath }, userProfile, apiConfig);
                    await syncAgentSoulFile({ avatar: agentResolved.resolvedPath }, char, apiConfig);
                    relationActions.push({ type: 'couple_avatar_set', summary: `设置双人头像 user=${userResolved.resolvedPath}, agent=${agentResolved.resolvedPath}` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已设置双人头像]` });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 双人头像设置失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(coupleRegex, '').trim();

            for (const event of relationActions) {
                await DB.saveRelationEvent({ type: event.type, actor: 'agent', summary: event.summary });
            }

            // ── 小红书动作（XHS）──
            const xhsAvailable = !!(xhsEnabled && xhsMcpConfig?.enabled && xhsMcpConfig?.serverUrl);
            const xhsServerUrl = xhsMcpConfig?.serverUrl || '';

            const xhsSearchRegex = /\[\[XHS_SEARCH:\s*([\s\S]*?)\]\]/gi;
            let xhsSearchMatch;
            while ((xhsSearchMatch = xhsSearchRegex.exec(aiContent)) !== null) {
                const keyword = xhsSearchMatch[1].trim();
                if (!keyword) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法搜索「${keyword}」]` });
                    continue;
                }
                try {
                    const result = await XhsMcpClient.search(xhsServerUrl, keyword);
                    const notes = extractNotesFromMcpData(result.data).map(normalizeNote).filter(n => n.noteId).slice(0, 3);
                    if (notes.length === 0) {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书搜索「${keyword}」暂无结果]` });
                    } else {
                        for (const note of notes) {
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书笔记', metadata: { xhsNote: note } });
                        }
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已返回 ${notes.length} 条小红书搜索结果]` });
                    }
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书搜索失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsSearchRegex, '').trim();

            const xhsFeedRegex = /\[\[XHS_(?:FEED|BROWSE)(?::[^\]]*)?\]\]/gi;
            if (xhsFeedRegex.test(aiContent)) {
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法获取推荐流]` });
                } else {
                    try {
                        const result = await XhsMcpClient.getRecommend(xhsServerUrl);
                        const notes = extractNotesFromMcpData(result.data).map(normalizeNote).filter(n => n.noteId).slice(0, 3);
                        if (notes.length === 0) {
                            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书推荐流暂无可展示内容]` });
                        } else {
                            for (const note of notes) {
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书推荐', metadata: { xhsNote: note } });
                            }
                        }
                    } catch (e: any) {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 获取小红书推荐失败: ${e?.message || '未知错误'}]` });
                    }
                }
                aiContent = aiContent.replace(xhsFeedRegex, '').trim();
            }

            const xhsDetailRegex = /\[\[XHS_DETAIL:\s*([\s\S]*?)\]\]/gi;
            let xhsDetailMatch;
            while ((xhsDetailMatch = xhsDetailRegex.exec(aiContent)) !== null) {
                const token = xhsDetailMatch[1].trim();
                if (!token) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法查看详情]` });
                    continue;
                }
                try {
                    const noteUrl = /^https?:\/\//i.test(token) ? token : `https://www.xiaohongshu.com/explore/${token}`;
                    const result = await XhsMcpClient.getNoteDetail(xhsServerUrl, noteUrl);
                    if (result.success && result.data) {
                        const note = normalizeNote(result.data);
                        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书详情', metadata: { xhsNote: note } });
                    } else {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书详情获取失败]` });
                    }
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书详情失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsDetailRegex, '').trim();

            const xhsCommentRegex = /\[\[XHS_COMMENT:\s*([\s\S]*?)\|([\s\S]*?)\]\]/gi;
            let xhsCommentMatch;
            while ((xhsCommentMatch = xhsCommentRegex.exec(aiContent)) !== null) {
                const noteToken = xhsCommentMatch[1].trim();
                const content = xhsCommentMatch[2].trim();
                if (!noteToken || !content) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法评论]` });
                    continue;
                }
                try {
                    const noteUrl = /^https?:\/\//i.test(noteToken) ? noteToken : `https://www.xiaohongshu.com/explore/${noteToken}`;
                    const result = await XhsMcpClient.comment(xhsServerUrl, noteUrl, content);
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: result.success ? `[系统: 小红书评论已发送]` : `[系统: 小红书评论失败: ${result.error || '未知错误'}]`,
                    });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书评论失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsCommentRegex, '').trim();

            const xhsPostRegex = /\[\[XHS_POST:\s*([\s\S]*?)\|([\s\S]*?)\|?([\s\S]*?)\]\]/gi;
            let xhsPostMatch;
            while ((xhsPostMatch = xhsPostRegex.exec(aiContent)) !== null) {
                const title = xhsPostMatch[1].trim();
                const content = xhsPostMatch[2].trim();
                const tagsRaw = (xhsPostMatch[3] || '').trim();
                const tags = tagsRaw ? tagsRaw.split(/[，,]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean) : [];
                if (!title || !content) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法发帖]` });
                    continue;
                }
                try {
                    const result = await XhsMcpClient.publishNote(xhsServerUrl, { title, content, tags });
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: result.success ? `[系统: 小红书笔记发布成功]` : `[系统: 小红书发帖失败: ${result.error || '未知错误'}]`,
                    });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书发帖失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsPostRegex, '').trim();

            // ── ChatParser 动作解析 ──
            const parseResult = await ChatParser.parseAndExecuteActions(aiContent, char, addToast, apiConfig);

            // 语音能量扣除
            const originalWasVoice = /<[语語]音>([\s\S]*?)<\/[语語]音>/i.test(aiContent);
            if (originalWasVoice && !isVoiceCurrentlyActive && proactiveVoiceAllowed) {
                setVoiceEnergy(prev => Math.max(0, prev - 60));
            }

            aiContent = ChatParser.sanitize(parseResult.content);
            const hasToolResult = parseResult.hasToolResult;

            // ── sticker 解析工具 ──
            const resolveStickerByName = (name: string): StickerItem | null => {
                const trimmed = String(name || '').trim();
                if (!trimmed) return null;
                const mapped = stickerNameItemMap.get(trimmed);
                if (mapped) return mapped;
                const found = emojis.find(e => e.name === trimmed);
                if (found?.url) return { name: found.name, url: found.url, category: '自定义' };
                return null;
            };

            // SEND_EMOJI_FROM 解析
            const emojiFromRegex = /\[\[SEND_EMOJI_FROM:\s*([^|\]]+)\|([^\]]+)\]\]/gi;
            if (emojiFromRegex.test(aiContent)) {
                aiContent = aiContent.replace(emojiFromRegex, (_, rawCategory, rawKeyword) => {
                    const preferCategory = String(rawCategory || '').trim();
                    const keyword = String(rawKeyword || '').trim();
                    if (!keyword) return '';
                    const found = StickerParser.searchRelevantStickersWithCategory(
                        stickerSets, keyword, 1, preferCategory || undefined,
                    )[0];
                    if (found?.name) {
                        if (!stickerNameItemMap.has(found.name)) stickerNameItemMap.set(found.name, found);
                        return `[[SEND_EMOJI: ${found.name}]]`;
                    }
                    return '';
                }).trim();
            }

            if (hasToolResult && !aiContent) {
                setMessages(await DB.getMessagesByCharId(char.id));
            }

            ContextEnhancer.trackMentionFromResponse(aiContent);

            // ════════════════════════════════════════
            // 消息输出：分段发送到 UI
            // ════════════════════════════════════════
            if (aiContent) {
                let msgsToUpdate = [];
                const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

                if (hasTranslationTags) {
                    // 双语路径
                    const bilingualEmojis: string[] = [];
                    let bEm;
                    const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                    while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                        const name = bEm[1].trim();
                        if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
                    }
                    aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();

                    const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
                    let lastIndex = 0;
                    let tagMatch;
                    while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                        const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                        if (textBefore && ChatParser.hasDisplayContent(textBefore)) {
                            for (const chunk of ChatParser.chunkText(ChatParser.sanitize(textBefore))) {
                                if (!chunk) continue;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk });
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        }
                        const originalText = ChatParser.sanitize(tagMatch[1].trim());
                        const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                        if (originalText || translatedText) {
                            const biContent = originalText && translatedText
                                ? `${originalText}\n%%BILINGUAL%%\n${translatedText}`
                                : (originalText || translatedText);
                            await new Promise(r => setTimeout(r, Math.min(Math.max(biContent.length * 30, 400), 2000)));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: biContent });
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        }
                        lastIndex = tagMatch.index + tagMatch[0].length;
                    }

                    const textAfter = aiContent.slice(lastIndex).trim();
                    if (textAfter) {
                        const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                        if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                            for (const chunk of ChatParser.chunkText(cleaned)) {
                                if (!chunk) continue;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk });
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        }
                    }

                    for (const emojiName of bilingualEmojis) {
                        const foundEmoji = resolveStickerByName(emojiName);
                        if (foundEmoji?.url) {
                            await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                            await DB.saveMessage({
                                charId: char.id, role: 'assistant', type: 'emoji',
                                content: foundEmoji.url,
                                metadata: { stickerName: foundEmoji.name, stickerCategory: foundEmoji.category } as any,
                            });
                            await DB.saveRelationEvent({
                                type: 'agent_sticker_send', actor: 'agent',
                                summary: `Agent 发送了表情包: ${foundEmoji.name}`,
                                payload: { stickerName: foundEmoji.name, stickerUrl: foundEmoji.url, category: foundEmoji.category },
                            });
                            await DB.recordStickerUsage(foundEmoji.name);
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        }
                    }
                } else {
                    // 普通路径
                    const parts = ChatParser.splitResponse(aiContent);
                    for (const part of parts) {
                        if (part.type === 'emoji') {
                            const foundEmoji = resolveStickerByName(part.content);
                            if (foundEmoji?.url) {
                                await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                                await DB.saveMessage({
                                    charId: char.id, role: 'assistant', type: 'emoji',
                                    content: foundEmoji.url,
                                    metadata: { stickerName: foundEmoji.name, stickerCategory: foundEmoji.category } as any,
                                });
                                await DB.saveRelationEvent({
                                    type: 'agent_sticker_send', actor: 'agent',
                                    summary: `Agent 发送了表情包: ${foundEmoji.name}`,
                                    payload: { stickerName: foundEmoji.name, stickerUrl: foundEmoji.url, category: foundEmoji.category },
                                });
                                await DB.recordStickerUsage(foundEmoji.name);
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        } else if (part.type === 'silent') {
                            await new Promise(r => setTimeout(r, 600));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: part.content });
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        } else {
                            const rawBlocks = part.content.split(/^\s*---\s*$/m).filter(b => b.trim());
                            const allChunks: string[] = [];
                            for (const block of rawBlocks) {
                                allChunks.push(...ChatParser.chunkText(block.trim()));
                            }
                            if (allChunks.length === 0 && part.content.trim()) allChunks.push(part.content.trim());

                            for (const chunk of allChunks) {
                                const delay = char.replySplitInterval && char.replySplitInterval > 50
                                    ? char.replySplitInterval
                                    : Math.min(Math.max(chunk.length * 45, 800), 4000);
                                await new Promise(r => setTimeout(r, delay));

                                if (ChatParser.hasDisplayContent(chunk)) {
                                    const cleanChunk = ChatParser.sanitize(chunk);
                                    if (cleanChunk) {
                                        const isVoiceActive = voiceActiveOverride !== undefined ? voiceActiveOverride : sessionVoiceActive;
                                        let savedAsVoice = false;
                                        if (isVoiceActive && char.chatVoiceEnabled) {
                                            savedAsVoice = await ChatParser.synthesizeAndSaveVoice(cleanChunk, char, apiConfig);
                                        }
                                        if (!savedAsVoice) {
                                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: cleanChunk });
                                        }
                                        msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                        setMessages(msgsToUpdate);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 多轮 concurrency 处理
            const latestMsgs = await DB.getMessagesByCharId(char.id);
            const latestUserMsgs = latestMsgs.filter(m => m.role === 'user' && m.metadata?.source !== 'call');
            const currentUserMsgs = currentMsgs.filter(m => m.role === 'user' && m.metadata?.source !== 'call');
            if (hasToolResult || latestUserMsgs.length > currentUserMsgs.length) {
                setTimeout(() => triggerAI(latestMsgs), 500);
            }
        } catch (e: any) {
            await DB.saveMessage({
                charId: char!.id, role: 'system', type: 'text',
                content: `[连接中断: ${e.message}]`,
            });
            setMessages(await DB.getMessagesByCharId(char!.id));
        } finally {
            setIsTyping(false);
            setRecallStatus('');
        }
    };

    return {
        isTyping,
        recallStatus,
        lastTokenUsage,
        setLastTokenUsage,
        triggerAI,
    };
};