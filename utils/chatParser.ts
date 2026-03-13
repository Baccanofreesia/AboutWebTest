import { DB } from './db';
import { LocalNotifications } from '@capacitor/local-notifications';
import { fsBridge } from './fsBridge';
import { syncWorkspaceFromDisk } from './workspaceSync';
import { fileExt, inferMimeTypeByName } from './chatFiles';
import { synthesizeSpeech } from './ttsService';
import { AgentProfile } from '../types';

const failedImageDownloads: Record<string, number> = {};
const failedVideoDownloads: Record<string, number> = {};

export const ChatParser = {
    /**
     * Helper to synthesize text and save as a voice message to DB.
     * Returns true if successful.
     */
    synthesizeAndSaveVoice: async (text: string, char: AgentProfile, apiConfig: any): Promise<boolean> => {
        if (!text || !char.chatVoiceEnabled || !apiConfig?.ttsProvider || apiConfig?.ttsProvider === 'none') {
            return false;
        }
        try {
            const audioBlob = await synthesizeSpeech(text, char, apiConfig);
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const data = String(reader.result || '');
                    resolve(data.includes(',') ? data.split(',')[1] : data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(audioBlob);
            });

            const fileName = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`;
            const relativeDir = 'voice_cache/agent';
            const relativePath = `${relativeDir}/${fileName}`;

            if (apiConfig.nativeWorkspacePath) {
                try {
                    await fsBridge.createFolder(apiConfig.nativeWorkspacePath, relativeDir, !!apiConfig.securityPolicy?.allowGlobalFileAccess);
                } catch (e) {}
                await fsBridge.writeFileBase64(apiConfig.nativeWorkspacePath, relativePath, base64, !!apiConfig.securityPolicy?.allowGlobalFileAccess);
                
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'voice',
                    content: `workspace://${relativePath}`,
                    metadata: {
                        duration: Math.ceil(text.length / 4) + 1,
                        transcription: text,
                        emotion: (text.match(/[(\uff08\[\u3010]([^\uff09\]\u3011)]+)[)\uff09\]\u3011]/) || [])[1] || '',
                        source: 'agent_tts',
                        generatedAt: Date.now()
                    } as any
                });
                await DB.saveRelationEvent({
                    type: 'agent_voice_send',
                    actor: 'agent',
                    summary: `Agent 发送了语音消息: ${text.slice(0, 20)}${text.length > 20 ? '...' : ''}`,
                    payload: { voicePath: relativePath, transcription: text }
                });
            } else {
                const dataUrl = `data:audio/mpeg;base64,${base64}`;
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'voice',
                    content: dataUrl,
                    metadata: {
                        duration: Math.ceil(text.length / 4) + 1,
                        transcription: text,
                        emotion: (text.match(/[(\uff08\[\u3010]([^\uff09\]\u3011)]+)[)\uff09\]\u3011]/) || [])[1] || '',
                        source: 'agent_tts',
                        generatedAt: Date.now()
                    } as any
                });
                await DB.saveRelationEvent({
                    type: 'agent_voice_send',
                    actor: 'agent',
                    summary: `Agent 发送了语音消息 (Web): ${text.slice(0, 20)}${text.length > 20 ? '...' : ''}`,
                    payload: { transcription: text }
                });
            }
            return true;
        } catch (e: any) {
            console.error("Synthesize and save voice failed:", e);
            return false;
        }
    },

    // Return cleaned content and perform side effects
    parseAndExecuteActions: async (
        aiContent: string,
        char: AgentProfile,
        addToast: (msg: string, type: 'info' | 'success' | 'error') => void,
        apiConfig?: any
    ): Promise<{ content: string; hasToolResult: boolean }> => {
        const charId = char.id;
        const charName = char.nickname || char.name;
        let content = aiContent;
        let hasToolResult = false;
        let hasFileMutation = false;

        // POKE
        if (content.includes('[[ACTION:POKE]]')) {
            await DB.saveMessage({ charId, role: 'assistant', type: 'interaction', content: '[戳一戳]' });
            content = content.replace('[[ACTION:POKE]]', '').trim();
        }

        // TRANSFER
        const transferMatch = content.match(/\[\[ACTION:TRANSFER:(\d+)\]\]/);
        if (transferMatch) {
            await DB.saveMessage({ charId, role: 'assistant', type: 'transfer', content: '[转账]', metadata: { amount: transferMatch[1] } });
            content = content.replace(transferMatch[0], '').trim();
        }

        // ADD_EVENT
        const eventMatch = content.match(/\[\[ACTION:ADD_EVENT\s*\|\s*(.*?)\s*\|\s*(.*?)\]\]/);
        if (eventMatch) {
            const title = eventMatch[1].trim();
            const date = eventMatch[2].trim();
            if (title && date) {
                const anni: any = { id: `anni-${Date.now()}`, title: title, date: date, charId };
                await DB.saveAnniversary(anni);
                addToast(`${charName} 添加了新日程: ${title}`, 'success');
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 新增了日程 "${title}" (${date})]` });
            }
            content = content.replace(eventMatch[0], '').trim();
        }

        // SCHEDULE
        const scheduleRegex = /\[schedule_message \| (.*?) \| fixed \| (.*?)\]/g;
        let match;
        while ((match = scheduleRegex.exec(content)) !== null) {
            const timeStr = match[1].trim();
            const msgContent = match[2].trim();
            const dueTime = new Date(timeStr).getTime();
            if (!isNaN(dueTime) && dueTime > Date.now()) {
                await DB.saveScheduledMessage({ id: `sched-${Date.now()}-${Math.random()}`, charId, content: msgContent, dueAt: dueTime, createdAt: Date.now() });
                try {
                    const hasPerm = await LocalNotifications.checkPermissions();
                    if (hasPerm.display === 'granted') {
                        await LocalNotifications.schedule({ notifications: [{ title: charName, body: msgContent, id: Math.floor(Math.random() * 100000), schedule: { at: new Date(dueTime) }, smallIcon: 'ic_stat_icon_config_sample' }] });
                    }
                } catch (e) { console.log("Notification schedule skipped (web mode)"); }
                addToast(`${charName} 似乎打算一会儿找你...`, 'info');
            }
        }
        content = content.replace(scheduleRegex, '').trim();

        const galleryRootPath = apiConfig?.galleryWorkspacePath?.trim() || '';
        const galleryAllowGlobal = !!apiConfig?.securityPolicy?.allowGlobalFileAccess;
        const workspaceRootPath = apiConfig?.nativeWorkspacePath?.trim() || '';
        const workspaceAllowGlobal = !!apiConfig?.securityPolicy?.allowGlobalFileAccess;

        const toRelPath = (p: string) => p.replace(/^\/+/, '');
        const normalizeProactiveDetail = (raw: string) => String(raw || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 30);
        const ensureProactiveDetail = (raw: string, mediaLabel: '图片' | '视频') => {
            const detail = normalizeProactiveDetail(raw);
            if (!detail || detail.length < 6) throw new Error(`请提供至少6字的${mediaLabel}收藏理由与详情（30字内）`);
            return detail;
        };
        const ensureReflectiveDetail = (detail: string) => {
            const hasUseful = /(有用|帮助|价值|实用|参考|学习|效率|启发|解决)/.test(detail);
            const hasPreference = /(喜欢|偏好|审美|风格|口味|兴趣|爱好|想看)/.test(detail);
            const hasScenario = /(场景|当前|现在|近期|今天|工作|学习|通勤|旅行|聊天|纪念|任务)/.test(detail);
            const score = Number(hasUseful) + Number(hasPreference) + Number(hasScenario);
            if (score < 2) throw new Error('详情需体现至少两项判断：有用性/用户偏好/场景匹配');
        };
        const canProactiveSaveToday = async () => {
            const rows = await DB.getRelationEvents(600).catch(() => []);
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const end = start + 24 * 60 * 60 * 1000;
            const count = rows.filter((e: any) => {
                if (e?.actor !== 'agent' || e?.type !== 'agent_gallery_upload') return false;
                if (typeof e?.timestamp !== 'number' || e.timestamp < start || e.timestamp >= end) return false;
                const action = String(e?.payload?.action || '');
                if (action === 'proactive_save_media') return true;
                const summary = String(e?.summary || '');
                return summary.includes('主动新增图片到相册') || summary.includes('主动新增视频到相册');
            }).length;
            return count < 3;
        };

        const mimeByName = (name: string) => {
            const n = name.toLowerCase();
            if (n.endsWith('.png')) return 'image/png';
            if (n.endsWith('.webp')) return 'image/webp';
            if (n.endsWith('.gif')) return 'image/gif';
            if (n.endsWith('.bmp')) return 'image/bmp';
            if (n.endsWith('.mp4')) return 'video/mp4';
            if (n.endsWith('.mov')) return 'video/quicktime';
            if (n.endsWith('.mkv')) return 'video/x-matroska';
            if (n.endsWith('.webm')) return 'video/webm';
            if (n.endsWith('.avi')) return 'video/x-msvideo';
            if (n.endsWith('.m4v')) return 'video/mp4';
            return 'image/jpeg';
        };

        const isImageName = (name: string) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(name);
        const isVideoName = (name: string) => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(name);
        const isMediaName = (name: string) => isImageName(name) || isVideoName(name);
        let galleryEntriesCache: { name: string; path: string }[] | null = null;

        const listGalleryEntries = async (): Promise<{ name: string; path: string }[]> => {
            if (!galleryRootPath) return [];
            if (galleryEntriesCache) return galleryEntriesCache;
            const rootItems = await fsBridge.readDir(galleryRootPath, '/', galleryAllowGlobal);
            const rootFiles = rootItems
            .filter(i => i.type === 'file' && isMediaName(i.name))
                .map(i => ({ name: i.name, path: `/${i.name}` }));
            const folders = rootItems.filter(i => i.type === 'folder');
            const nested = await Promise.all(folders.map(async f => {
                const dirPath = `/${f.name}/`;
                const items = await fsBridge.readDir(galleryRootPath, dirPath, galleryAllowGlobal);
                return items
                    .filter(i => i.type === 'file' && isMediaName(i.name))
                    .map(i => ({ name: i.name, path: `${dirPath}${i.name}` }));
            }));
            galleryEntriesCache = [...rootFiles, ...nested.flat()];
            return galleryEntriesCache;
        };

        const resolveGalleryPath = async (input: string): Promise<string | null> => {
            const token = String(input || '')
                .replace(/[`"'“”‘’]/g, '')
                .replace(/[，。！？；：,!?;:\)\]\}]+$/g, '')
                .trim();
            if (!token) return null;
            const normalizedInput = token.replace(/\\/g, '/');
            const entries = await listGalleryEntries();
            if (normalizedInput.startsWith('/')) {
                const direct = entries.find(e => e.path.toLowerCase() === normalizedInput.toLowerCase());
                if (direct) return direct.path;
            }
            const fileName = normalizedInput.split('/').pop() || normalizedInput;
            const exact = entries.find(e => e.name.trim().toLowerCase() === fileName.trim().toLowerCase());
            if (exact) return exact.path;
            const fuzzy = entries.find(e => e.name.trim().toLowerCase().includes(fileName.trim().toLowerCase()));
            if (fuzzy) return fuzzy.path;
            return null;
        };

        // GALLERY_SCAN
        if (content.includes('[[ACTION:GALLERY_SCAN]]')) {
            if (galleryRootPath) {
                try {
                    const rootItems = await fsBridge.readDir(galleryRootPath, '/', galleryAllowGlobal);
                    const rootCount = rootItems.filter(i => i.type === 'file' && isMediaName(i.name)).length;
                    const folders = rootItems.filter(i => i.type === 'folder');
                    const folderSummary = [];
                    for (const folder of folders) {
                        const list = await fsBridge.readDir(galleryRootPath, `/${folder.name}/`, galleryAllowGlobal);
                        const count = list.filter(i => i.type === 'file' && isMediaName(i.name)).length;
                        folderSummary.push(`${folder.name}:${count}`);
                    }
                    const summary = `[Tool Result (gallery_scan)]: 根目录=${rootCount} 张; 相册集=${folderSummary.join(', ') || '无'}`;
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: summary });
                    hasToolResult = true;
                } catch (e: any) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (gallery_scan)]: ${e.message}` });
                    hasToolResult = true;
                }
            } else {
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (gallery_scan)]: 未配置相册路径` });
                hasToolResult = true;
            }
            content = content.replace('[[ACTION:GALLERY_SCAN]]', '').trim();
        }

        // SEND_GALLERY_IMAGE
        const sendGalleryRegex = /\[\[ACTION:SEND_GALLERY_IMAGE\|([\s\S]*?)(?:\|([\s\S]*?))?\]\]/gi;
        let sendGalleryMatch;
        while ((sendGalleryMatch = sendGalleryRegex.exec(content)) !== null) {
            const rawToken = (sendGalleryMatch[1] || '').trim();
            const caption = (sendGalleryMatch[2] || '').trim();
            if (!rawToken || !galleryRootPath) continue;
            let resolvedPath = '';
            try {
                const imgPath = await resolveGalleryPath(rawToken);
                if (!imgPath) throw new Error(`相册中未找到媒体: ${rawToken}`);
                resolvedPath = imgPath;
                const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(imgPath), galleryAllowGlobal);
                const dataUrl = `data:${mimeByName(imgPath)};base64,${base64}`;
                await DB.saveMessage({ charId, role: 'assistant', type: isVideoName(imgPath) ? 'video' : 'image', content: dataUrl, metadata: { source: 'agent_gallery', galleryPath: imgPath } as any });
                if (caption) {
                    await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: caption });
                }
                await DB.saveRelationEvent({
                    type: 'agent_gallery_send',
                    actor: 'agent',
                    summary: `Agent 从相册发送了媒体: ${imgPath}`,
                    payload: { galleryPath: imgPath }
                });
                addToast(`${charName} 从相册发来一个媒体`, 'success');
                hasToolResult = true;
            } catch (e: any) {
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (send_gallery_image ${resolvedPath || rawToken})]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(sendGalleryRegex, '').trim();

        const sendFileRegex = /\[\[ACTION:SEND_FILE\|([\s\S]*?)(?:\|([\s\S]*?))?\]\]/gi;
        let sendFileMatch;
        while ((sendFileMatch = sendFileRegex.exec(content)) !== null) {
            const rawPath = (sendFileMatch[1] || '').trim();
            const caption = (sendFileMatch[2] || '').trim();
            if (!rawPath || !workspaceRootPath) continue;
            try {
                const pathWithSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
                const relPath = pathWithSlash.replace(/^\/+/, '');
                const fileName = pathWithSlash.split('/').pop() || 'file';
                const ext = fileExt(fileName);
                const mimeType = inferMimeTypeByName(fileName);
                const parentDir = pathWithSlash.includes('/') ? pathWithSlash.slice(0, pathWithSlash.lastIndexOf('/') + 1) : '/';
                const dirItems = await fsBridge.readDir(workspaceRootPath, parentDir || '/', workspaceAllowGlobal).catch(() => []);
                const fileInfo = dirItems.find((i: any) => i.type === 'file' && i.name === fileName);
                const size = Number(fileInfo?.size || 0);
                let previewText = '';
                if (['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext)) {
                    previewText = (await fsBridge.readFile(workspaceRootPath, relPath, workspaceAllowGlobal)).slice(0, 3000);
                }
                await fsBridge.readFileBase64(workspaceRootPath, relPath, workspaceAllowGlobal);
                await DB.saveMessage({
                    charId,
                    role: 'assistant',
                    type: 'file',
                    content: `[文件] ${fileName}`,
                    metadata: {
                        source: 'agent_workspace',
                        fileName,
                        mimeType,
                        size,
                        workspacePath: pathWithSlash,
                        category: mimeType.startsWith('audio/') ? 'audio' : (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) ? 'archives' : 'documents'),
                        previewText
                    } as any
                });
                if (caption) await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: caption });
                await DB.saveRelationEvent({
                    type: 'agent_file_send',
                    actor: 'agent',
                    summary: `Agent 发送了文件: ${pathWithSlash}`,
                    payload: { workspacePath: pathWithSlash }
                });
                addToast(`${charName} 发来一个文件`, 'success');
                hasToolResult = true;
            } catch (e: any) {
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (send_file ${rawPath})]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(sendFileRegex, '').trim();

        // DELETE_GALLERY_IMAGE
        const deleteGalleryRegex = /\[\[ACTION:DELETE_GALLERY_IMAGE\|([\s\S]*?)\]\]/gi;
        let deleteGalleryMatch;
        while ((deleteGalleryMatch = deleteGalleryRegex.exec(content)) !== null) {
            const rawToken = (deleteGalleryMatch[1] || '').trim();
            if (!rawToken || !galleryRootPath) continue;
            try {
                const imgPath = await resolveGalleryPath(rawToken);
                if (!imgPath) throw new Error(`相册中未找到图片: ${rawToken}`);
                await fsBridge.deleteFile(galleryRootPath, toRelPath(imgPath), galleryAllowGlobal);
                await DB.saveRelationEvent({
                    type: 'agent_gallery_upload',
                    actor: 'agent',
                    summary: `Agent 从相册删除了图片: ${imgPath}`,
                    payload: { galleryPath: imgPath, action: 'delete' }
                });
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 已删除相册图片 ${imgPath}]` });
                galleryEntriesCache = null;
                hasToolResult = true;
            } catch (e: any) {
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (delete_gallery_image ${rawToken})]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(deleteGalleryRegex, '').trim();

        // MOVE_GALLERY_IMAGE
        const moveGalleryRegex = /\[\[ACTION:MOVE_GALLERY_IMAGE\|([\s\S]*?)\|([\s\S]*?)\]\]/gi;
        let moveGalleryMatch;
        while ((moveGalleryMatch = moveGalleryRegex.exec(content)) !== null) {
            const rawToken = (moveGalleryMatch[1] || '').trim();
            const targetAlbumRaw = (moveGalleryMatch[2] || '').trim();
            if (!rawToken || !galleryRootPath) continue;
            try {
                const srcPath = await resolveGalleryPath(rawToken);
                if (!srcPath) throw new Error(`相册中未找到图片: ${rawToken}`);
                const srcName = srcPath.split('/').pop() || rawToken;
                const targetAlbum = targetAlbumRaw && targetAlbumRaw !== 'root' ? targetAlbumRaw.replace(/^\/+|\/+$/g, '') : '';
                const destPath = targetAlbum ? `/${targetAlbum}/${srcName}` : `/${srcName}`;
                const existsTarget = await resolveGalleryPath(destPath);
                const finalDestPath = existsTarget
                    ? (targetAlbum
                        ? `/${targetAlbum}/${Date.now()}_${srcName}`
                        : `/${Date.now()}_${srcName}`)
                    : destPath;
                await fsBridge.renameFile(galleryRootPath, toRelPath(srcPath), toRelPath(finalDestPath), galleryAllowGlobal);
                await DB.saveRelationEvent({
                    type: 'agent_gallery_upload',
                    actor: 'agent',
                    summary: `Agent 移动相册图片: ${srcPath} -> ${finalDestPath}`,
                    payload: { from: srcPath, to: finalDestPath, action: 'move' }
                });
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 已移动相册图片到 ${finalDestPath}]` });
                galleryEntriesCache = null;
                hasToolResult = true;
            } catch (e: any) {
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (move_gallery_image ${rawToken})]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(moveGalleryRegex, '').trim();

        // SAVE_IMAGE_FROM_URL
        const saveFromUrlRegex = /\[\[ACTION:SAVE_IMAGE_FROM_URL\|([\s\S]*?)\|([\s\S]*?)\|([\s\S]*?)\]\]/gi;
        let saveFromUrlMatch;
        while ((saveFromUrlMatch = saveFromUrlRegex.exec(content)) !== null) {
            const imageUrl = (saveFromUrlMatch[1] || '').trim();
            const fileNameRaw = (saveFromUrlMatch[2] || '').trim();
            if (!imageUrl || !fileNameRaw || !galleryRootPath) continue;
            const now = Date.now();
            const lastFail = failedImageDownloads[imageUrl] || 0;
            if (lastFail > 0 && now - lastFail < 10 * 60 * 1000) {
                continue;
            }
            const safeName = fileNameRaw.replace(/[\\/:*?"<>|]/g, '_');
            try {
                const detail = ensureProactiveDetail(saveFromUrlMatch[3] || '', '图片');
                ensureReflectiveDetail(detail);
                const canSave = await canProactiveSaveToday();
                if (!canSave) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Result (save_image_from_url)]: 今日主动收藏已达上限（3），请明天再尝试。` });
                    hasToolResult = true;
                    continue;
                }
                const existingPath = await resolveGalleryPath(safeName);
                if (existingPath) {
                    await DB.saveMessage({
                        charId,
                        role: 'system',
                        type: 'text',
                        content: `[Tool Result (save_image_from_url)]: 已存在同名图片，跳过下载 (${safeName})`
                    });
                    hasToolResult = true;
                    continue;
                }
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error(`下载失败 ${response.status}`);
                const blob = await response.blob();
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const data = String(reader.result || '');
                        const value = data.includes(',') ? data.split(',')[1] : data;
                        if (!value) reject(new Error('编码失败'));
                        else resolve(value);
                    };
                    reader.onerror = () => reject(new Error('读取失败'));
                    reader.readAsDataURL(blob);
                });

                const targetPath = `/${safeName}`;
                await fsBridge.writeFileBase64(galleryRootPath, toRelPath(targetPath), base64, galleryAllowGlobal);
                galleryEntriesCache = null;
                if (detail) {
                    await DB.saveImageDetail({
                        fileName: safeName,
                        detail,
                        source: 'agent',
                        relatedPath: targetPath
                    });
                }
                await DB.saveRelationEvent({
                    type: 'agent_gallery_upload',
                    actor: 'agent',
                    summary: `Agent 主动新增图片到相册: ${safeName}`,
                    payload: { imageUrl, fileName: safeName, detail, mediaType: 'image', action: 'proactive_save_media' }
                });
                await DB.saveMessage({
                    charId,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${charName} 主动收藏了一张图片到相册（${safeName}）]`
                });
                addToast(`${charName} 新增了一张相册图片`, 'info');
                hasToolResult = true;
            } catch (e: any) {
                failedImageDownloads[imageUrl] = Date.now();
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (save_image_from_url)]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(saveFromUrlRegex, '').trim();

        // SAVE_VIDEO_FROM_URL
        const saveVideoFromUrlRegex = /\[\[ACTION:SAVE_VIDEO_FROM_URL\|([\s\S]*?)\|([\s\S]*?)\|([\s\S]*?)\]\]/gi;
        let saveVideoFromUrlMatch;
        while ((saveVideoFromUrlMatch = saveVideoFromUrlRegex.exec(content)) !== null) {
            const videoUrl = (saveVideoFromUrlMatch[1] || '').trim();
            const fileNameRaw = (saveVideoFromUrlMatch[2] || '').trim();
            if (!videoUrl || !fileNameRaw || !galleryRootPath) continue;
            const now = Date.now();
            const lastFail = failedVideoDownloads[videoUrl] || 0;
            if (lastFail > 0 && now - lastFail < 10 * 60 * 1000) {
                continue;
            }
            let safeName = fileNameRaw.replace(/[\\/:*?"<>|]/g, '_');
            if (!isVideoName(safeName)) safeName += '.mp4';
            try {
                const detail = ensureProactiveDetail(saveVideoFromUrlMatch[3] || '', '视频');
                ensureReflectiveDetail(detail);
                const canSave = await canProactiveSaveToday();
                if (!canSave) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Result (save_video_from_url)]: 今日主动收藏已达上限（3），请明天再尝试。` });
                    hasToolResult = true;
                    continue;
                }
                const existingPath = await resolveGalleryPath(safeName);
                if (existingPath) {
                    await DB.saveMessage({
                        charId,
                        role: 'system',
                        type: 'text',
                        content: `[Tool Result (save_video_from_url)]: 已存在同名视频，跳过下载 (${safeName})`
                    });
                    hasToolResult = true;
                    continue;
                }
                const response = await fetch(videoUrl);
                if (!response.ok) throw new Error(`下载失败 ${response.status}`);
                const blob = await response.blob();
                if (!String(blob.type || '').toLowerCase().startsWith('video/')) throw new Error('URL内容不是视频');
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const data = String(reader.result || '');
                        const value = data.includes(',') ? data.split(',')[1] : data;
                        if (!value) reject(new Error('编码失败'));
                        else resolve(value);
                    };
                    reader.onerror = () => reject(new Error('读取失败'));
                    reader.readAsDataURL(blob);
                });
                const targetPath = `/${safeName}`;
                await fsBridge.writeFileBase64(galleryRootPath, toRelPath(targetPath), base64, galleryAllowGlobal);
                galleryEntriesCache = null;
                await DB.saveImageDetail({
                    fileName: safeName,
                    detail,
                    source: 'agent',
                    relatedPath: targetPath
                });
                await DB.saveRelationEvent({
                    type: 'agent_gallery_upload',
                    actor: 'agent',
                    summary: `Agent 主动新增视频到相册: ${safeName}`,
                    payload: { videoUrl, fileName: safeName, detail, mediaType: 'video', action: 'proactive_save_media' }
                });
                await DB.saveMessage({
                    charId,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${charName} 主动收藏了一个视频到相册（${safeName}）]`
                });
                addToast(`${charName} 新增了一个相册视频`, 'info');
                hasToolResult = true;
            } catch (e: any) {
                failedVideoDownloads[videoUrl] = Date.now();
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (save_video_from_url)]: ${e.message}` });
                hasToolResult = true;
            }
        }
        content = content.replace(saveVideoFromUrlRegex, '').trim();

        // <create_app name="AppName">
        const createAppRegex = /<create_app\s+name="([^"]+)">([\s\S]*?)<\/create_app>/gi;
        let appMatch;
        while ((appMatch = createAppRegex.exec(content)) !== null) {
            const appName = appMatch[1].trim();
            const fileContent = appMatch[2].trim();

            if (appName && fileContent) {
                const now = Date.now();
                const fileName = `@agent_apps/${appName.replace(/[^a-zA-Z0-9_-]/g, '')}.tsx`;
                const newFile: any = {
                    id: `ws-${now}-${Math.random().toString(36).slice(2, 6)}`,
                    name: fileName,
                    path: '/',
                    type: 'file',
                    content: fileContent,
                    size: fileContent.length,
                    createdAt: now,
                    updatedAt: now,
                };

                await DB.saveWorkspaceFile(newFile);

                if (apiConfig && apiConfig.nativeWorkspacePath) {
                    try {
                        const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                        await fsBridge.writeFile(apiConfig.nativeWorkspacePath, fileName, fileContent, allowGlobal);
                    } catch (e) {
                        console.error("Failed to write physical app file via Agent", e);
                    }
                }

                // Send an event to the global scope to reload the page softly for Vite glob to pick up the new app file
                addToast(`${charName} 开发了新应用: ${appName} 📦 (即将刷新应用以挂载)`, 'success');
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 将应用 ${appName} 部署到了桌面]` });
                hasToolResult = true;

                // Fire an event that OSContext or PhoneShell can listen to and soft-reload the app smoothly
                setTimeout(() => {
                    window.dispatchEvent(new Event('agent_app_deployed'));
                }, 1500);
            }
        }
        content = content.replace(createAppRegex, '').trim();

        // <fs_write target="fileName">
        const fsWriteRegex = /<fs_write\s+target="([^"]+)">([\s\S]*?)<\/fs_write>/gi;
        let fsMatch;
        while ((fsMatch = fsWriteRegex.exec(content)) !== null) {
            const fileName = fsMatch[1].trim();
            const fileContent = fsMatch[2].trim();

            if (fileName && fileContent) {
                const now = Date.now();
                const newFile: any = {
                    id: `ws-${now}-${Math.random().toString(36).slice(2, 6)}`,
                    name: fileName,
                    path: '/',
                    type: 'file',
                    content: fileContent,
                    size: fileContent.length,
                    createdAt: now,
                    updatedAt: now,
                };

                // Save to DB
                await DB.saveWorkspaceFile(newFile);

                // Sync to Physical Workspace
                if (apiConfig && apiConfig.nativeWorkspacePath) {
                    try {
                        const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                        await fsBridge.writeFile(apiConfig.nativeWorkspacePath, fileName, fileContent, allowGlobal);
                        // don't toast too much to avoid interrupting flow
                    } catch (e) {
                        console.error("Failed to write physical file via Agent", e);
                    }
                }

                addToast(`${charName} 写入了文件: ${fileName}`, 'success');
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 创建/修改了文件 ${fileName}]` });
                hasToolResult = true;
            }
        }
        content = content.replace(fsWriteRegex, '').trim();

        // <fs_ls dir="dirName">
        const fsLsRegex = /<fs_ls\s+dir="([^"]+)"\s*\/>/gi;
        let lsMatch;
        while ((lsMatch = fsLsRegex.exec(content)) !== null) {
            const dirName = lsMatch[1].trim();
            if (dirName && apiConfig && apiConfig.nativeWorkspacePath) {
                try {
                    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                    const items = await fsBridge.readDir(apiConfig.nativeWorkspacePath, dirName, allowGlobal);
                    const itemStr = items.map((i: any) => `- ${i.type === 'folder' ? '[DIR]' : '[FILE]'} ${i.name}`).join('\n');
                    const msg = `[Tool Result (fs_ls ${dirName})]:\n${itemStr || 'Empty directory'}`;
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: msg });
                    hasToolResult = true;
                } catch (e: any) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (fs_ls ${dirName})]: ${e.message}` });
                    hasToolResult = true;
                }
            }
        }
        content = content.replace(fsLsRegex, '').trim();

        // <fs_read file="fileName">
        const fsReadRegex = /<fs_read\s+file="([^"]+)"\s*\/>/gi;
        let readMatch;
        while ((readMatch = fsReadRegex.exec(content)) !== null) {
            const fileName = readMatch[1].trim();
            if (fileName && apiConfig && apiConfig.nativeWorkspacePath) {
                try {
                    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                    const fileContent = await fsBridge.readFile(apiConfig.nativeWorkspacePath, fileName, allowGlobal);
                    const msg = `[Tool Result (fs_read ${fileName})]:\n${fileContent || 'Empty file'}`;
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: msg });
                    hasToolResult = true;
                } catch (e: any) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (fs_read ${fileName})]: ${e.message}` });
                    hasToolResult = true;
                }
            }
        }
        content = content.replace(fsReadRegex, '').trim();

        // <fs_delete file="fileName">
        const fsDeleteRegex = /<fs_delete\s+file="([^"]+)"\s*\/>/gi;
        let deleteMatch;
        while ((deleteMatch = fsDeleteRegex.exec(content)) !== null) {
            const fileName = deleteMatch[1].trim();
            if (fileName && apiConfig && apiConfig.nativeWorkspacePath) {
                try {
                    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                    await fsBridge.deleteFile(apiConfig.nativeWorkspacePath, fileName, allowGlobal);
                    const msg = `[Tool Result (fs_delete ${fileName})]: Success`;
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: msg });
                    hasToolResult = true;
                    hasFileMutation = true;
                } catch (e: any) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (fs_delete ${fileName})]: ${e.message}` });
                    hasToolResult = true;
                }
            }
        }
        content = content.replace(fsDeleteRegex, '').trim();

        // <fs_execute file="fileName">
        const fsExecuteRegex = /<fs_execute\s+file="([^"]+)"\s*\/>/gi;
        let executeMatch;
        while ((executeMatch = fsExecuteRegex.exec(content)) !== null) {
            const fileName = executeMatch[1].trim();
            if (fileName && apiConfig && apiConfig.nativeWorkspacePath) {
                try {
                    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                    const { stdout, stderr } = await fsBridge.executeFile(apiConfig.nativeWorkspacePath, fileName, allowGlobal);
                    let resultStr = '';
                    if (stdout) resultStr += `STDOUT:\n${stdout}\n`;
                    if (stderr) resultStr += `STDERR:\n${stderr}\n`;
                    if (!resultStr) resultStr = 'Executed successfully with no output.';

                    const msg = `[Tool Result (fs_execute ${fileName})]:\n${resultStr.trim()}`;
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: msg });
                    hasToolResult = true;
                    hasFileMutation = true;
                } catch (e: any) {
                    await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[Tool Error (fs_execute ${fileName})]: ${e.message}` });
                    hasToolResult = true;
                }
            }
        }
        content = content.replace(fsExecuteRegex, '').trim();

        // RECALL tag removal (handling done in main loop logic, but cleaning here just in case)
        content = content.replace(/\[\[RECALL:.*?\]\]/g, '').trim();

        // <语音> tag handling
        // Voice must be natural language only; strip stickers/URLs/tags from voice content.
        const voiceRegex = /<[语語]音>([\s\S]*?)<\/[语語]音>/gi;
        let voiceMatch;
        let lastVoiceIndex = 0;
        let rebuiltContent = '';
        while ((voiceMatch = voiceRegex.exec(content)) !== null) {
            const rawVoiceText = (voiceMatch[1] || '').trim();
            // keep content outside voice tags
            rebuiltContent += content.slice(lastVoiceIndex, voiceMatch.index);

            if (rawVoiceText) {
                const parts = ChatParser.splitResponse(rawVoiceText);
                const naturalParts: string[] = [];
                const nonNaturalTokens: string[] = [];

                for (const part of parts) {
                    if (part.type === 'text') {
                        const t = part.content.trim();
                        if (t) naturalParts.push(t);
                    } else if (part.type === 'emoji') {
                        const name = part.content.trim();
                        if (name) nonNaturalTokens.push(`[[SEND_EMOJI: ${name}]]`);
                    } else if (part.type === 'silent') {
                        const t = part.content.trim();
                        if (t) nonNaturalTokens.push(t);
                    }
                }

                const voiceTextRaw = naturalParts.join(' ').replace(/\s{2,}/g, ' ').trim();
                const voiceText = voiceTextRaw
                    .replace(/^\s*(?:\[\s*)?(?:你|用户|User|Assistant)\s*发送了语音消息\s*\d+(?:\.\d+)?\s*秒(?:\s*,\s*无法转写)?\s*(?:\]\s*)?[:：]?\s*/i, '')
                    .replace(/\[\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds|毫秒|秒)\s*\]\s*/gi, '')
                    .trim();
                if (voiceText) {
                    const success = await ChatParser.synthesizeAndSaveVoice(voiceText, char, apiConfig);
                    if (success) hasToolResult = true;
                }

                if (nonNaturalTokens.length > 0) {
                    if (rebuiltContent && !rebuiltContent.endsWith(' ')) rebuiltContent += ' ';
                    rebuiltContent += nonNaturalTokens.join(' ') + ' ';
                }
            }

            lastVoiceIndex = voiceRegex.lastIndex;
        }
        if (lastVoiceIndex > 0) {
            rebuiltContent += content.slice(lastVoiceIndex);
            content = rebuiltContent.trim();
        }

        if (hasFileMutation && apiConfig) {
            try {
                await syncWorkspaceFromDisk(apiConfig);
            } catch (err) {
                console.error("Failed to sync workspace after file mutation:", err);
            }
        }

        return { content, hasToolResult };
    },

    /**
     * Comprehensive sanitizer for AI output before saving to DB.
     * Removes AI-specific artifacts that should never appear in chat bubbles.
     * Safe to call multiple times (idempotent). Preserves %%BILINGUAL%% markers.
     */
    sanitize: (text: string): string => {
        return text
            // Strip leaked timestamps from chat history context:
            // [2026-02-11 13:52] / [2026/2/11 13:52] / [2026.02.11 13:52] (bracketed)
            .replace(/\[\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*/g, '')
            .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*/g, '')
            // Strip simulated thinking time markers like [1s], [2.5s], [300ms]
            .replace(/\[\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds|毫秒|秒)\s*\]\s*/gi, '')
            // 2026-02-11 13:52 format (unbracketed, at line start)
            .replace(/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*/gm, '')
            .replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, '')
            // （下午1:52）or（上午10:30）Chinese 12h parenthetical
            .replace(/（[上下]午\d{1,2}[：:]\d{2}）/g, '')
            // (1:52 PM) or (10:30 AM) English 12h parenthetical
            .replace(/\(\d{1,2}:\d{2}\s*[AP]M\)/gi, '')
            // Strip markdown headers (# ## ### etc) → keep the text
            .replace(/^#{1,6}\s+/gm, '')
            // Strip residual action/system tags that weren't caught earlier
            .replace(/<fs_write\s+target="[^"]+">[\s\S]*?<\/fs_write>/gi, '')
            .replace(/<fs_(?:ls|read|delete|execute)\s+(?:dir|file)="[^"]+"\s*\/>/gi, '')
            .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END)[:\s][\s\S]*?\]\]/g, '')
            .replace(/\[schedule_message[^\]]*\]/g, '')
            .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
            .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
            .replace(/\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g, '')
            .replace(/<[回回复]+:\d+>/g, '')
            .replace(/\[引用:\d+\]/gi, '')
            // Strip backtick-wrapped action tags and empty backtick pairs
            .replace(/`(\[\[[\s\S]*?\]\])`/g, '$1')
            .replace(/``+/g, '')
            .replace(/(^|\s)`(\s|$)/gm, '$1$2')
            // Strip markdown links → keep text only: [text](url) → text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Strip all ** sequences (orphaned bold markers are common AI artifacts;
            // in chat context, losing bold formatting is acceptable for clean display)
            .replace(/\*{2,}/g, '')
            // Strip standalone separators and bullets
            .replace(/^\s*---\s*$/gm, '')
            .replace(/^\s*[-*+]\s*$/gm, '')
            // Strip legacy translation marker (but keep %%BILINGUAL%% and <翻译> XML tags)
            .replace(/%%TRANS%%[\s\S]*/gi, '')
            // Collapse excessive whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    /**
     * Check if text has meaningful display content after stripping all markers/junk.
     * Used to decide whether a chunk is worth saving as a message.
     */
    hasDisplayContent: (text: string): boolean => {
        const stripped = text
            .replace(/%%BILINGUAL%%/gi, '')
            .replace(/%%TRANS%%[\s\S]*/gi, '')
            .replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '')
            .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*/g, '')
            .replace(/\[\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds|毫秒|秒)\s*\]\s*/gi, '')
            .replace(/^\s*---\s*$/gm, '')
            .replace(/``+/g, '')
            .replace(/(^|\s)`(\s|$)/gm, '$1$2')
            .replace(/<fs_write\s+target="[^"]+">[\s\S]*?<\/fs_write>/gi, '')
            .replace(/<fs_(?:ls|read|delete|execute)\s+(?:dir|file)="[^"]+"\s*\/>/gi, '')
            .replace(/\[\[[\s\S]*?\]\]/g, '')
            .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
            .replace(/\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g, '')
            .replace(/<[回回复]+:\d+>/g, '')
            .replace(/\[引用:\d+\]/gi, '')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[-*+]\s*$/gm, '')
            // Strip single punctuation marks (result of aggressive splitting)
            .replace(/^[。！？.!?]+$/g, '')
            .trim();
        return stripped.length > 0;
    },

    // Split text into bubbles (text and non-natural language like emojis/urls)
    splitResponse: (content: string): { type: 'text' | 'emoji' | 'silent', content: string }[] => {
        // Combined pattern for:
        // 1. Stickers: [[SEND_EMOJI: Name]]
        // 2. URLs: http://... or https://...
        // 3. File tags: [[FILE: ...]] or [[ACTION: ...]] (if we want them separated)
        const pattern = /(\[\[SEND_EMOJI:\s*(.*?)\]\])|(https?:\/\/[^\s]+)|(\[\[(?:FILE|ACTION|SEND_EMOJI_FROM):.*?\]\])/gi;
        const parts: { type: 'text' | 'emoji' | 'silent', content: string }[] = [];
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            if (match.index > lastIndex) {
                const textBefore = content.slice(lastIndex, match.index).trim();
                if (textBefore) parts.push({ type: 'text', content: textBefore });
            }

            if (match[1]) {
                // Sticker
                parts.push({ type: 'emoji', content: match[2].trim() });
            } else if (match[3]) {
                // URL
                parts.push({ type: 'silent', content: match[3].trim() });
            } else {
                // Other tags
                parts.push({ type: 'silent', content: match[0].trim() });
            }
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < content.length) {
            const remaining = content.slice(lastIndex).trim();
            if (remaining) parts.push({ type: 'text', content: remaining });
        }

        if (parts.length === 0 && content.trim()) parts.push({ type: 'text', content: content.trim() });
        return parts;
    },

    // Chunking text for typing effect - splits into separate chat bubbles
    // Primary: split on line breaks (AI decides where to break)
    // Secondary: split on Chinese punctuation if text is long (force bubble split)
    chunkText: (text: string): string[] => {
        // Normalize literal \n strings to actual newlines (defensive fix for LLM being too literal)
        const normalizedText = text.replace(/\\n/g, '\n');

        // 1. Try line breaks first
        let chunks = normalizedText.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
            .map(c => c.trim())
            .filter(c => c.length > 0);

        // 2. If single chunk is too long (>30 chars) and has Chinese punctuation, split it
        if (chunks.length === 1 && chunks[0].length > 30) {
            const raw = chunks[0];
            // Split by 。！？ but keep the delimiter
            // Regex: Split after 。！？
            const splitByPunct = raw.replace(/([。！？])\s*/g, '$1\n').split('\n').map(c => c.trim()).filter(c => c);
            if (splitByPunct.length > 1) {
                chunks = splitByPunct;
            }
        }

        // 3. Fallback: no line breaks found and text is still long enough
        // Split on spaces that sit between CJK characters/punctuation (中文里不该有空格)
        if (chunks.length <= 1 && text.trim().length > 50) {
            // Match a CJK char/punct, then space(s), then CJK char
            // Split AFTER the first CJK char + space boundary using lookbehind/lookahead
            chunks = text.split(/(?<=[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2000-\u206f\u2e80-\u2eff\u3001-\u3003\u2018-\u201f\u300a-\u300f\uff01-\uff0f\uff1a-\uff20])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf])/)
                .map(c => c.trim())
                .filter(c => c.length > 0);
        }

        return chunks;
    }
}
