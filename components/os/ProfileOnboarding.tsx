import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import Modal from './Modal';
import { fsBridge } from '../../utils/fsBridge';
import { DB } from '../../utils/db';
import { API_SOURCE_REGISTRY, getApiSourceLabel, getHardcodedModels, resolveApiEndpoint } from '../../utils/apiResolver';
import { needsProfileOnboarding, workspaceFileExists } from '../../utils/onboarding';
import { bootstrapWorkspaceFiles, ensureGalleryFolder } from '../../utils/workspaceBootstrap';
import { syncWorkspaceFromDisk } from '../../utils/workspaceSync';
import { buildAgentSoulMarkdown, buildAgentSystemPromptFromSoul, buildUserMarkdownFromProfile, DEFAULT_AGENT_PERSONA, DEFAULT_AGENT_CORE, parseAgentSoulMarkdown, parseUserProfileMarkdown } from '../../utils/profileFiles';
import { processImage } from '../../utils/file';

type StepKey = 'workspace' | 'agent' | 'user';

interface ProfileOnboardingProps {
    isOpen: boolean;
    onComplete: () => void;
}

type AvatarTarget = 'agent' | 'user';
type PendingAvatarUpload = {
    target: AvatarTarget;
    safeName: string;
    dataUrl: string;
    detail: string;
};

const recommendedWorkspacePath = '~/NovaClaw/Workspace';
const recommendedGalleryPath = '~/NovaClaw/Gallery';

const buildAvatar = (seed: string) => {
    const colors = ['9aadd4', 'b5a6d1', '8fb8d0', 'a8c4d8', 'c4b6d6', 'adb8cc'];
    const safeSeed = seed || 'A';
    const color = colors[safeSeed.charCodeAt(0) % colors.length];
    const letter = safeSeed.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
const toRelPath = (path: string) => path.replace(/^\/+/, '');
const extOf = (name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
};
const isImageName = (name: string) => ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extOf(name));
const mimeFromName = (name: string) => {
    const ext = extOf(name);
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'image/jpeg';
};

const ProfileOnboarding: React.FC<ProfileOnboardingProps> = ({ isOpen, onComplete }) => {
    const {
        apiConfig, updateApiConfig,
        apiPresets, addApiPreset, removeApiPreset,
        availableModels, setAvailableModels,
        agent, updateAgent,
        userProfile, updateUserProfile,
        addToast, askAgent
    } = useOS();

    const [step, setStep] = useState<StepKey>('workspace');
    const [loading, setLoading] = useState(true);
    const [workspacePath, setWorkspacePath] = useState(apiConfig.nativeWorkspacePath || recommendedWorkspacePath);
    const [galleryPath, setGalleryPath] = useState(apiConfig.galleryWorkspacePath || recommendedGalleryPath);

    const [agentName, setAgentName] = useState(agent?.name || '');
    const [agentNickname, setAgentNickname] = useState(agent?.nickname || '');
    const [agentIdentity, setAgentIdentity] = useState('');
    const [agentPersona, setAgentPersona] = useState(agent?.description || '');
    const [agentCore, setAgentCore] = useState('');
    const [agentAvatarPath, setAgentAvatarPath] = useState(() => {
        const raw = agent?.avatar || '';
        if (!raw) return '';
        if (raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('blob:')) return '';
        return raw;
    });
    const [agentAvatarPreview, setAgentAvatarPreview] = useState(() => {
        const raw = agent?.avatar || '';
        if (!raw || raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('blob:')) return raw || '';
        return '';
    });
    const [isOptimizing, setIsOptimizing] = useState(false);

    const [userName, setUserName] = useState(userProfile.name || 'User');
    const [userNickname, setUserNickname] = useState(userProfile.nickname || '');
    const [userBio, setUserBio] = useState(userProfile.bio || '');
    const [userAvatarPath, setUserAvatarPath] = useState(() => {
        const raw = userProfile.avatar || '';
        if (!raw) return '';
        if (raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('blob:')) return '';
        return raw;
    });
    const [userAvatarPreview, setUserAvatarPreview] = useState(() => {
        const raw = userProfile.displayAvatar || userProfile.avatar || '';
        if (!raw || raw.startsWith('http') || raw.startsWith('blob:')) return raw || '';
        if (raw.startsWith('data:')) return raw;
        return '';
    });

    const [showApiSetup, setShowApiSetup] = useState(false);
    const [pendingOptimize, setPendingOptimize] = useState(false);
    const [apiSource, setApiSource] = useState(apiConfig.apiSource || 'openai_compatible');
    const [apiBaseUrl, setApiBaseUrl] = useState(apiConfig.baseUrl || '');
    const [apiKey, setApiKey] = useState(apiConfig.apiKey || '');
    const [apiModel, setApiModel] = useState(apiConfig.model || '');
    const [showModelModal, setShowModelModal] = useState(false);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const galleryRootPath = apiConfig.galleryWorkspacePath?.trim() || '';
    const agentAvatarInputRef = useRef<HTMLInputElement>(null);
    const userAvatarInputRef = useRef<HTMLInputElement>(null);
    const [pendingAvatarUpload, setPendingAvatarUpload] = useState<PendingAvatarUpload | null>(null);
    const [isAvatarUploading, setIsAvatarUploading] = useState(false);
    const hasInitializedRef = useRef(false);
    const hydratedRootRef = useRef<string>('');
    const [agentDirty, setAgentDirty] = useState(false);
    const [userDirty, setUserDirty] = useState(false);

    const apiSourceOptions = useMemo(() => Object.keys(API_SOURCE_REGISTRY), []);
    const hardcodedModels = useMemo(() => getHardcodedModels(apiSource), [apiSource]);

    useEffect(() => {
        if (!hardcodedModels || hardcodedModels.length === 0) return;
        if (hardcodedModels.includes(apiModel)) return;
        setApiModel(hardcodedModels[0]);
    }, [apiModel, hardcodedModels]);

    const fetchModels = useCallback(async () => {
        const hardcoded = getHardcodedModels(apiSource);
        if (hardcoded) {
            setAvailableModels(hardcoded);
            if (!hardcoded.includes(apiModel)) setApiModel(hardcoded[0]);
            setShowModelModal(true);
            return;
        }
        const baseUrl = apiBaseUrl.trim();
        if (!baseUrl) {
            addToast('请先填写 Base URL', 'info');
            return;
        }
        setIsLoadingModels(true);
        try {
            const resolved = resolveApiEndpoint({
                ...apiConfig,
                baseUrl,
                apiKey: apiKey.trim(),
                apiSource
            });
            const response = await fetch(resolved.modelsUrl, {
                method: 'GET',
                headers: resolved.headers
            });
            if (!response.ok) {
                if (response.status === 404 || response.status === 405) {
                    setAvailableModels([]);
                    setShowModelModal(true);
                    return;
                }
                throw new Error(`Status ${response.status}`);
            }
            const data = await response.json();
            const list = data.data || data.models || [];
            if (Array.isArray(list)) {
                const models = list.map((m: any) => m.id || m);
                setAvailableModels(models);
                if (models.length > 0 && !models.includes(apiModel)) setApiModel(models[0]);
                setShowModelModal(true);
            } else {
                addToast('模型列表格式不兼容', 'error');
                setAvailableModels([]);
                setShowModelModal(true);
            }
        } catch (e) {
            setAvailableModels([]);
            setShowModelModal(true);
        } finally {
            setIsLoadingModels(false);
        }
    }, [addToast, apiBaseUrl, apiConfig, apiKey, apiModel, apiSource, setAvailableModels]);

    useEffect(() => {
        if (!isOpen) {
            hasInitializedRef.current = false;
            return;
        }
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;
        let cancelled = false;
        const init = async () => {
            setLoading(true);
            const needs = await needsProfileOnboarding(apiConfig);
            if (!needs) {
                if (!cancelled) {
                    localStorage.setItem('os_profile_setup_v1', 'true');
                    onComplete();
                }
                return;
            }
            if (!apiConfig.nativeWorkspacePath || !apiConfig.galleryWorkspacePath) {
                if (!cancelled) {
                    setStep('workspace');
                    setLoading(false);
                }
                return;
            }
            const hasAgent = await workspaceFileExists(apiConfig.nativeWorkspacePath, 'Agent_Soul.md', allowGlobal);
            if (!hasAgent) {
                if (!cancelled) {
                    setStep('agent');
                    setLoading(false);
                }
                return;
            }
            const hasUser = await workspaceFileExists(apiConfig.nativeWorkspacePath, 'USER.md', allowGlobal);
            if (!hasUser) {
                if (!cancelled) {
                    setStep('user');
                    setLoading(false);
                }
                return;
            }
            if (!cancelled) {
                localStorage.setItem('os_profile_setup_v1', 'true');
                onComplete();
            }
        };
        init();
        return () => { cancelled = true; };
    }, [apiConfig, allowGlobal, isOpen, onComplete]);

    const collectGalleryImages = useCallback(async (): Promise<{ name: string; path: string }[]> => {
        if (!galleryRootPath) return [];
        const rootItems = await fsBridge.readDir(galleryRootPath, '/', allowGlobal);
        const rootImages = rootItems
            .filter(item => item.type === 'file' && isImageName(item.name))
            .map(item => ({ name: item.name, path: `/${item.name}` }));
        const folders = rootItems.filter(item => item.type === 'folder');
        const nested = await Promise.all(folders.map(async folder => {
            const dirPath = `/${folder.name}/`;
            const items = await fsBridge.readDir(galleryRootPath, dirPath, allowGlobal);
            return items
                .filter(item => item.type === 'file' && isImageName(item.name))
                .map(item => ({ name: item.name, path: `${dirPath}${item.name}` }));
        }));
        return [...rootImages, ...nested.flat()];
    }, [allowGlobal, galleryRootPath]);

    const loadGalleryDataUrl = useCallback(async (path: string, name: string): Promise<string> => {
        const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(path), allowGlobal);
        return `data:${mimeFromName(name)};base64,${base64}`;
    }, [allowGlobal, galleryRootPath]);

    const applyAvatarSelection = useCallback((target: AvatarTarget, path: string, dataUrl: string) => {
        if (target === 'agent') {
            setAgentDirty(true);
            setAgentAvatarPath(path);
            setAgentAvatarPreview(dataUrl);
        } else {
            setUserDirty(true);
            setUserAvatarPath(path);
            setUserAvatarPreview(dataUrl);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) {
            hydratedRootRef.current = '';
            return;
        }
        const root = (apiConfig.nativeWorkspacePath || workspacePath).trim();
        if (!root) return;
        if (hydratedRootRef.current === root) return;
        let cancelled = false;
        const run = async () => {
            const agentExists = await workspaceFileExists(root, 'Agent_Soul.md', allowGlobal);
            if (!agentDirty) {
                if (agentExists) {
                    try {
                        const content = await fsBridge.readFile(root, 'Agent_Soul.md', allowGlobal);
                        const parsed = parseAgentSoulMarkdown(content);
                        if (parsed) {
                            const avatarRaw = (parsed.avatar || '').trim();
                            const avatarIsFile = avatarRaw && !avatarRaw.startsWith('data:') && !avatarRaw.startsWith('http') && !avatarRaw.startsWith('blob:');
                            if (!cancelled) {
                                setAgentName(parsed.name || '');
                                setAgentNickname(parsed.nickname || '');
                                setAgentIdentity(parsed.identity || '');
                                setAgentPersona(parsed.persona || '');
                                setAgentCore(parsed.core || '');
                                setAgentAvatarPath(avatarIsFile ? avatarRaw : '');
                                setAgentAvatarPreview(avatarIsFile ? '' : avatarRaw);
                            }
                        }
                    } catch { }
                } else if (!cancelled) {
                    setAgentName('');
                    setAgentNickname('');
                    setAgentIdentity('');
                    setAgentPersona('');
                    setAgentCore('');
                    setAgentAvatarPath('');
                    setAgentAvatarPreview('');
                }
            }

            const userExists = await workspaceFileExists(root, 'USER.md', allowGlobal);
            if (!userDirty) {
                if (userExists) {
                    try {
                        const content = await fsBridge.readFile(root, 'USER.md', allowGlobal);
                        const parsed = parseUserProfileMarkdown(content);
                        if (parsed) {
                            const avatarRaw = (parsed.avatar || '').trim();
                            const avatarIsFile = avatarRaw && !avatarRaw.startsWith('data:') && !avatarRaw.startsWith('http') && !avatarRaw.startsWith('blob:');
                            if (!cancelled) {
                                setUserName(parsed.name || '');
                                setUserNickname(parsed.nickname || '');
                                setUserBio(parsed.bio || '');
                                setUserAvatarPath(avatarIsFile ? avatarRaw : '');
                                setUserAvatarPreview(avatarIsFile ? '' : avatarRaw);
                            }
                        }
                    } catch { }
                } else if (!cancelled) {
                    setUserName('');
                    setUserNickname('');
                    setUserBio('');
                    setUserAvatarPath('');
                    setUserAvatarPreview('');
                }
            }

            if (!cancelled) hydratedRootRef.current = root;
        };
        run();
        return () => { cancelled = true; };
    }, [agentDirty, allowGlobal, apiConfig.nativeWorkspacePath, isOpen, userDirty, workspacePath]);

    useEffect(() => {
        if (!agentAvatarPath) {
            if (!agentAvatarPreview) {
                setAgentAvatarPreview(buildAvatar(agentName || 'A'));
            }
            return;
        }
        if (!galleryRootPath) return;
        let cancelled = false;
        const run = async () => {
            try {
                const name = agentAvatarPath.split('/').filter(Boolean).pop() || 'avatar.jpg';
                const dataUrl = await loadGalleryDataUrl(agentAvatarPath, name);
                if (!cancelled) setAgentAvatarPreview(dataUrl);
            } catch { }
        };
        run();
        return () => { cancelled = true; };
    }, [agentAvatarPath, agentAvatarPreview, agentName, galleryRootPath, loadGalleryDataUrl]);

    useEffect(() => {
        if (!userAvatarPath) {
            if (!userAvatarPreview) {
                setUserAvatarPreview(buildAvatar(userName || 'U'));
            }
            return;
        }
        if (!galleryRootPath) return;
        let cancelled = false;
        const run = async () => {
            try {
                const name = userAvatarPath.split('/').filter(Boolean).pop() || 'avatar.jpg';
                const dataUrl = await loadGalleryDataUrl(userAvatarPath, name);
                if (!cancelled) setUserAvatarPreview(dataUrl);
            } catch { }
        };
        run();
        return () => { cancelled = true; };
    }, [galleryRootPath, loadGalleryDataUrl, userAvatarPath, userAvatarPreview, userName]);

    const applyWorkspaceConfig = useCallback(async () => {
        const nextWorkspace = workspacePath.trim() || recommendedWorkspacePath;
        const nextGallery = galleryPath.trim() || recommendedGalleryPath;
        if (!nextWorkspace || !nextGallery) {
            addToast('请先填写实体工作区和相册路径', 'error');
            return false;
        }
        setWorkspacePath(nextWorkspace);
        setGalleryPath(nextGallery);
        const nextConfig = { ...apiConfig, nativeWorkspacePath: nextWorkspace, galleryWorkspacePath: nextGallery };
        updateApiConfig(nextConfig);
        try {
            await bootstrapWorkspaceFiles(nextConfig);
            await ensureGalleryFolder(nextConfig);
            await syncWorkspaceFromDisk(nextConfig);
            addToast('工作区初始化完成', 'success');
            return true;
        } catch (e: any) {
            addToast(`初始化失败: ${e?.message || e}`, 'error');
            return false;
        }
    }, [addToast, apiConfig, galleryPath, updateApiConfig, workspacePath]);

    const proceedWorkspace = useCallback(async () => {
        const ok = await applyWorkspaceConfig();
        if (!ok) return;
        // Always proceed to agent step — bootstrap creates default files, but onboarding
        // should always let the user fill in agent persona and user profile.
        setStep('agent');
        setLoading(false);
    }, [applyWorkspaceConfig]);

    const handleAvatarUpload = useCallback(async (target: AvatarTarget, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        if (!galleryRootPath) {
            addToast('请先配置相册路径', 'error');
            return;
        }
        try {
            const safeName = sanitizeName(file.name || `avatar_${Date.now()}.jpg`);
            const images = await collectGalleryImages();
            const existing = images.find(img => img.name.trim().toLowerCase() === safeName.trim().toLowerCase());
            if (existing) {
                const dataUrl = await loadGalleryDataUrl(existing.path, existing.name);
                applyAvatarSelection(target, existing.path, dataUrl);
                addToast('检测到相册同名图片，已直接使用', 'success');
                return;
            }
            const dataUrl = await processImage(file, { maxWidth: 720, quality: 0.7, forceJpeg: true });
            setPendingAvatarUpload({ target, safeName, dataUrl, detail: '' });
        } catch (err: any) {
            addToast(err?.message || '上传失败', 'error');
        }
    }, [addToast, applyAvatarSelection, collectGalleryImages, galleryRootPath, loadGalleryDataUrl]);

    const confirmAvatarUpload = useCallback(async () => {
        if (!pendingAvatarUpload) return;
        if (!galleryRootPath) {
            addToast('未配置相册路径', 'error');
            return;
        }
        setIsAvatarUploading(true);
        try {
            const images = await collectGalleryImages();
            const normalized = pendingAvatarUpload.safeName.trim().toLowerCase();
            const existing = images.find(img => img.name.trim().toLowerCase() === normalized);
            if (existing) {
                const dataUrl = await loadGalleryDataUrl(existing.path, existing.name);
                applyAvatarSelection(pendingAvatarUpload.target, existing.path, dataUrl);
                addToast('检测到相册同名图片，已直接使用', 'success');
                setPendingAvatarUpload(null);
                return;
            } else {
                const detail = pendingAvatarUpload.detail.trim();
                if (!detail) {
                    addToast('请填写图片详情', 'error');
                    return;
                }
                const relatedPath = `/${pendingAvatarUpload.safeName}`;
                const dataUrl = pendingAvatarUpload.dataUrl;
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                await fsBridge.writeFileBase64(galleryRootPath, toRelPath(relatedPath), base64, allowGlobal);
                await DB.saveImageDetail({
                    fileName: pendingAvatarUpload.safeName,
                    detail: detail.slice(0, 30),
                    source: 'user',
                    relatedPath
                });
                applyAvatarSelection(pendingAvatarUpload.target, relatedPath, dataUrl);
                addToast('头像已保存到相册', 'success');
                setPendingAvatarUpload(null);
            }
        } catch (err: any) {
            addToast(err?.message || '保存头像失败', 'error');
        } finally {
            setIsAvatarUploading(false);
        }
    }, [addToast, allowGlobal, applyAvatarSelection, collectGalleryImages, galleryRootPath, loadGalleryDataUrl, pendingAvatarUpload]);

    const saveAgentSoul = useCallback(async () => {
        const name = agentName.trim();
        if (!name) {
            addToast('Agent 名称不能为空', 'error');
            return;
        }
        const avatar = agentAvatarPath?.trim() || 'default';
        const identity = agentIdentity.trim();
        const persona = agentPersona.trim() || DEFAULT_AGENT_PERSONA;
        const core = agentCore.trim() || DEFAULT_AGENT_CORE;
        const soulContent = buildAgentSoulMarkdown({
            name,
            nickname: agentNickname.trim() || undefined,
            avatar,
            identity: identity || undefined,
            persona,
            core
        });
        const systemPrompt = buildAgentSystemPromptFromSoul({
            name,
            nickname: agentNickname.trim() || undefined,
            avatar,
            identity: identity || undefined,
            persona,
            core
        });
        try {
            if (!apiConfig.nativeWorkspacePath) {
                addToast('未配置工作区路径', 'error');
                return;
            }
            await fsBridge.writeFile(apiConfig.nativeWorkspacePath, 'Agent_Soul.md', soulContent, allowGlobal);
            await updateAgent({
                name,
                avatar,
                nickname: agentNickname.trim() || undefined,
                displayAvatar: agentAvatarPreview || undefined,
                description: persona,
                systemPrompt
            });
            addToast('Agent 灵魂已写入', 'success');
            setStep('user');
        } catch (e: any) {
            addToast(`写入失败: ${e?.message || e}`, 'error');
        }
    }, [addToast, agentAvatarPath, agentAvatarPreview, agentCore, agentName, agentNickname, agentPersona, allowGlobal, apiConfig.nativeWorkspacePath, updateAgent]);

    const saveUserProfile = useCallback(async (allowEmpty: boolean) => {
        const name = userName.trim() || 'User';
        const nickname = userNickname.trim();
        const bio = userBio.trim();
        if (!allowEmpty && !name) {
            addToast('用户名称不能为空', 'error');
            return;
        }
        const avatar = userAvatarPath?.trim() || ((userProfile.avatar && !userProfile.avatar.startsWith('data:') && !userProfile.avatar.startsWith('http') && !userProfile.avatar.startsWith('blob:')) ? userProfile.avatar : 'default');
        const userMd = buildUserMarkdownFromProfile({ name, nickname, avatar, bio });
        try {
            const workspaceRoot = apiConfig.nativeWorkspacePath || workspacePath.trim();
            if (!workspaceRoot) {
                addToast('未配置工作区路径', 'error');
                return;
            }
            await bootstrapWorkspaceFiles({ ...apiConfig, nativeWorkspacePath: workspaceRoot });
            await fsBridge.writeFile(workspaceRoot, 'USER.md', userMd, allowGlobal);
            await updateUserProfile({
                name,
                nickname: nickname || undefined,
                bio,
                avatar,
                displayAvatar: userAvatarPath ? (userAvatarPreview || undefined) : undefined
            });
            addToast('用户档案已写入', 'success');
            localStorage.setItem('os_profile_setup_v1', 'true');
            onComplete();
        } catch (e: any) {
            addToast(`写入失败: ${e?.message || e}`, 'error');
        }
    }, [addToast, allowGlobal, apiConfig, onComplete, updateUserProfile, userBio, userName, userNickname, userAvatarPath, userAvatarPreview, userProfile.avatar, workspacePath]);

    const optimizePersona = useCallback(async () => {
        const sourceText = agentPersona.trim();
        if (!sourceText) {
            addToast('请先填写人设再优化', 'info');
            return;
        }
        try {
            setIsOptimizing(true);
            const prompt = [
                '任务：在不新增事实的前提下优化角色设定，提升清晰度与可执行性。',
                '输出要求：',
                '1. 结构化：用编号条目或小标题分段（如「身份」「气质」「说话方式」「关系定位」「边界/禁忌」），每段 1-4 行。',
                '2. 严格保留原意，不新增设定。',
                '3. 提及用户时统一使用“User”。',
                '4. 输出纯文本，不要加额外标题或前言，结果可直接替换原人设。',
                '',
                '角色设定原文：',
                sourceText
            ].join('\n');
            const refined = await askAgent(prompt, 'You are a structured persona editor. Preserve meaning, add no facts, and always refer to the user as "User".');
            const cleaned = refined.trim();
            if (cleaned) {
                setAgentDirty(true);
                setAgentPersona(cleaned);
            }
        } catch (e: any) {
            addToast(`优化失败: ${e?.message || e}`, 'error');
        } finally {
            setIsOptimizing(false);
        }
    }, [addToast, agentPersona, askAgent]);

    const handleOptimizePersona = useCallback(() => {
        setPendingOptimize(true);
        setShowApiSetup(true);
    }, []);

    useEffect(() => {
        if (!pendingOptimize) return;
        if (showApiSetup) return;
        if (!apiConfig.baseUrl || !apiConfig.apiKey || !apiConfig.model) return;
        setPendingOptimize(false);
        optimizePersona();
    }, [apiConfig.apiKey, apiConfig.baseUrl, apiConfig.model, optimizePersona, pendingOptimize, showApiSetup]);

    const saveQuickApiConfig = useCallback(() => {
        const fallbackBaseUrl = API_SOURCE_REGISTRY[apiSource]?.defaultBaseUrl || '';
        const fallbackModel = (getHardcodedModels(apiSource) || [])[0] || apiConfig.model || '';
        const resolvedBaseUrl = apiBaseUrl.trim() || fallbackBaseUrl;
        const resolvedApiKey = apiKey.trim();
        if (!resolvedBaseUrl) {
            addToast('请填写 Base URL', 'error');
            return;
        }
        if (!resolvedApiKey) {
            addToast('请填写 API Key', 'error');
            return;
        }
        const nextConfig = {
            ...apiConfig,
            apiSource,
            baseUrl: resolvedBaseUrl,
            apiKey: resolvedApiKey,
            model: apiModel.trim() || fallbackModel
        };
        updateApiConfig(nextConfig);
        const presetName = `Onboarding - ${getApiSourceLabel(apiSource)}`;
        const existing = apiPresets.find(p => (p.config.apiSource || 'openai_compatible') === apiSource && p.config.baseUrl === nextConfig.baseUrl);
        if (existing) {
            removeApiPreset(existing.id);
        }
        addApiPreset(presetName, nextConfig);
        setShowApiSetup(false);
        addToast('API 配置已保存', 'success');
    }, [addApiPreset, addToast, apiBaseUrl, apiConfig, apiKey, apiModel, apiPresets, apiSource, removeApiPreset, updateApiConfig]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/90 text-white">
            {/* 背景层 */}
            <div className="absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_45%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,_rgba(244,114,182,0.18),_transparent_50%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(24,24,27,0.92),_rgba(12,10,9,0.85))]" />
                <div className="absolute inset-0 opacity-25 bg-[linear-gradient(90deg,_rgba(255,255,255,0.03)_1px,_transparent_1px),_linear-gradient(_rgba(255,255,255,0.03)_1px,_transparent_1px)] bg-[size:22px_22px]" />
            </div>

            {/* 隐藏文件上传 input */}
            <input
                ref={agentAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAvatarUpload('agent', e)}
            />
            <input
                ref={userAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAvatarUpload('user', e)}
            />

            {/* 头像上传详情 Modal */}
            <Modal
                isOpen={!!pendingAvatarUpload}
                title="填写头像图片详情"
                onClose={() => {
                    if (isAvatarUploading) return;
                    setPendingAvatarUpload(null);
                }}
                footer={
                    <>
                        <button
                            onClick={() => setPendingAvatarUpload(null)}
                            className="flex-1 py-3 bg-slate-100 rounded-2xl"
                            disabled={isAvatarUploading}
                        >
                            取消
                        </button>
                        <button
                            onClick={confirmAvatarUpload}
                            className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl"
                            disabled={isAvatarUploading}
                        >
                            {isAvatarUploading ? '保存中...' : '保存并设为头像'}
                        </button>
                    </>
                }
            >
                <div className="space-y-3">
                    {pendingAvatarUpload && (
                        <div className="text-[11px] text-slate-400">
                            文件：{pendingAvatarUpload.safeName}
                        </div>
                    )}
                    <input
                        value={pendingAvatarUpload?.detail || ''}
                        onChange={e => setPendingAvatarUpload(prev => prev ? { ...prev, detail: e.target.value.slice(0, 30) } : prev)}
                        placeholder="请输入图片详情（最多30字）"
                        className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                        maxLength={30}
                        autoFocus
                    />
                    <div className="text-[11px] text-slate-400 text-right">{(pendingAvatarUpload?.detail || '').length}/30</div>
                </div>
            </Modal>

            {/* API 快速配置浮层 */}
            {showApiSetup && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70">
                    <div className="w-[90%] max-w-[420px] bg-stone-900 border border-amber-300/30 rounded-2xl p-6 space-y-4">
                        <div className="text-sm font-bold text-amber-100">{pendingOptimize ? '配置用于优化' : '快速配置 API'}</div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase text-amber-200/60">Provider</label>
                            <select
                                value={apiSource}
                                onChange={e => setApiSource(e.target.value as any)}
                                className="w-full bg-stone-950/60 border border-amber-200/30 rounded-xl px-3 py-2 text-xs text-amber-50"
                            >
                                {apiSourceOptions.map(key => (
                                    <option key={key} value={key}>{API_SOURCE_REGISTRY[key as keyof typeof API_SOURCE_REGISTRY]?.label || key}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase text-amber-200/60">Base URL</label>
                            <input
                                value={apiBaseUrl}
                                onChange={e => setApiBaseUrl(e.target.value)}
                                placeholder={API_SOURCE_REGISTRY[apiSource as keyof typeof API_SOURCE_REGISTRY]?.placeholder || ''}
                                className="w-full bg-stone-950/60 border border-amber-200/30 rounded-xl px-3 py-2 text-xs text-amber-50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase text-amber-200/60">API Key</label>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                                className="w-full bg-stone-950/60 border border-amber-200/30 rounded-xl px-3 py-2 text-xs text-amber-50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase text-amber-200/60">Model</label>
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    onClick={fetchModels}
                                    disabled={isLoadingModels}
                                    className="text-[10px] text-amber-200/80 font-bold"
                                >
                                    {isLoadingModels ? '刷新中...' : '刷新模型列表'}
                                </button>
                                <button
                                    onClick={() => setShowModelModal(true)}
                                    className="text-[10px] text-amber-200/80 font-bold"
                                >
                                    选择/输入模型
                                </button>
                            </div>
                            <button
                                onClick={() => setShowModelModal(true)}
                                className="w-full bg-stone-950/60 border border-amber-200/30 rounded-xl px-3 py-2 text-xs text-amber-50 text-left"
                            >
                                <span className="truncate font-mono">{apiModel || 'Select Model...'}</span>
                            </button>
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => { setShowApiSetup(false); setPendingOptimize(false); }}
                                className="flex-1 py-2 rounded-xl bg-stone-800 text-xs font-bold text-amber-100/70"
                            >
                                取消
                            </button>
                            <button
                                onClick={saveQuickApiConfig}
                                className="flex-1 py-2 rounded-xl bg-amber-400 text-xs font-bold text-stone-950"
                            >
                                {pendingOptimize ? '保存并优化' : '保存'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 模型选择 Modal */}
            <Modal isOpen={showModelModal} title="选择或输入模型" onClose={() => setShowModelModal(false)}>
                <div className="p-1 space-y-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">手动输入模型 ID</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={apiModel}
                                onChange={(e) => setApiModel(e.target.value)}
                                placeholder="如 gpt-4o / ep-xxxx"
                                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-primary"
                            />
                            <button
                                onClick={() => setShowModelModal(false)}
                                className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-sm active:scale-95"
                            >
                                确认
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2">
                            如果拉取列表失败，可在此手动填写模型 ID。
                        </p>
                    </div>
                    <div className="max-h-[40vh] overflow-y-auto no-scrollbar space-y-2">
                        {availableModels.length > 0 ? availableModels.map(m => (
                            <button
                                key={m}
                                onClick={() => { setApiModel(m); setShowModelModal(false); }}
                                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono flex justify-between items-center ${m === apiModel ? 'bg-primary/10 text-primary font-bold ring-1 ring-primary/20' : 'bg-white border border-slate-100 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <span className="truncate">{m}</span>
                                {m === apiModel && <div className="w-2 h-2 rounded-full bg-primary"></div>}
                            </button>
                        )) : (
                            <div className="text-center text-slate-400 py-4 text-xs">
                                未检测到在线模型列表，请上方手动输入。
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* 主卡片 */}
            <div className="relative w-[92%] max-w-[560px] h-[min(86vh,640px)] rounded-[28px] border border-amber-300/20 bg-stone-900/80 shadow-[0_0_45px_rgba(251,191,36,0.18)] backdrop-blur-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-5 border-b border-amber-300/10">
                    <div className="text-xs tracking-[0.3em] text-amber-200/80 uppercase">NovaClaw Profile Boot</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight">个人档案初始化</div>
                    <div className="mt-2 text-xs text-amber-100/70">
                        首次进入需要补全实体工作区与灵魂档案。完成后可在设置页随时修改。
                    </div>
                </div>

                {loading ? (
                    <div className="flex-1 px-6 py-12 text-center text-sm text-amber-100/70">正在检测配置...</div>
                ) : (
                    <div className="flex-1 px-6 py-6 space-y-6 overflow-y-scroll no-scrollbar" style={{ scrollbarGutter: 'stable' }}>
                        {/* Step 导航 */}
                        <div className="flex items-center gap-3 text-[11px] text-amber-200/70 uppercase tracking-widest">
                            <button
                                type="button"
                                onClick={() => setStep('workspace')}
                                className={`flex items-center gap-2 ${step === 'workspace' ? 'text-amber-100' : 'text-amber-200/70'} hover:text-amber-100 transition-colors`}
                            >
                                <span className={`h-2 w-2 rounded-full ${step === 'workspace' ? 'bg-amber-300' : 'bg-amber-200/30'}`} />
                                <span>Workspace</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!workspacePath.trim() || !galleryPath.trim()) {
                                        addToast('请先设置工作区与相册路径', 'info');
                                        setStep('workspace');
                                        return;
                                    }
                                    setStep('agent');
                                }}
                                className={`flex items-center gap-2 ${step === 'agent' ? 'text-amber-100' : 'text-amber-200/70'} hover:text-amber-100 transition-colors`}
                            >
                                <span className={`h-2 w-2 rounded-full ${step === 'agent' ? 'bg-amber-300' : 'bg-amber-200/30'}`} />
                                <span>Agent Soul</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!workspacePath.trim() || !galleryPath.trim()) {
                                        addToast('请先设置工作区与相册路径', 'info');
                                        setStep('workspace');
                                        return;
                                    }
                                    setStep('user');
                                }}
                                className={`flex items-center gap-2 ${step === 'user' ? 'text-amber-100' : 'text-amber-200/70'} hover:text-amber-100 transition-colors`}
                            >
                                <span className={`h-2 w-2 rounded-full ${step === 'user' ? 'bg-amber-300' : 'bg-amber-200/30'}`} />
                                <span>User Profile</span>
                            </button>
                        </div>

                        {/* ── Workspace Step ── */}
                        {step === 'workspace' && (
                            <div className="space-y-4 animate-fade-in-up">
                                <div className="text-sm text-amber-100/80">
                                    设置实体工作区与相册路径，用于同步本地文件。
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] uppercase text-amber-200/60">工作区路径</label>
                                    <input
                                        value={workspacePath}
                                        onChange={e => setWorkspacePath(e.target.value)}
                                        placeholder={recommendedWorkspacePath}
                                        className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-4 py-2.5 text-sm text-amber-50 font-mono placeholder:text-amber-200/30"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] uppercase text-amber-200/60">相册路径</label>
                                    <input
                                        value={galleryPath}
                                        onChange={e => setGalleryPath(e.target.value)}
                                        placeholder={recommendedGalleryPath}
                                        className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-4 py-2.5 text-sm text-amber-50 font-mono placeholder:text-amber-200/30"
                                    />
                                </div>
                                <button
                                    onClick={proceedWorkspace}
                                    className="w-full py-3 rounded-2xl bg-amber-400 text-stone-950 text-sm font-bold mt-2"
                                >
                                    确认并继续
                                </button>
                            </div>
                        )}

                        {/* ── Agent Soul Step ── */}
                        {step === 'agent' && (
                            <div className="space-y-4 animate-fade-in-up">
                                <div className="text-sm text-amber-100/80">
                                    设定 Agent 的名称、昵称与人设，写入灵魂档案。
                                </div>

                                {/* 头像 */}
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => agentAvatarInputRef.current?.click()}
                                        className="relative w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-amber-300/30 hover:ring-amber-300/60 transition-all flex-shrink-0"
                                    >
                                        <img
                                            src={agentAvatarPreview || buildAvatar(agentName || 'A')}
                                            alt="agent avatar"
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                            <span className="text-[10px] text-white">更换</span>
                                        </div>
                                    </button>
                                    <div className="flex-1 space-y-2">
                                        <div className="space-y-1">
                                            <label className="text-[11px] uppercase text-amber-200/60">名称</label>
                                            <input
                                                value={agentName}
                                                onChange={e => { setAgentDirty(true); setAgentName(e.target.value); }}
                                                placeholder="Agent 名称"
                                                className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[11px] uppercase text-amber-200/60">昵称（可选）</label>
                                            <input
                                                value={agentNickname}
                                                onChange={e => { setAgentDirty(true); setAgentNickname(e.target.value); }}
                                                placeholder="用户对 Agent 的称呼"
                                                className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 人设 */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[11px] uppercase text-amber-200/60">人设档案</label>
                                        <button
                                            onClick={handleOptimizePersona}
                                            disabled={isOptimizing}
                                            className="text-[10px] text-amber-300/80 font-bold hover:text-amber-300 transition-colors"
                                        >
                                            {isOptimizing ? '优化中...' : '✦ AI 优化'}
                                        </button>
                                    </div>
                                    <textarea
                                        value={agentPersona}
                                        onChange={e => { setAgentDirty(true); setAgentPersona(e.target.value); }}
                                        placeholder="描述 Agent 的性格、风格与行为倾向..."
                                        rows={4}
                                        className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30 resize-none"
                                    />
                                </div>

                                {/* 核心指令 */}
                                <div className="space-y-1">
                                    <label className="text-[11px] uppercase text-amber-200/60">核心指令（可选）</label>
                                    <textarea
                                        value={agentCore}
                                        onChange={e => { setAgentDirty(true); setAgentCore(e.target.value); }}
                                        placeholder="Agent 必须遵守的底层行为规则..."
                                        rows={3}
                                        className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30 resize-none"
                                    />
                                </div>

                                <button
                                    onClick={saveAgentSoul}
                                    className="w-full py-3 rounded-2xl bg-amber-400 text-stone-950 text-sm font-bold"
                                >
                                    写入灵魂档案
                                </button>
                            </div>
                        )}

                        {/* ── User Profile Step ── */}
                        {step === 'user' && (
                            <div className="space-y-4 animate-fade-in-up">
                                <div className="text-sm text-amber-100/80">
                                    设定你的用户档案，Agent 会据此了解你。
                                </div>

                                {/* 头像 */}
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => userAvatarInputRef.current?.click()}
                                        className="relative w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-amber-300/30 hover:ring-amber-300/60 transition-all flex-shrink-0"
                                    >
                                        <img
                                            src={userAvatarPreview || buildAvatar(userName || 'U')}
                                            alt="user avatar"
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                            <span className="text-[10px] text-white">更换</span>
                                        </div>
                                    </button>
                                    <div className="flex-1 space-y-2">
                                        <div className="space-y-1">
                                            <label className="text-[11px] uppercase text-amber-200/60">名称</label>
                                            <input
                                                value={userName}
                                                onChange={e => { setUserDirty(true); setUserName(e.target.value); }}
                                                placeholder="你的名字"
                                                className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[11px] uppercase text-amber-200/60">昵称（可选）</label>
                                            <input
                                                value={userNickname}
                                                onChange={e => { setUserDirty(true); setUserNickname(e.target.value); }}
                                                placeholder="Agent 对你的称呼"
                                                className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Bio */}
                                <div className="space-y-1">
                                    <label className="text-[11px] uppercase text-amber-200/60">个人简介（可选）</label>
                                    <textarea
                                        value={userBio}
                                        onChange={e => { setUserDirty(true); setUserBio(e.target.value); }}
                                        placeholder="介绍一下自己，Agent 会更好地了解你..."
                                        rows={4}
                                        className="w-full bg-stone-950/60 border border-amber-200/20 rounded-xl px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/30 resize-none"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => saveUserProfile(true)}
                                        className="flex-1 py-3 rounded-2xl bg-stone-800 text-amber-100/70 text-sm font-bold"
                                    >
                                        跳过
                                    </button>
                                    <button
                                        onClick={() => saveUserProfile(false)}
                                        className="flex-1 py-3 rounded-2xl bg-amber-400 text-stone-950 text-sm font-bold"
                                    >
                                        保存并完成
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProfileOnboarding;
