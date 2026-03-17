
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { processImage } from '../utils/file';
import { DB } from '../utils/db';
import { fsBridge } from '../utils/fsBridge';
import { AgentSoulData, buildAgentSoulMarkdown, buildUserMarkdownFromProfile, parseAgentSoulMarkdown, parseUserProfileMarkdown } from '../utils/profileFiles';
import { workspaceFileExists } from '../utils/onboarding';
import Modal from '../components/os/Modal';
import { VoiceDesigner } from '../components/os/VoiceDesigner';

type AvatarTarget = 'user' | 'agent';
type PickerPhoto = {
    name: string;
    path: string;
    album: string;
    updatedAt: number;
};
type PendingAvatarUpload = {
    target: AvatarTarget;
    safeName: string;
    dataUrl: string;
    detail: string;
};

const UserApp: React.FC = () => {
    const { closeApp, userProfile, updateUserProfile, agent, updateAgent, addToast, apiConfig } = useOS();
    const [activeTab, setActiveTab] = useState<'user' | 'agent'>('user');
    const [userNicknameInput, setUserNicknameInput] = useState(userProfile.nickname || '');
    const [userNameInput, setUserNameInput] = useState(userProfile.name || '');
    const [userBioInput, setUserBioInput] = useState(userProfile.bio || '');
    const [preferredNamesInput, setPreferredNamesInput] = useState<string[]>(userProfile.preferredNames || []);
    const [agentNicknameInput, setAgentNicknameInput] = useState(agent?.nickname || '');
    const [showVoiceDesigner, setShowVoiceDesigner] = useState(false);
    const [showAvatarPicker, setShowAvatarPicker] = useState(false);
    const [avatarPickerTarget, setAvatarPickerTarget] = useState<AvatarTarget>('user');
    const [pickerPhotos, setPickerPhotos] = useState<PickerPhoto[]>([]);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerSelectedPath, setPickerSelectedPath] = useState('');
    const [pickerPreviewMap, setPickerPreviewMap] = useState<Record<string, string>>({});
    const [pendingUpload, setPendingUpload] = useState<PendingAvatarUpload | null>(null);
    const [userProfileFileExists, setUserProfileFileExists] = useState<boolean | null>(null);
    const userMdUpdatedAtRef = useRef(0);
    const userFileRef = useRef<HTMLInputElement>(null);
    const agentFileRef = useRef<HTMLInputElement>(null);
    const galleryRootPath = apiConfig.galleryWorkspacePath?.trim() || '';
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;

    const extOf = (name: string) => {
        const idx = name.lastIndexOf('.');
        return idx >= 0 ? name.slice(idx).toLowerCase() : '';
    };
    const isImageName = (name: string) => ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extOf(name));
    const mimeByName = (name: string) => {
        const ext = extOf(name);
        if (ext === '.png') return 'image/png';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        if (ext === '.bmp') return 'image/bmp';
        return 'image/jpeg';
    };
    const toRelPath = (p: string) => p.replace(/^\/+/, '');
    const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');

    useEffect(() => {
        setUserNicknameInput(userProfile.nickname || '');
    }, [userProfile.nickname]);

    useEffect(() => {
        setUserNameInput(userProfile.name || '');
        setUserBioInput(userProfile.bio || '');
        setPreferredNamesInput(userProfile.preferredNames || []);
    }, [userProfile.name, userProfile.bio, userProfile.preferredNames]);

    useEffect(() => {
        setAgentNicknameInput(agent?.nickname || '');
    }, [agent?.nickname]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!apiConfig.nativeWorkspacePath) {
                if (!cancelled) setUserProfileFileExists(false);
                return;
            }
            const exists = await workspaceFileExists(apiConfig.nativeWorkspacePath, 'USER.md', allowGlobal);
            if (!cancelled) setUserProfileFileExists(exists);
        };
        run();
        return () => { cancelled = true; };
    }, [apiConfig.nativeWorkspacePath, allowGlobal]);

    const isUserFormDirty = useCallback(() => {
        const norm = (v?: string) => (v || '').trim();
        return (
            norm(userNameInput) !== norm(userProfile.name) ||
            norm(userNicknameInput) !== norm(userProfile.nickname) ||
            norm(userBioInput) !== norm(userProfile.bio) ||
            JSON.stringify(preferredNamesInput) !== JSON.stringify(userProfile.preferredNames || [])
        );
    }, [userBioInput, userNameInput, userNicknameInput, userProfile.bio, userProfile.name, userProfile.nickname, preferredNamesInput, userProfile.preferredNames]);

    // Local USER.md polling removed - handled by OSContext

    const writeUserProfileFile = useCallback(async (updates: Partial<{ name: string; nickname: string; preferredNames: string[]; avatar: string; bio: string }>) => {
        if (!apiConfig.nativeWorkspacePath) return false;
        const content = buildUserMarkdownFromProfile({
            name: updates.name ?? userProfile.name ?? 'User',
            nickname: updates.nickname ?? userProfile.nickname,
            preferredNames: updates.preferredNames ?? userProfile.preferredNames ?? [],
            avatar: updates.avatar ?? userProfile.avatar,
            bio: updates.bio ?? userProfile.bio
        });
        await fsBridge.writeFile(apiConfig.nativeWorkspacePath, 'USER.md', content, allowGlobal);
        setUserProfileFileExists(true);
        return true;
    }, [allowGlobal, apiConfig.nativeWorkspacePath, userProfile.avatar, userProfile.bio, userProfile.name, userProfile.nickname, userProfile.preferredNames]);

    const writeAgentSoulFile = useCallback(async (updates: Partial<AgentSoulData>) => {
        if (!apiConfig.nativeWorkspacePath || !agent) return false;
        const root = apiConfig.nativeWorkspacePath;
        let base: AgentSoulData = {
            name: agent.name || 'Agent',
            nickname: agent.nickname,
            avatar: agent.avatar,
            persona: agent.description
        };
        try {
            const content = await fsBridge.readFile(root, 'Agent_Soul.md', allowGlobal);
            const parsed = parseAgentSoulMarkdown(content);
            if (parsed) base = { ...base, ...parsed };
        } catch { }
        const next: AgentSoulData = { ...base, ...updates, name: updates.name || base.name || 'Agent' };
        await fsBridge.writeFile(root, 'Agent_Soul.md', buildAgentSoulMarkdown(next), allowGlobal);
        return true;
    }, [agent, allowGlobal, apiConfig.nativeWorkspacePath]);

    const collectGalleryPhotos = useCallback(async (): Promise<PickerPhoto[]> => {
        if (!galleryRootPath) return [];
        const rootItems = await fsBridge.readDir(galleryRootPath, '/', allowGlobal);
        const rootFiles = rootItems
            .filter(i => i.type === 'file' && isImageName(i.name))
            .map(i => ({ name: i.name, path: `/${i.name}`, album: '最近项目', updatedAt: i.updatedAt || Date.now() }));
        const folders = rootItems.filter(i => i.type === 'folder');
        const nested = await Promise.all(folders.map(async f => {
            const dirPath = `/${f.name}/`;
            const items = await fsBridge.readDir(galleryRootPath, dirPath, allowGlobal);
            return items
                .filter(i => i.type === 'file' && isImageName(i.name))
                .map(i => ({ name: i.name, path: `${dirPath}${i.name}`, album: f.name, updatedAt: i.updatedAt || Date.now() }));
        }));
        return [...rootFiles, ...nested.flat()].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allowGlobal, galleryRootPath]);

    const loadPicker = useCallback(async () => {
        setPickerSelectedPath('');
        setPickerPreviewMap({});
        if (!galleryRootPath) {
            setPickerPhotos([]);
            return;
        }
        setPickerLoading(true);
        try {
            setPickerPhotos(await collectGalleryPhotos());
        } catch (e: any) {
            addToast(`读取相册失败: ${e.message || e}`, 'error');
        } finally {
            setPickerLoading(false);
        }
    }, [addToast, collectGalleryPhotos, galleryRootPath]);

    const loadPhotoDataUrl = useCallback(async (photo: PickerPhoto) => {
        const cached = pickerPreviewMap[photo.path];
        if (cached) return cached;
        const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(photo.path), allowGlobal);
        const dataUrl = `data:${mimeByName(photo.name)};base64,${base64}`;
        setPickerPreviewMap(prev => ({ ...prev, [photo.path]: dataUrl }));
        return dataUrl;
    }, [allowGlobal, galleryRootPath, pickerPreviewMap]);

    useEffect(() => {
        if (!showAvatarPicker || !galleryRootPath || pickerPhotos.length === 0) return;
        const targets = pickerPhotos.slice(0, 18).filter(p => !pickerPreviewMap[p.path]);
        if (targets.length === 0) return;
        let canceled = false;
        Promise.all(targets.map(async p => {
            try {
                const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(p.path), allowGlobal);
                return [p.path, `data:${mimeByName(p.name)};base64,${base64}`] as const;
            } catch {
                return [p.path, ''] as const;
            }
        })).then(list => {
            if (canceled) return;
            setPickerPreviewMap(prev => {
                const next = { ...prev };
                list.forEach(([path, dataUrl]) => {
                    if (!next[path]) next[path] = dataUrl;
                });
                return next;
            });
        });
        return () => {
            canceled = true;
        };
    }, [allowGlobal, galleryRootPath, pickerPhotos, pickerPreviewMap, showAvatarPicker]);

    const applyAvatar = useCallback(async (target: AvatarTarget, dataUrl: string, summary: string, avatarPath?: string) => {
        if (target === 'user') {
            const nextAvatar = avatarPath || userProfile.avatar;
            await updateUserProfile({ avatar: nextAvatar, displayAvatar: dataUrl });
            await DB.saveRelationEvent({ type: 'user_avatar_changed', actor: 'user', summary });
            try {
                await writeUserProfileFile({ avatar: nextAvatar });
            } catch (e: any) {
                addToast(e.message || '写入 USER.md 失败', 'error');
            }
        } else if (agent) {
            const nextAvatar = avatarPath || agent.avatar;
            await updateAgent({ avatar: nextAvatar, displayAvatar: dataUrl });
            await DB.saveRelationEvent({ type: 'agent_avatar_changed', actor: 'user', summary });
            try {
                await writeAgentSoulFile({ avatar: nextAvatar });
            } catch (e: any) {
                addToast(e.message || '写入 Agent_Soul.md 失败', 'error');
            }
        }
    }, [addToast, agent, updateAgent, updateUserProfile, userProfile.avatar, writeAgentSoulFile, writeUserProfileFile]);

    const openAvatarPicker = useCallback(async (target: AvatarTarget) => {
        setAvatarPickerTarget(target);
        setShowAvatarPicker(true);
        await loadPicker();
    }, [loadPicker]);

    const handlePickFromGallery = useCallback(async () => {
        if (!pickerSelectedPath) {
            addToast('请先选择相册图片', 'info');
            return;
        }
        const photo = pickerPhotos.find(p => p.path === pickerSelectedPath);
        if (!photo) return;
        try {
            const dataUrl = await loadPhotoDataUrl(photo);
            if (!dataUrl) throw new Error('读取图片失败');
            await applyAvatar(avatarPickerTarget, dataUrl, `用户从相册设置了${avatarPickerTarget === 'user' ? '用户' : 'Agent'}头像: ${photo.name}`, photo.path);
            addToast('头像已更新', 'success');
            setShowAvatarPicker(false);
        } catch (e: any) {
            addToast(e.message || '设置头像失败', 'error');
        }
    }, [addToast, applyAvatar, avatarPickerTarget, loadPhotoDataUrl, pickerPhotos, pickerSelectedPath]);

    const handleUploadAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, target: AvatarTarget) => {
        const file = e.target.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        if (!galleryRootPath) {
            addToast('请先在设置中配置相册路径', 'error');
            return;
        }
        try {
            const dataUrl = await processImage(file, { maxWidth: 720, quality: 0.65, forceJpeg: true });
            const safeName = sanitizeName(file.name || `avatar_${Date.now()}.jpg`);
            const photos = await collectGalleryPhotos();
            const duplicate = photos.find(p => p.name.trim().toLowerCase() === safeName.trim().toLowerCase());
            if (duplicate) {
                const duplicateDataUrl = await loadPhotoDataUrl(duplicate);
                await applyAvatar(target, duplicateDataUrl, `用户复用了相册已有图片设置${target === 'user' ? '用户' : 'Agent'}头像: ${safeName}`, duplicate.path);
                addToast('检测到相册同名图片，已复用', 'success');
                setShowAvatarPicker(false);
                return;
            }
            setPendingUpload({ target, safeName, dataUrl, detail: '' });
        } catch (err: any) {
            addToast(err.message || '上传失败', 'error');
        }
    }, [addToast, applyAvatar, collectGalleryPhotos, galleryRootPath, loadPhotoDataUrl]);

    const confirmPendingUpload = useCallback(async () => {
        if (!pendingUpload) return;
        const detail = pendingUpload.detail.trim();
        if (!detail) {
            addToast('请填写图片详情', 'error');
            return;
        }
        if (!galleryRootPath) {
            addToast('未配置相册路径', 'error');
            return;
        }
        try {
            const relPath = `/${pendingUpload.safeName}`;
            const base64 = pendingUpload.dataUrl.includes(',') ? pendingUpload.dataUrl.split(',')[1] : pendingUpload.dataUrl;
            await fsBridge.writeFileBase64(galleryRootPath, toRelPath(relPath), base64, allowGlobal);
            await DB.saveImageDetail({
                fileName: pendingUpload.safeName,
                detail: detail.slice(0, 30),
                source: 'user',
                relatedPath: relPath
            });
            await applyAvatar(pendingUpload.target, pendingUpload.dataUrl, `用户上传新图并设置${pendingUpload.target === 'user' ? '用户' : 'Agent'}头像: ${pendingUpload.safeName}`, relPath);
            addToast('头像已更新并保存到相册', 'success');
            setPendingUpload(null);
            setShowAvatarPicker(false);
        } catch (e: any) {
            addToast(e.message || '保存头像失败', 'error');
        }
    }, [addToast, allowGlobal, applyAvatar, galleryRootPath, pendingUpload]);

    const commitUserProfileDetails = useCallback(async () => {
        const nextName = userNameInput.trim() || userProfile.name || 'User';
        const nextBio = userBioInput.trim();
        const nextPreferredNames = preferredNamesInput.map(n => n.trim()).filter(n => !!n);
        await updateUserProfile({ name: nextName, bio: nextBio, preferredNames: nextPreferredNames });
        if (!apiConfig.nativeWorkspacePath) {
            addToast('未配置工作区路径，无法写入 USER.md', 'error');
            return;
        }
        try {
            await writeUserProfileFile({
                name: nextName,
                nickname: userNicknameInput.trim(),
                preferredNames: nextPreferredNames,
                avatar: userProfile.avatar,
                bio: nextBio
            });
            setUserProfileFileExists(true);
            addToast('USER.md 已更新', 'success');
        } catch (e: any) {
            addToast(e.message || '写入 USER.md 失败', 'error');
        }
    }, [addToast, apiConfig.nativeWorkspacePath, updateUserProfile, userBioInput, userNameInput, userNicknameInput, userProfile.avatar, userProfile.name, preferredNamesInput, writeUserProfileFile]);

    const commitUserNickname = useCallback(async () => {
        const next = userNicknameInput.trim();
        if ((userProfile.nickname || '') === next) return;
        await updateUserProfile({ nickname: next || undefined });
        await DB.saveRelationEvent({
            type: 'user_nickname_changed',
            actor: 'user',
            summary: `用户将聊天昵称更新为「${next || userProfile.name}」`
        });
        try {
            await writeUserProfileFile({ nickname: next || undefined });
        } catch (e: any) {
            addToast(e.message || '写入 USER.md 失败', 'error');
        }
        addToast('昵称已更新', 'success');
    }, [addToast, updateUserProfile, userNicknameInput, userProfile.name, userProfile.nickname, writeUserProfileFile]);

    const commitAgentNickname = useCallback(async () => {
        if (!agent) return;
        const next = agentNicknameInput.trim();
        if ((agent.nickname || '') === next) return;
        await updateAgent({ nickname: next || undefined });
        await DB.saveRelationEvent({
            type: 'agent_nickname_changed',
            actor: 'user',
            summary: `用户将 Agent 聊天昵称更新为「${next || agent.name}」`
        });
        try {
            await writeAgentSoulFile({ nickname: next || undefined });
        } catch (e: any) {
            addToast(e.message || '写入 Agent_Soul.md 失败', 'error');
        }
        addToast('昵称已更新', 'success');
    }, [addToast, agent, agentNicknameInput, updateAgent, writeAgentSoulFile]);

    const tabs = [
        { id: 'user' as const, label: '👤 我的资料', color: 'from-blue-400 to-indigo-500' },
        { id: 'agent' as const, label: '🤖 Agent 资料', color: 'from-violet-400 to-purple-500' },
    ];

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col animate-fade-in">
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">我们的设置</h1>
                </div>
            </div>

            <div className="px-4 pt-4 flex gap-2">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === tab.id
                            ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                            : 'bg-white/70 text-slate-500 hover:bg-slate-100'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">

                {activeTab === 'user' && (
                    <>
                        <div className="flex flex-col items-center gap-4">
                            <div
                                onClick={() => openAvatarPicker('user')}
                                className="w-32 h-32 rounded-full bg-white shadow-lg p-1 cursor-pointer group relative"
                            >
                                <img src={userProfile.displayAvatar || userProfile.avatar} className="w-full h-full rounded-full object-cover group-hover:opacity-80 transition-opacity" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-xs font-bold text-slate-600 bg-white/80 px-2 py-1 rounded-full">更换</span>
                                </div>
                            </div>
                            {userProfile.displayAvatar && (
                                <button onClick={async () => {
                                    await updateUserProfile({ displayAvatar: undefined });
                                    await DB.saveRelationEvent({
                                        type: 'user_avatar_changed',
                                        actor: 'user',
                                        summary: '用户恢复了默认聊天头像'
                                    });
                                }} className="text-[10px] text-red-400 hover:underline">
                                    恢复默认头像
                                </button>
                            )}
                        </div>
                        <div className="space-y-6 flex flex-col items-center max-w-xs mx-auto">
                            <div className="w-full mt-4">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block text-center">聊天显示昵称</label>
                                <input
                                    value={userNicknameInput}
                                    onChange={(e) => setUserNicknameInput(e.target.value)}
                                    onBlur={commitUserNickname}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitUserNickname(); } }}
                                    placeholder={userProfile.name || '输入昵称'}
                                    className="w-full text-center bg-transparent border-b-2 border-slate-200 px-4 py-2 text-xl font-bold text-slate-700 focus:border-primary outline-none transition-all"
                                />
                                <button onClick={commitUserNickname} className="mt-2 w-full py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">保存昵称</button>
                                <p className="text-[10px] text-slate-400 text-center mt-3">这是在聊天界面显示的称呼，不必填写真实姓名。</p>
                                <p className="text-[10px] text-slate-400 text-center mt-1">用户档案已集成在本页</p>
                            </div>
                            <div className="w-full mt-2 p-4 bg-white/80 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">用户名称</label>
                                    <input
                                        value={userNameInput}
                                        onChange={(e) => setUserNameInput(e.target.value)}
                                        placeholder="请填写您的姓名"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:border-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">称呼偏好 (多个)</label>
                                    <div className="flex flex-wrap gap-2">
                                        {preferredNamesInput.map((name, idx) => (
                                            <div key={idx} className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded-lg text-xs font-medium">
                                                <span>{name}</span>
                                                <button 
                                                    onClick={() => setPreferredNamesInput(prev => prev.filter((_, i) => i !== idx))}
                                                    className="p-0.5 hover:bg-primary/20 rounded-full transition-colors"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))}
                                        <button 
                                            onClick={() => {
                                                const n = prompt('输入新的称呼偏好');
                                                if (n && n.trim()) {
                                                    setPreferredNamesInput(prev => [...prev, n.trim()]);
                                                }
                                            }}
                                            className="px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-400 text-xs hover:border-primary hover:text-primary transition-all flex items-center gap-1"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                            </svg>
                                            添加
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-tight">Agent 会随机从这些称呼中选择一个来称呼你。</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">人设/备注</label>
                                    <textarea
                                        value={userBioInput}
                                        onChange={(e) => setUserBioInput(e.target.value)}
                                        rows={3}
                                        placeholder="描述偏好、习惯、原则等"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:border-primary outline-none"
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] text-slate-400">
                                        USER.md：{userProfileFileExists === null ? '检测中' : userProfileFileExists ? '已配置' : '未发现'}
                                    </span>
                                    <button
                                        onClick={commitUserProfileDetails}
                                        className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-bold"
                                    >
                                        同步到档案
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'agent' && agent && (
                    <>
                        <div className="flex flex-col items-center gap-4">
                            <div
                                onClick={() => openAvatarPicker('agent')}
                                className="w-32 h-32 rounded-full bg-white shadow-lg p-1 cursor-pointer group relative"
                            >
                                <img src={agent.displayAvatar || agent.avatar} className="w-full h-full rounded-full object-cover group-hover:opacity-80 transition-opacity" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-xs font-bold text-slate-600 bg-white/80 px-2 py-1 rounded-full">更换</span>
                                </div>
                            </div>
                            {agent.displayAvatar && (
                                <button onClick={async () => {
                                    await updateAgent({ displayAvatar: undefined });
                                    await DB.saveRelationEvent({
                                        type: 'agent_avatar_changed',
                                        actor: 'user',
                                        summary: '用户为 Agent 恢复了默认聊天头像'
                                    });
                                }} className="text-[10px] text-red-400 hover:underline">
                                    恢复默认头像
                                </button>
                            )}
                            <p className="text-[10px] text-slate-400 text-center">
                                此头像仅用于聊天显示（如双人头像）。<br />
                                Agent 的真实形象用于视频通话/桌宠。
                            </p>
                        </div>
                        <div className="space-y-6 flex flex-col items-center max-w-xs mx-auto">
                            <div className="w-full mt-4">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block text-center">聊天显示昵称</label>
                                <input
                                    value={agentNicknameInput}
                                    onChange={(e) => setAgentNicknameInput(e.target.value)}
                                    onBlur={commitAgentNickname}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAgentNickname(); } }}
                                    placeholder={agent.name || '输入昵称'}
                                    className="w-full text-center bg-transparent border-b-2 border-violet-200 px-4 py-2 text-xl font-bold text-slate-700 focus:border-violet-500 outline-none transition-all"
                                />
                                <button onClick={commitAgentNickname} className="mt-2 w-full py-2 rounded-xl bg-violet-50 text-violet-600 text-xs font-bold">保存昵称</button>
                                <p className="text-[10px] text-slate-400 text-center mt-3">
                                    这是 {agent.name} 在聊天中显示的昵称，不是真实名字。<br />
                                    类似 QQ/Discord 的聊天昵称。
                                </p>
                            </div>
                            <div className="w-full mt-2 p-4 bg-violet-50/50 rounded-2xl space-y-4">
                                <div className="text-center px-2">
                                    <p className="text-xs text-violet-600 font-bold mb-1">Agent 真实身份</p>
                                    <p className="text-sm text-slate-600 font-medium">{agent.name}</p>
                                    <p className="text-[10px] text-slate-400 mt-2 italic leading-relaxed">
                                        {(agent.description || '暂无详细设定').length > 120 
                                            ? `${agent.description?.slice(0, 120)}...` 
                                            : agent.description}
                                    </p>
                                </div>
                                <div className="pt-3 border-t border-violet-100 flex justify-center">
                                    <button
                                        onClick={() => setShowVoiceDesigner(true)}
                                        className="w-full py-2.5 rounded-xl bg-violet-100 text-violet-700 hover:bg-violet-200 active:scale-95 transition-all text-xs font-bold flex items-center justify-center gap-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                                        </svg>
                                        语音形象设置 (TTS)
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
            <input type="file" ref={userFileRef} className="hidden" accept="image/*" onChange={(e) => handleUploadAvatar(e, 'user')} />
            <input type="file" ref={agentFileRef} className="hidden" accept="image/*" onChange={(e) => handleUploadAvatar(e, 'agent')} />
            <Modal
                isOpen={showAvatarPicker}
                title={avatarPickerTarget === 'user' ? '为你设置头像' : '为 Agent 设置头像'}
                onClose={() => setShowAvatarPicker(false)}
                footer={
                    <>
                        <button onClick={() => (avatarPickerTarget === 'user' ? userFileRef.current : agentFileRef.current)?.click()} className="flex-1 py-3 bg-slate-100 rounded-2xl">上传新图</button>
                        <button onClick={handlePickFromGallery} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">使用所选</button>
                    </>
                }
            >
                {pickerLoading ? (
                    <div className="h-40 flex items-center justify-center text-sm text-slate-400">正在读取相册...</div>
                ) : pickerPhotos.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center text-sm text-slate-400 gap-3">
                        <span>相册暂无图片，先上传一张</span>
                        <button onClick={() => (avatarPickerTarget === 'user' ? userFileRef.current : agentFileRef.current)?.click()} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">上传图片</button>
                    </div>
                ) : (
                    <div>
                        <div className="text-[11px] text-slate-400 mb-2">优先从相册选择，若无可上传新图</div>
                        <div className="grid grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto no-scrollbar pr-1">
                            {pickerPhotos.map(photo => {
                                const selected = pickerSelectedPath === photo.path;
                                const preview = pickerPreviewMap[photo.path];
                                return (
                                    <button
                                        key={photo.path}
                                        onClick={() => setPickerSelectedPath(photo.path)}
                                        className={`aspect-square rounded-xl border overflow-hidden relative ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200'}`}
                                    >
                                        {preview ? (
                                            <div className="w-full h-full p-1 bg-slate-100">
                                                <img src={preview} className="w-full h-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">🖼️</div>
                                        )}
                                        <div className="absolute left-1 right-1 bottom-1 px-1.5 py-0.5 bg-black/40 text-white text-[10px] rounded truncate">{photo.name}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </Modal>
            <Modal
                isOpen={!!pendingUpload}
                title="填写图片详情"
                onClose={() => setPendingUpload(null)}
                footer={
                    <>
                        <button onClick={() => setPendingUpload(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={confirmPendingUpload} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存并设为头像</button>
                    </>
                }
            >
                <div className="space-y-3">
                    <input
                        value={pendingUpload?.detail || ''}
                        onChange={(e) => setPendingUpload(prev => prev ? { ...prev, detail: e.target.value.slice(0, 30) } : prev)}
                        placeholder="请输入图片详情（最多30字）"
                        className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                        maxLength={30}
                        autoFocus
                    />
                    <div className="text-[11px] text-slate-400 text-right">{(pendingUpload?.detail || '').length}/30</div>
                </div>
            </Modal>

            {/* Voice Designer Fullscreen Modal */}
            {showVoiceDesigner && (
                <div className="fixed inset-0 z-[100] bg-black/40 flex flex-col justify-end animate-fade-in">
                    <div className="absolute inset-0" onClick={() => setShowVoiceDesigner(false)} />
                    <VoiceDesigner onClose={() => setShowVoiceDesigner(false)} />
                </div>
            )}
        </div>
    );
};

export default UserApp;
