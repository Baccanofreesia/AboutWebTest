
import React, { useState, useRef, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { NotionManager, FeishuManager } from '../utils/realtimeContext';
import { XhsMcpClient } from '../utils/xhsMcpClient';
import { SearchTool } from '../utils/searchTool';
import { syncWorkspaceFromDisk } from '../utils/workspaceSync';
import { DB } from '../utils/db';
import { resolveApiEndpoint, API_SOURCE_REGISTRY, getHardcodedModels } from '../utils/apiResolver';
import { workspaceFileExists } from '../utils/onboarding';
import { AppID } from '../types';
import type { ApiSource } from '../types';

const Settings: React.FC = () => {
    const {
        apiConfig, updateApiConfig, closeApp, openApp, availableModels, setAvailableModels,
        exportSystem, importSystem, addToast, resetSystem,
        apiPresets, addApiPreset, removeApiPreset, userProfile, updateUserProfile,
        realtimeConfig, updateRealtimeConfig
    } = useOS();

    const [localKey, setLocalKey] = useState(apiConfig.apiKey);
    const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
    const [localModel, setLocalModel] = useState(apiConfig.model);
    const [localWorkspacePath, setLocalWorkspacePath] = useState(apiConfig.nativeWorkspacePath || '');
    const [localGalleryPath, setLocalGalleryPath] = useState(apiConfig.galleryWorkspacePath || '');
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [localApiSource, setLocalApiSource] = useState<ApiSource>(apiConfig.apiSource || 'openai_compatible');
    const [agentSoulExists, setAgentSoulExists] = useState<boolean | null>(null);
    const [userProfileExists, setUserProfileExists] = useState<boolean | null>(null);

    // UI States
    const [showModelModal, setShowModelModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [showRealtimeModal, setShowRealtimeModal] = useState(false);

    const [exportContent, setExportContent] = useState('');

    // Realtime perception local state
    const [rtWeatherEnabled, setRtWeatherEnabled] = useState(realtimeConfig.weatherEnabled);
    const [rtWeatherKey, setRtWeatherKey] = useState(realtimeConfig.weatherApiKey);
    const [rtWeatherCity, setRtWeatherCity] = useState(realtimeConfig.weatherCity);
    const [rtNewsEnabled, setRtNewsEnabled] = useState(realtimeConfig.newsEnabled);
    const [rtNewsProvider, setRtNewsProvider] = useState<'brave' | 'tavily'>(realtimeConfig.newsProvider || 'brave');
    const [rtNewsApiKey, setRtNewsApiKey] = useState(realtimeConfig.newsApiKey || '');
    const [rtNotionEnabled, setRtNotionEnabled] = useState(realtimeConfig.notionEnabled);
    const [rtNotionKey, setRtNotionKey] = useState(realtimeConfig.notionApiKey);
    const [rtNotionDbId, setRtNotionDbId] = useState(realtimeConfig.notionDatabaseId);
    const [rtFeishuEnabled, setRtFeishuEnabled] = useState(realtimeConfig.feishuEnabled);
    const [rtFeishuAppId, setRtFeishuAppId] = useState(realtimeConfig.feishuAppId);
    const [rtFeishuAppSecret, setRtFeishuAppSecret] = useState(realtimeConfig.feishuAppSecret);
    const [rtFeishuBaseId, setRtFeishuBaseId] = useState(realtimeConfig.feishuBaseId);
    const [rtFeishuTableId, setRtFeishuTableId] = useState(realtimeConfig.feishuTableId);
    const [rtXhsEnabled, setRtXhsEnabled] = useState(realtimeConfig.xhsEnabled);
    const [rtXhsMcpEnabled, setRtXhsMcpEnabled] = useState(realtimeConfig.xhsMcpConfig?.enabled || false);
    const [rtXhsMcpUrl, setRtXhsMcpUrl] = useState(realtimeConfig.xhsMcpConfig?.serverUrl || 'http://localhost:18060/mcp');
    const [rtXhsNickname, setRtXhsNickname] = useState(realtimeConfig.xhsMcpConfig?.loggedInNickname || '');
    const [rtXhsUserId, setRtXhsUserId] = useState(realtimeConfig.xhsMcpConfig?.loggedInUserId || '');
    const [isTestingWebSearch, setIsTestingWebSearch] = useState(false);
    const testToastLockRef = useRef(false);
    const [isSavingApi, setIsSavingApi] = useState(false);
    const saveApiLockRef = useRef(false);
    const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 感知引擎 2.0 参数
    const [rtVisibilityThreshold, setRtVisibilityThreshold] = useState(realtimeConfig.perceptionConfig?.visibilityThreshold ?? 0.7);
    const [rtInternalizationBias, setRtInternalizationBias] = useState(realtimeConfig.perceptionConfig?.internalizationBias ?? 0.8);
    const [rtFrequencyPenalty, setRtFrequencyPenalty] = useState(realtimeConfig.perceptionConfig?.frequencyPenalty ?? 0.5);
    const [rtPresencePenalty, setRtPresencePenalty] = useState(realtimeConfig.perceptionConfig?.presencePenalty ?? 0.3);
    const [rtBatteryUrgencyThreshold, setRtBatteryUrgencyThreshold] = useState(realtimeConfig.perceptionConfig?.batteryUrgencyThreshold ?? 15);
    const [rtLateNightHour, setRtLateNightHour] = useState(realtimeConfig.perceptionConfig?.lateNightHour ?? 23);

    // Video Understanding Config
    const [videoMaxFrames, setVideoMaxFrames] = useState(apiConfig.videoUnderstanding?.maxFrames || 10);
    const [videoProviderMode, setVideoProviderMode] = useState<'auto' | 'kimi' | 'volcengine' | 'gemini'>(apiConfig.videoUnderstanding?.providerMode || 'auto');
    const [videoNativeFirst, setVideoNativeFirst] = useState(apiConfig.videoUnderstanding?.nativeFirst ?? true);
    const [statusMsg, setStatusMsg] = useState('');
    const importInputRef = useRef<HTMLInputElement>(null);

    // TTS Config
    const [localTtsProvider, setLocalTtsProvider] = useState<'minimax' | 'fish_speech' | 'none'>(apiConfig.ttsProvider || 'none');
    const [localMinimaxKey, setLocalMinimaxKey] = useState(apiConfig.minimaxApiKey || '');
    const [localMinimaxGroup, setLocalMinimaxGroup] = useState(apiConfig.minimaxGroupId || '');
    const [localFishUrl, setLocalFishUrl] = useState(apiConfig.fishSpeechBaseUrl || '');
    const [localFishKey, setLocalFishKey] = useState(apiConfig.fishSpeechApiKey || '');

    // Auto-save draft configs locally to prevent loss during typing
    useEffect(() => {
        setLocalUrl(apiConfig.baseUrl);
        setLocalKey(apiConfig.apiKey);
        setLocalModel(apiConfig.model);
        setLocalApiSource(apiConfig.apiSource || 'openai_compatible');
        setLocalWorkspacePath(apiConfig.nativeWorkspacePath || '');
        setLocalGalleryPath(apiConfig.galleryWorkspacePath || '');
        setVideoMaxFrames(apiConfig.videoUnderstanding?.maxFrames || 10);
        setVideoProviderMode(apiConfig.videoUnderstanding?.providerMode || 'auto');
        setVideoNativeFirst(apiConfig.videoUnderstanding?.nativeFirst ?? true);
        setLocalTtsProvider(apiConfig.ttsProvider || 'none');
        setLocalMinimaxKey(apiConfig.minimaxApiKey || '');
        setLocalMinimaxGroup(apiConfig.minimaxGroupId || '');
        setLocalFishUrl(apiConfig.fishSpeechBaseUrl || '');
        setLocalFishKey(apiConfig.fishSpeechApiKey || '');
    }, [apiConfig]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!apiConfig.nativeWorkspacePath) {
                if (!cancelled) {
                    setAgentSoulExists(false);
                    setUserProfileExists(false);
                }
                return;
            }
            const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
            const [agentExists, userExists] = await Promise.all([
                workspaceFileExists(apiConfig.nativeWorkspacePath, 'Agent_Soul.md', allowGlobal),
                workspaceFileExists(apiConfig.nativeWorkspacePath, 'USER.md', allowGlobal)
            ]);
            if (!cancelled) {
                setAgentSoulExists(agentExists);
                setUserProfileExists(userExists);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [apiConfig.nativeWorkspacePath, apiConfig.securityPolicy?.allowGlobalFileAccess]);



    const loadPreset = (preset: typeof apiPresets[0]) => {
        setLocalUrl(preset.config.baseUrl);
        setLocalKey(preset.config.apiKey);
        setLocalModel(preset.config.model);
        setLocalApiSource((preset.config as any).apiSource || 'openai_compatible');
        setVideoMaxFrames(preset.config.videoUnderstanding?.maxFrames || 10);
        setVideoProviderMode(preset.config.videoUnderstanding?.providerMode || 'auto');
        setVideoNativeFirst(preset.config.videoUnderstanding?.nativeFirst ?? true);
        addToast(`已加载配置: ${preset.name}`, 'info');
    };

    const handleSavePreset = () => {
        if (!newPresetName.trim()) {
            addToast('请输入预设名称', 'error');
            return;
        }
        addApiPreset(newPresetName, {
            baseUrl: localUrl,
            apiKey: localKey,
            model: localModel,
            apiSource: localApiSource,
            videoUnderstanding: {
                maxFrames: videoMaxFrames,
                providerMode: videoProviderMode,
                nativeFirst: videoNativeFirst
            }
        });
        setNewPresetName('');
        setShowPresetModal(false);
        addToast('预设已保存', 'success');
    };

    const handleSaveApi = async () => {
        if (saveApiLockRef.current) return;
        saveApiLockRef.current = true;
        setIsSavingApi(true);
        if (saveStatusTimerRef.current) {
            clearTimeout(saveStatusTimerRef.current);
            saveStatusTimerRef.current = null;
        }

        const newApiConfig = {
            apiKey: localKey,
            baseUrl: localUrl,
            model: localModel,
            apiSource: localApiSource,
            nativeWorkspacePath: localWorkspacePath,
            galleryWorkspacePath: localGalleryPath,
            videoUnderstanding: {
                maxFrames: videoMaxFrames,
                providerMode: videoProviderMode,
                nativeFirst: videoNativeFirst
            },
            ttsProvider: localTtsProvider,
            minimaxApiKey: localMinimaxKey,
            minimaxGroupId: localMinimaxGroup,
            fishSpeechBaseUrl: localFishUrl,
            fishSpeechApiKey: localFishKey
        };
        updateApiConfig(newApiConfig);
        setStatusMsg('配置已保存，正在同步...');

        const workspaceEmpty = !localWorkspacePath.trim();
        const galleryEmpty = !localGalleryPath.trim();

        try {
            if (workspaceEmpty) {
                await DB.clearWorkspaceFiles();
            }
            if (galleryEmpty) {
                await DB.clearGalleryCache();
            }

            if (workspaceEmpty && galleryEmpty) {
                setStatusMsg('配置已保存，已清空缓存');
                addToast('配置已保存，已清空缓存', 'info');
            } else {
                if (!workspaceEmpty) {
                    await syncWorkspaceFromDisk(newApiConfig);
                }
                setStatusMsg('同步完成');
                addToast('同步完成', 'success');
            }
        } catch (e) {
            console.error("Workspace sync failed on save", e);
            setStatusMsg('同步失败');
            addToast('同步失败', 'error');
        } finally {
            saveApiLockRef.current = false;
            setIsSavingApi(false);
            saveStatusTimerRef.current = setTimeout(() => setStatusMsg(''), 2000);
        }
    };

    const fetchModels = async () => {
        const hardcoded = getHardcodedModels(localApiSource);
        if (hardcoded) {
            setAvailableModels(hardcoded);
            if (!hardcoded.includes(localModel)) setLocalModel(hardcoded[0]);
            setStatusMsg(`已加载 ${hardcoded.length} 个内置模型`);
            setShowModelModal(true);
            return;
        }
        if (!localUrl) { setStatusMsg('请先填写 URL'); return; }
        setIsLoadingModels(true);
        setStatusMsg('正在连接...');
        try {
            // Use the centralized resolver to get the correct models URL and headers
            const resolved = resolveApiEndpoint({
                ...apiConfig,
                baseUrl: localUrl,
                apiKey: localKey,
                apiSource: localApiSource
            });

            const response = await fetch(resolved.modelsUrl, {
                method: 'GET',
                headers: resolved.headers
            });

            if (!response.ok) {
                if (response.status === 404 || response.status === 405) {
                    setStatusMsg('列表接口不支持，请手动输入');
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
                if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
                setStatusMsg(`获取到 ${models.length} 个模型`);
                setShowModelModal(true);
            } else { setStatusMsg('格式不兼容'); }
        } catch (error: any) {
            console.error(error);
            setStatusMsg('连接失败，请手动输入');
            setAvailableModels([]);
            setShowModelModal(true);
        } finally {
            setIsLoadingModels(false);
        }
    };



    // Browser download helper
    const webDownload = (content: string, filename: string) => {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleExport = async (mode: 'data' | 'media') => {
        try {
            let msg = '打包中...';
            if (mode === 'data') msg = '正在导出数据 (包含配置)...';
            if (mode === 'media') msg = '正在打包相册与素材...';

            addToast(msg, 'info');

            // Delay to allow toast to render before heavy sync operation blocks thread
            setTimeout(async () => {
                try {
                    const json = await exportSystem(mode);
                    setExportContent(json);
                    setShowExportModal(true);

                    // Native Share Handling
                    if (Capacitor.isNativePlatform()) {
                        const fileName = `Sully_${mode}_${new Date().toISOString().slice(0, 10)}.json`;
                        try {
                            await Filesystem.writeFile({
                                path: fileName,
                                data: json,
                                directory: Directory.Cache,
                                encoding: Encoding.UTF8,
                            });
                            const uriResult = await Filesystem.getUri({
                                directory: Directory.Cache,
                                path: fileName,
                            });
                            await Share.share({
                                title: `Sully Backup (${mode})`,
                                files: [uriResult.uri],
                            });
                        } catch (nativeErr) {
                            console.log("Native share skipped/failed", nativeErr);
                        }
                    } else {
                        // Auto-copy to clipboard on web
                        try {
                            await navigator.clipboard.writeText(json);
                            addToast('已自动复制到剪贴板', 'success');
                        } catch (e) { console.error('Clipboard failed', e); }
                    }

                } catch (e: any) {
                    addToast(`导出失败: ${e.message}`, 'error');
                }
            }, 100);

        } catch (e: any) {
            addToast(`导出错误: ${e.message}`, 'error');
        }
    };

    const handleWebFileDownload = () => {
        const fileName = `Sully_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        webDownload(exportContent, fileName);
        addToast('已触发浏览器下载', 'success');
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            const json = ev.target?.result as string;
            if (importInputRef.current) importInputRef.current.value = '';

            if (!json) {
                addToast('文件内容为空', 'error');
                return;
            }

            try {
                addToast('正在解析数据...', 'info');
                await importSystem(json);
            } catch (err: any) {
                console.error(err);
                addToast(err.message || '恢复失败', 'error');
            }
        };

        reader.onerror = () => {
            addToast(`读取文件失败`, 'error');
            if (importInputRef.current) importInputRef.current.value = '';
        };

        reader.readAsText(file);
    };

    const confirmReset = () => {
        resetSystem();
        setShowResetConfirm(false);
    };

    // Realtime config save
    const handleSaveRealtimeConfig = () => {
        updateRealtimeConfig({
            ...realtimeConfig,
            weatherEnabled: rtWeatherEnabled,
            weatherApiKey: rtWeatherKey,
            weatherCity: rtWeatherCity,
            newsEnabled: rtNewsEnabled,
            newsProvider: rtNewsProvider,
            newsApiKey: rtNewsApiKey,
            notionEnabled: rtNotionEnabled,
            notionApiKey: rtNotionKey,
            notionDatabaseId: rtNotionDbId,
            feishuEnabled: rtFeishuEnabled,
            feishuAppId: rtFeishuAppId,
            feishuAppSecret: rtFeishuAppSecret,
            feishuBaseId: rtFeishuBaseId,
            feishuTableId: rtFeishuTableId,
            xhsEnabled: rtXhsEnabled,
            xhsMcpConfig: {
                enabled: rtXhsMcpEnabled,
                serverUrl: rtXhsMcpUrl,
                loggedInNickname: rtXhsNickname || undefined,
                loggedInUserId: rtXhsUserId || undefined,
                userXsecToken: realtimeConfig.xhsMcpConfig?.userXsecToken,
            },
            perceptionConfig: {
                visibilityThreshold: rtVisibilityThreshold,
                internalizationBias: rtInternalizationBias,
                frequencyPenalty: rtFrequencyPenalty,
                presencePenalty: rtPresencePenalty,
                batteryUrgencyThreshold: rtBatteryUrgencyThreshold,
                lateNightHour: rtLateNightHour
            }
        });
        addToast('感知配置已更新', 'success');
        setShowRealtimeModal(false);
    };

    const notifyTestToast = (message: string, type: 'success' | 'error' | 'info') => {
        if (testToastLockRef.current) return;
        testToastLockRef.current = true;
        addToast(message, type);
        setTimeout(() => { testToastLockRef.current = false; }, 2000);
    };

    const testWeatherApi = async () => {
        if (!rtWeatherKey) { notifyTestToast('❌ 天气连接失败：请先填写 API Key', 'error'); return; }
        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${rtWeatherCity}&appid=${rtWeatherKey}&units=metric&lang=zh_cn`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await safeResponseJson(res);
                notifyTestToast(`✅ 天气连接成功：${data.name} ${Math.round(data.main.temp)}°C`, 'success');
            } else { notifyTestToast(`❌ 天气连接失败：HTTP ${res.status}`, 'error'); }
        } catch (e: any) { notifyTestToast(`❌ 天气网络错误：${e.message}`, 'error'); }
    };

    const testNotionApi = async () => {
        if (!rtNotionKey || !rtNotionDbId) { notifyTestToast('❌ Notion 连接失败：请填写 Key 和 Database ID', 'error'); return; }
        try {
            const result = await NotionManager.testConnection(rtNotionKey, rtNotionDbId);
            notifyTestToast(result.success ? '✅ Notion 连接成功' : `❌ Notion 连接失败：${result.message}`, result.success ? 'success' : 'error');
        } catch (e: any) { notifyTestToast(`❌ Notion 网络错误：${e.message}`, 'error'); }
    };

    const testFeishuApi = async () => {
        if (!rtFeishuAppId || !rtFeishuAppSecret || !rtFeishuBaseId || !rtFeishuTableId) {
            notifyTestToast('❌ 飞书连接失败：请填写完整参数', 'error'); return;
        }
        try {
            const result = await FeishuManager.testConnection(rtFeishuAppId, rtFeishuAppSecret, rtFeishuBaseId, rtFeishuTableId);
            notifyTestToast(result.success ? '✅ 飞书连接成功' : `❌ 飞书连接失败：${result.message}`, result.success ? 'success' : 'error');
        } catch (e: any) { notifyTestToast(`❌ 飞书网络错误：${e.message}`, 'error'); }
    };

    const testXhsMcp = async () => {
        if (!rtXhsMcpUrl) { notifyTestToast('❌ 小红书 MCP 连接失败：请填写 MCP Server URL', 'error'); return; }
        try {
            const result = await XhsMcpClient.testConnection(rtXhsMcpUrl);
            if (result.connected) {
                const toolCount = result.tools?.length || 0;
                const tokenInfo = result.xsecToken ? ' | xsecToken 已获取' : '';
                const loginInfo = result.loggedIn
                    ? ` | 已登录 ${result.nickname || ''}${tokenInfo}`
                    : ' | ⚠️ 未登录，请先在浏览器中登录小红书';
                notifyTestToast(`✅ 小红书 MCP 连接成功：${toolCount} 个工具可用${loginInfo}`, 'success');
                if (result.nickname && !rtXhsNickname) setRtXhsNickname(result.nickname);
                if (result.userId && !rtXhsUserId) setRtXhsUserId(result.userId);
                updateRealtimeConfig({
                    ...realtimeConfig,
                    xhsEnabled: rtXhsEnabled,
                    xhsMcpConfig: {
                        enabled: rtXhsMcpEnabled,
                        serverUrl: rtXhsMcpUrl,
                        loggedInNickname: rtXhsNickname || result.nickname,
                        loggedInUserId: rtXhsUserId || result.userId,
                        userXsecToken: result.xsecToken || realtimeConfig.xhsMcpConfig?.userXsecToken,
                    }
                });
            } else { notifyTestToast(`❌ 小红书 MCP 连接失败：${result.error}`, 'error'); }
        } catch (e: any) { notifyTestToast(`❌ 小红书 MCP 网络错误：${e.message}`, 'error'); }
    };

    const testWebSearchApi = async () => {
        const providerName = rtNewsProvider === 'tavily' ? 'Tavily' : 'Brave';
        if (isTestingWebSearch) return;
        if (!rtNewsApiKey) { notifyTestToast(`❌ ${providerName} 连接失败：请先填写搜索 API Key`, 'error'); return; }
        setIsTestingWebSearch(true);
        try {
            const result = await SearchTool.search('today tech news', {
                engine: rtNewsProvider,
                apiKey: rtNewsApiKey,
                maxResults: 1
            });
            if (result.results.length > 0) notifyTestToast(`✅ ${providerName} 连接成功`, 'success');
            else notifyTestToast(`❌ ${providerName} 连接失败：未返回结果`, 'error');
        } catch (e: any) {
            notifyTestToast(`❌ ${providerName} 网络错误：${e.message}`, 'error');
        } finally {
            setIsTestingWebSearch(false);
        }
    };

    // Workspace export as zip (JSON bundle)
    const handleExportWorkspace = async () => {
        try {
            addToast('正在打包 Workspace...', 'info');
            const json = await exportSystem('data');
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NovaClaw_Workspace_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            addToast('Workspace 已导出', 'success');
        } catch (e: any) {
            addToast(`导出失败: ${e.message}`, 'error');
        }
    };

    return (
        <div className="h-full w-full bg-slate-50/50 flex flex-col font-light">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">系统设置</h1>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar pb-20">

                {/* 数据备份区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-blue-100 rounded-xl text-blue-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
                        </div>
                        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">备份与恢复</h2>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <button onClick={() => handleExport('data')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 relative overflow-hidden">
                            <div className="absolute top-0 right-0 px-1.5 py-0.5 bg-blue-100 text-[9px] text-blue-600 rounded-bl-lg font-bold">含配置</div>
                            <div className="p-2 bg-blue-50 rounded-full text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg></div>
                            <span>数据备份</span>
                        </button>
                        <button onClick={() => handleExport('media')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2">
                            <div className="p-2 bg-pink-50 rounded-full text-pink-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg></div>
                            <span>相册/素材备份</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 mb-4">
                        <div onClick={() => importInputRef.current?.click()} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 cursor-pointer hover:bg-emerald-50 hover:border-emerald-200">
                            <div className="p-2 bg-emerald-100 rounded-full text-emerald-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></div>
                            <span>导入/恢复备份</span>
                        </div>
                        <input type="file" ref={importInputRef} className="hidden" accept=".json" onChange={handleImport} />
                    </div>

                    <p className="text-[10px] text-slate-400 px-1 mb-4 leading-relaxed">
                        • <b>数据备份</b>: 包含角色、聊天、设置、API密钥和预设。体积小，推荐日常使用。<br />
                        • <b>相册备份</b>: 仅包含相册图片、壁纸等大型素材。<br />
                        • 请妥善保管包含 API 密钥的备份文件。
                    </p>

                    <button onClick={() => setShowResetConfirm(true)} className="w-full py-3 bg-red-50 border border-red-100 text-red-500 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                        格式化系统 (出厂设置)
                    </button>
                </section>

                {/* 用户档案区域 */}
                {/* <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-purple-100 rounded-xl text-purple-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            </div>
                            <h2 className="text-sm font-semibold text-slate-600 tracking-wider">我的档案 (关于我)</h2>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">真实姓名 / 称呼</label>
                            <input type="text" value={userProfile.name} onChange={(e) => updateUserProfile({ name: e.target.value })} placeholder="输入你的名字..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 focus:bg-white transition-all" />
                        </div>
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">设定 / 备忘</label>
                            <p className="text-[10px] text-slate-400 px-1 mb-2 leading-relaxed">提供给 AI 的全局系统级认知，例如：“我是一名大学生”、“请用简洁的语气回复”。</p>
                            <textarea value={userProfile.bio} onChange={(e) => updateUserProfile({ bio: e.target.value })} placeholder="设定你的角色或告诉 AI 关于你的一切..." className="w-full h-32 bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm text-slate-700 resize-none focus:bg-white transition-all" />
                        </div>
                    </div>
                </section> */}

                {/* AI 连接设置区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-emerald-100/50 rounded-xl text-emerald-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                                </svg>
                            </div>
                            <h2 className="text-sm font-semibold text-slate-600 tracking-wider">API 配置</h2>
                        </div>
                        <button onClick={() => setShowPresetModal(true)} className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">
                            保存为预设
                        </button>
                    </div>

                    {/* Presets List */}
                    {apiPresets.length > 0 && (
                        <div className="mb-4">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">我的预设 (Presets)</label>
                            <div className="flex gap-2 flex-wrap">
                                {apiPresets.map(preset => (
                                    <div key={preset.id} className="flex items-center bg-white border border-slate-200 rounded-lg pl-3 pr-1 py-1 shadow-sm">
                                        <span onClick={() => loadPreset(preset)} className="text-xs font-medium text-slate-600 cursor-pointer hover:text-primary mr-2">{preset.name}</span>
                                        <button onClick={() => removeApiPreset(preset.id)} className="p-1 rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        {/* API Source Selector */}
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">接口来源 (API Source)</label>
                            <select
                                value={localApiSource}
                                onChange={(e) => {
                                    const newSource = e.target.value as ApiSource;
                                    setLocalApiSource(newSource);
                                    const meta = API_SOURCE_REGISTRY[newSource];
                                    // Auto-fill URL with default if changed to an official source and URL is empty or was a previous default
                                    if (meta?.defaultBaseUrl) {
                                        const currentIsDefault = Object.values(API_SOURCE_REGISTRY).some(m => m.defaultBaseUrl === localUrl);
                                        if (!localUrl || currentIsDefault) {
                                            setLocalUrl(meta.defaultBaseUrl);
                                        }
                                    }
                                }}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm focus:bg-white transition-all appearance-none cursor-pointer"
                            >
                                {Object.entries(API_SOURCE_REGISTRY).map(([key, meta]) => (
                                    <option key={key} value={key}>{meta.label}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-400 mt-1 px-1">
                                {API_SOURCE_REGISTRY[localApiSource]?.description || ''}
                            </p>
                        </div>

                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                            <input type="text" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder={API_SOURCE_REGISTRY[localApiSource]?.placeholder || 'https://...'} className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
                        </div>

                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Key <span className="text-amber-500 lowercase">(SecretVault)</span></label>
                            <div className="relative">
                                <input type={showApiKey ? "text" : "password"} value={localKey} onChange={(e) => setLocalKey(e.target.value)} placeholder="sk-..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl pl-4 pr-12 py-2.5 text-sm font-mono focus:bg-white transition-all" />
                                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none">
                                    {showApiKey ?
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg> :
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                                    }
                                </button>
                            </div>
                        </div>

                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-1.5 pl-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                                <button onClick={fetchModels} disabled={isLoadingModels} className="text-[10px] text-primary font-bold">{isLoadingModels ? 'Fetching...' : '刷新模型列表'}</button>
                            </div>

                            <button
                                onClick={() => setShowModelModal(true)}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center active:bg-white transition-all shadow-sm"
                            >
                                <span className="truncate font-mono">{localModel || 'Select Model...'}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                            </button>
                        </div>

                        <div className="group pt-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">实体 Workspace 路径</label>
                            <input type="text" value={localWorkspacePath} onChange={(e) => setLocalWorkspacePath(e.target.value)} placeholder="例如: ~/NovaClaw/Workspace" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-xs font-mono focus:bg-white transition-all" />
                        </div>

                        <div className="group pt-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">实体相册路径</label>
                            <input type="text" value={localGalleryPath} onChange={(e) => setLocalGalleryPath(e.target.value)} placeholder="例如: ~/NovaClaw/Gallery" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-xs font-mono focus:bg-white transition-all" />
                            <p className="text-[10px] text-slate-400 mt-1.5 px-1">Gallery App 会直接映射此目录进行相册管理（增删改查与预览）。</p>
                        </div>

                        <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-slate-50/80">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-bold text-slate-600">用户档案状态</div>
                                    <div className="text-[10px] text-slate-400 mt-1">
                                        Agent_Soul.md：{agentSoulExists === null ? '检测中' : agentSoulExists ? '已配置' : '未发现'}
                                        <span className="mx-1">|</span>
                                        USER.md：{userProfileExists === null ? '检测中' : userProfileExists ? '已配置' : '未发现'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => openApp(AppID.User)}
                                    className="px-3 py-2 rounded-xl bg-white text-slate-600 text-[10px] font-bold border border-slate-200 hover:bg-slate-100"
                                >
                                    打开档案
                                </button>
                            </div>
                        </div>

                        {!Capacitor.isNativePlatform() && (
                            <div className="flex items-center justify-between p-3 bg-red-50/50 border border-red-100 rounded-xl mt-2">
                                <div>
                                    <div className="text-xs font-bold text-red-600 flex items-center gap-1">
                                        ⚠️ 允许全局物理文件探测 (高危)
                                    </div>
                                    <div className="text-[9px] text-red-500 mt-0.5 leading-tight">
                                        开启后 Agent 将能跳出 Workspace 访问电脑任意文件。<br />
                                        <span className="font-bold">仅限极客在 PC 模拟器下自驱探索时使用。</span>
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" checked={!!apiConfig.securityPolicy?.allowGlobalFileAccess} onChange={e => {
                                        const newPolicy = { ...(apiConfig.securityPolicy || { allowReadWorkspace: true, allowWriteWorkspace: true, allowReadExternal: true, allowNativeAPIs: true, notifyOnSensitive: true }), allowGlobalFileAccess: e.target.checked };
                                        updateApiConfig({ securityPolicy: newPolicy });
                                    }} className="sr-only peer" />
                                    <div className="w-9 h-5 bg-red-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
                                </label>
                            </div>
                        )}

                        <button onClick={handleSaveApi} disabled={isSavingApi} className={`w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-primary/20 transition-all mt-2 ${isSavingApi ? 'bg-primary/60' : 'bg-primary active:scale-95'}`}>
                            {statusMsg || (isSavingApi ? '同步中...' : '保存配置')}
                        </button>
                    </div>
                </section>

                {/* 文字转语音 (TTS) 服务区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-indigo-100 rounded-xl text-indigo-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                            </svg>
                        </div>
                        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">文本转语音 (TTS) 接口</h2>
                    </div>

                    <div className="space-y-4">
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">服务商</label>
                            <select
                                value={localTtsProvider}
                                onChange={(e) => setLocalTtsProvider(e.target.value as any)}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm focus:bg-white transition-all"
                            >
                                <option value="none">关闭 TTS</option>
                                <option value="minimax">MiniMax (高质量/云端)</option>
                                <option value="fish_speech">Fish Speech (本地/第三方)</option>
                            </select>
                        </div>

                        {localTtsProvider === 'minimax' && (
                            <div className="space-y-3 pt-2">
                                <div className="group">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">MiniMax API Key</label>
                                    <input type="password" value={localMinimaxKey} onChange={(e) => setLocalMinimaxKey(e.target.value)} placeholder="sk-..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2 text-sm font-mono focus:bg-white transition-all" />
                                </div>
                                <div className="group">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Group ID (可选)</label>
                                    <input type="text" value={localMinimaxGroup} onChange={(e) => setLocalMinimaxGroup(e.target.value)} placeholder="如果不需隔离群组资源则留空" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2 text-sm font-mono focus:bg-white transition-all" />
                                </div>
                            </div>
                        )}

                        {localTtsProvider === 'fish_speech' && (
                            <div className="space-y-3 pt-2">
                                <div className="group">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Fish Speech Base URL</label>
                                    <input type="text" value={localFishUrl} onChange={(e) => setLocalFishUrl(e.target.value)} placeholder="http://127.0.0.1:8080" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2 text-sm font-mono focus:bg-white transition-all" />
                                </div>
                                <div className="group">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">API Key (可选)</label>
                                    <input type="password" value={localFishKey} onChange={(e) => setLocalFishKey(e.target.value)} placeholder="如果无需鉴权则留空" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2 text-sm font-mono focus:bg-white transition-all" />
                                </div>
                            </div>
                        )}

                        <button onClick={handleSaveApi} disabled={isSavingApi} className="w-full py-2.5 mt-2 rounded-xl text-xs font-bold text-primary border border-primary/30 hover:bg-primary/5 active:scale-95 transition-all">
                            更新与保存接口配置
                        </button>
                    </div>
                </section>


                {/* 抽帧设置区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-pink-100/50 rounded-xl text-pink-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                            </svg>
                        </div>
                        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">视频/多模态设置</h2>
                    </div>

                    <div className="space-y-4">
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">抽帧数量 (Max Frames)</label>
                            <div className="flex items-center gap-3">
                                <input type="range" min="3" max="60" step="1" value={videoMaxFrames} onChange={(e) => setVideoMaxFrames(Number(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-pink-500" />
                                <span className="text-xs font-mono font-bold text-slate-500 w-8 text-right">{videoMaxFrames}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 px-1">调整发送视频时均匀提取的画面数量，设为 10-15 较为通用。</p>
                        </div>
                        <div className="group">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">视频理解兼容模式</label>
                            <select
                                value={videoProviderMode}
                                onChange={(e) => setVideoProviderMode(e.target.value as 'auto' | 'kimi' | 'volcengine' | 'gemini')}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm focus:bg-white transition-all"
                            >
                                <option value="auto">自动识别</option>
                                <option value="kimi">Kimi 优先</option>
                                <option value="volcengine">火山引擎优先</option>
                                <option value="gemini">Gemini 优先</option>
                            </select>
                            <p className="text-[10px] text-slate-400 mt-1 px-1">用于优先尝试各家原生视频输入格式，失败后自动回退抽帧。</p>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-pink-50/40 border border-pink-100 rounded-xl">
                            <div>
                                <div className="text-xs font-bold text-pink-600">先尝试原生视频输入</div>
                                <div className="text-[10px] text-pink-500 mt-0.5">关闭后会直接走抽帧分析。</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={videoNativeFirst} onChange={e => setVideoNativeFirst(e.target.checked)} className="sr-only peer" />
                                <div className="w-9 h-5 bg-pink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-500"></div>
                            </label>
                        </div>
                    </div>
                </section>

                {/* 实时感知配置区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-violet-100/50 rounded-xl text-violet-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                                </svg>
                            </div>
                            <h2 className="text-sm font-semibold text-slate-600 tracking-wider">实时感知</h2>
                        </div>
                        <button onClick={() => setShowRealtimeModal(true)} className="text-[10px] bg-violet-100 text-violet-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">
                            配置
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                        让 Agent 感知真实世界：天气、新闻热点、当前时间。Agent 可以根据天气关心你、聊聊最近的热点话题。
                    </p>
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <div className={`py-3 rounded-xl text-xs font-bold ${rtWeatherEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                            <div className="text-lg mb-1">{rtWeatherEnabled ? '☀️' : '🌫️'}</div>天气
                        </div>
                        <div className={`py-3 rounded-xl text-xs font-bold ${rtNewsEnabled ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                            <div className="text-lg mb-1">{rtNewsEnabled ? '📰' : '📄'}</div>新闻
                        </div>
                        <div className={`py-3 rounded-xl text-xs font-bold ${rtNotionEnabled ? 'bg-orange-50 text-orange-600' : 'bg-slate-50 text-slate-400'}`}>
                            <div className="text-lg mb-1">{rtNotionEnabled ? '📝' : '📋'}</div>Notion
                        </div>
                        <div className={`py-3 rounded-xl text-xs font-bold ${rtFeishuEnabled ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400'}`}>
                            <div className="text-lg mb-1">{rtFeishuEnabled ? '📒' : '📋'}</div>飞书
                        </div>
                    </div>
                </section>

                {/* Workspace 导出区域 */}
                <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-cyan-100 rounded-xl text-cyan-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
                        </div>
                        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">Workspace 导出</h2>
                    </div>
                    <button onClick={handleExportWorkspace} className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 border border-cyan-300 rounded-xl text-xs font-bold text-white shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2">
                        <div className="p-2 bg-white/20 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg></div>
                        <span>导出 NovaClaw Workspace</span>
                    </button>
                    <p className="text-[10px] text-slate-400 px-1 mt-3 text-center">导出包含 Agent 配置、记忆、聊天记录、主题等所有 Workspace 数据</p>
                </section>

                <div className="text-center text-[10px] text-slate-300 pb-8 font-mono tracking-widest uppercase">
                    v2.0 (Realtime Awareness)
                </div>
            </div>

            {/* 模型选择 Modal */}
            <Modal isOpen={showModelModal} title="选择或输入模型" onClose={() => setShowModelModal(false)}>
                <div className="p-1 space-y-3">
                    {/* 手动输入区域 - 即使列表拉取失败也能用 */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">手动输入模型 ID</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={localModel}
                                onChange={(e) => setLocalModel(e.target.value)}
                                placeholder="如: ep-20250215... 或 gpt-4o"
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
                            如果拉取列表失败（如火山引擎/CORS问题），请直接在此输入模型 ID。<br />
                            火山引擎请填Endpoint ID (ep-xxxx)。
                        </p>
                    </div>

                    <div className="max-h-[40vh] overflow-y-auto no-scrollbar space-y-2">
                        {availableModels.length > 0 ? availableModels.map(m => (
                            <button key={m} onClick={() => { setLocalModel(m); setShowModelModal(false); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono flex justify-between items-center ${m === localModel ? 'bg-primary/10 text-primary font-bold ring-1 ring-primary/20' : 'bg-white border border-slate-100 text-slate-600 hover:bg-slate-50'}`}>
                                <span className="truncate">{m}</span>
                                {m === localModel && <div className="w-2 h-2 rounded-full bg-primary"></div>}
                            </button>
                        )) : (
                            <div className="text-center text-slate-400 py-4 text-xs">
                                未检测到在线模型列表，请上方手动输入。
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Preset Name Modal */}
            <Modal isOpen={showPresetModal} title="保存预设" onClose={() => setShowPresetModal(false)} footer={<button onClick={handleSavePreset} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存</button>}>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">预设名称 (例如: DeepSeek)</label>
                    <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} className="w-full bg-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-primary" autoFocus placeholder="Name..." />
                </div>
            </Modal>

            {/* 强制导出 Modal */}
            <Modal isOpen={showExportModal} title="备份数据" onClose={() => setShowExportModal(false)} footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => { navigator.clipboard.writeText(exportContent); addToast('已复制', 'success'); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">复制 JSON</button>
                    {Capacitor.isNativePlatform() ? (
                        <div className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
                            <span>已尝试唤起分享</span>
                        </div>
                    ) : (
                        <button onClick={handleWebFileDownload} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                            下载文件
                        </button>
                    )}
                </div>
            }>
                <div className="space-y-2">
                    <p className="text-[10px] text-slate-500">数据已生成。如果自动分享未触发，请点击下方按钮。</p>
                    <textarea value={exportContent} readOnly className="w-full h-40 bg-slate-100 rounded-xl p-3 text-[10px] font-mono text-slate-500 resize-none focus:outline-none" onClick={(e) => e.currentTarget.select()} />
                </div>
            </Modal>

            {/* 确认重置 Modal */}
            <Modal
                isOpen={showResetConfirm}
                title="系统警告"
                onClose={() => setShowResetConfirm(false)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button>
                        <button onClick={confirmReset} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认格式化</button>
                    </div>
                }
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                    <p className="text-center text-sm text-slate-600 font-medium">
                        这将<span className="text-red-500 font-bold">永久删除</span>所有角色、聊天记录和设置，且无法恢复！
                    </p>
                </div>
            </Modal>

            {/* 实时感知配置 Modal */}
            <Modal
                isOpen={showRealtimeModal}
                title="实时感知配置"
                onClose={() => setShowRealtimeModal(false)}
                footer={<button onClick={handleSaveRealtimeConfig} className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg">保存配置</button>}
            >
                <div className="space-y-5 max-h-[60vh] overflow-y-auto no-scrollbar">
                    {/* 天气配置 */}
                    <div className="bg-emerald-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">☀️</span>
                                <span className="text-sm font-bold text-emerald-700">天气感知</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={rtWeatherEnabled} onChange={e => setRtWeatherEnabled(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>
                        {rtWeatherEnabled && (
                            <div className="space-y-2">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">OpenWeatherMap API Key</label>
                                    <input type="password" value={rtWeatherKey} onChange={e => setRtWeatherKey(e.target.value)} className="w-full bg-white/80 border border-emerald-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="获取: openweathermap.org" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">城市 (英文)</label>
                                    <input type="text" value={rtWeatherCity} onChange={e => setRtWeatherCity(e.target.value)} className="w-full bg-white/80 border border-emerald-200 rounded-xl px-3 py-2 text-sm" placeholder="Beijing, Shanghai, etc." />
                                </div>
                                <button onClick={testWeatherApi} className="w-full py-2 bg-emerald-100 text-emerald-600 text-xs font-bold rounded-xl active:scale-95 transition-transform">测试天气API</button>
                            </div>
                        )}
                    </div>

                    {/* 新闻配置 */}
                    <div className="bg-blue-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">📰</span>
                                <span className="text-sm font-bold text-blue-700">新闻热点</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={rtNewsEnabled} onChange={e => setRtNewsEnabled(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                            </label>
                        </div>
                        {rtNewsEnabled && (
                            <div className="space-y-2">
                                <p className="text-xs text-blue-600/70">支持 Brave / Tavily，未配置时回退 Hacker News。</p>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setRtNewsProvider('brave')} className={`px-3 py-1 rounded-full text-[11px] font-bold ${rtNewsProvider === 'brave' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200'}`}>Brave</button>
                                    <button onClick={() => setRtNewsProvider('tavily')} className={`px-3 py-1 rounded-full text-[11px] font-bold ${rtNewsProvider === 'tavily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200'}`}>Tavily</button>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">{rtNewsProvider === 'tavily' ? 'Tavily API Key' : 'Brave Search API Key'}</label>
                                    <input type="password" value={rtNewsApiKey} onChange={e => setRtNewsApiKey(e.target.value)} className="w-full bg-white/80 border border-blue-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder={rtNewsProvider === 'tavily' ? 'tvly-...' : '获取: brave.com/search/api'} />
                                </div>
                                <button onClick={testWebSearchApi} disabled={isTestingWebSearch} className={`w-full py-2 text-xs font-bold rounded-xl transition-transform ${isTestingWebSearch ? 'bg-blue-50 text-blue-300' : 'bg-blue-100 text-blue-600 active:scale-95'}`}>{isTestingWebSearch ? '测试中...' : '测试联网搜索'}</button>
                            </div>
                        )}
                    </div>

                    {/* Notion 配置 */}
                    <div className="bg-orange-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2"><span className="text-lg">📝</span><span className="text-sm font-bold text-orange-700">Notion 日记</span></div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={rtNotionEnabled} onChange={e => setRtNotionEnabled(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                            </label>
                        </div>
                        {rtNotionEnabled && (
                            <div className="space-y-2">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Notion Integration Token</label>
                                    <input type="password" value={rtNotionKey} onChange={e => setRtNotionKey(e.target.value)} className="w-full bg-white/80 border border-orange-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="secret_..." />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Database ID</label>
                                    <input type="text" value={rtNotionDbId} onChange={e => setRtNotionDbId(e.target.value)} className="w-full bg-white/80 border border-orange-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="从数据库URL复制" />
                                </div>
                                <button onClick={testNotionApi} className="w-full py-2 bg-orange-100 text-orange-600 text-xs font-bold rounded-xl active:scale-95 transition-transform">测试Notion连接</button>
                            </div>
                        )}
                    </div>

                    {/* 飞书配置 */}
                    <div className="bg-indigo-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2"><span className="text-lg">📒</span><span className="text-sm font-bold text-indigo-700">飞书日记</span><span className="text-[9px] bg-indigo-100 text-indigo-500 px-1.5 py-0.5 rounded-full">中国区</span></div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={rtFeishuEnabled} onChange={e => setRtFeishuEnabled(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                            </label>
                        </div>
                        {rtFeishuEnabled && (
                            <div className="space-y-2">
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">飞书 App ID</label>
                                    <input type="text" value={rtFeishuAppId} onChange={e => setRtFeishuAppId(e.target.value)} className="w-full bg-white/80 border border-indigo-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="cli_xxxxxxxx" /></div>
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">飞书 App Secret</label>
                                    <input type="password" value={rtFeishuAppSecret} onChange={e => setRtFeishuAppSecret(e.target.value)} className="w-full bg-white/80 border border-indigo-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="xxxxxxxxxxxxxxxx" /></div>
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">多维表格 App Token</label>
                                    <input type="text" value={rtFeishuBaseId} onChange={e => setRtFeishuBaseId(e.target.value)} className="w-full bg-white/80 border border-indigo-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="从多维表格URL中获取" /></div>
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">数据表 Table ID</label>
                                    <input type="text" value={rtFeishuTableId} onChange={e => setRtFeishuTableId(e.target.value)} className="w-full bg-white/80 border border-indigo-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="tblxxxxxxxx" /></div>
                                <button onClick={testFeishuApi} className="w-full py-2 bg-indigo-100 text-indigo-600 text-xs font-bold rounded-xl active:scale-95 transition-transform">测试飞书连接</button>
                            </div>
                        )}
                    </div>

                    {/* 小红书 MCP */}
                    <div className="bg-red-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">📕</span>
                                <span className="text-sm font-bold text-red-700">小红书 MCP</span>
                                <span className="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">浏览器自动化</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={rtXhsMcpEnabled} onChange={e => { setRtXhsMcpEnabled(e.target.checked); setRtXhsEnabled(e.target.checked); }} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                            </label>
                        </div>
                        <p className="text-[10px] text-red-500/70 leading-relaxed">
                            通过 MCP Server（浏览器自动化）操作小红书。角色可以搜索、浏览、发帖、评论。
                        </p>
                        {rtXhsMcpEnabled && (
                            <div className="space-y-2">
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">MCP Server URL</label>
                                    <input value={rtXhsMcpUrl} onChange={e => setRtXhsMcpUrl(e.target.value)} className="w-full bg-white/80 border border-red-200 rounded-xl px-3 py-2 text-[11px] font-mono" placeholder="http://localhost:18060/mcp" /></div>
                                <button onClick={testXhsMcp} className="w-full py-2 bg-red-100 text-red-600 text-xs font-bold rounded-xl active:scale-95 transition-transform">测试 MCP 连接</button>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">小红书昵称</label>
                                        <input value={rtXhsNickname} onChange={e => setRtXhsNickname(e.target.value)} className="w-full bg-white/80 border border-red-200 rounded-xl px-3 py-2 text-[11px]" placeholder="手动填写（MCP检测可能不准）" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">用户 ID</label>
                                        <input value={rtXhsUserId} onChange={e => setRtXhsUserId(e.target.value)} className="w-full bg-white/80 border border-red-200 rounded-xl px-3 py-2 text-[11px] font-mono" placeholder="可选，用于查看主页" />
                                    </div>
                                </div>
                                <p className="text-[10px] text-red-500/70 leading-relaxed">
                                    需要部署 xiaohongshu-mcp 并保持登录。昵称和用户ID用于查看主页功能。MCP 自动检测可能不准，建议手动校验。
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 感知引擎 2.0 深度调参 */}
                    <div className="bg-slate-100/80 p-5 rounded-2xl space-y-4 border border-slate-200 shadow-inner">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">⚙️</span>
                            <span className="text-sm font-bold text-slate-700">感知引擎 2.0 深度调参 (Soul Tuning)</span>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight">基于数学权重与重复惩罚控制环境感知的"内敛度"。灵感源自 SillyTavern 参数体系。</p>

                        <div className="space-y-4 pt-2">
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>感知阈值 (Perception Threshold)</span>
                                    <span className="text-primary font-mono">{rtVisibilityThreshold.toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.05" value={rtVisibilityThreshold} onChange={e => setRtVisibilityThreshold(parseFloat(e.target.value))} className="w-full accent-primary appearance-none h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                                <p className="text-[9px] text-slate-400 italic">越高越内敛：只有极端情况或高度相关话题才会触发显式表达。</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>内化权重 (Internalization Bias)</span>
                                    <span className="text-primary font-mono">{rtInternalizationBias.toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.05" value={rtInternalizationBias} onChange={e => setRtInternalizationBias(parseFloat(e.target.value))} className="w-full accent-violet-500 appearance-none h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                                <p className="text-[9px] text-slate-400 italic">越高越倾向于潜意识：感知到的信息更多地转化为语气暗示，而非直接播报。</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>频率惩罚 (Frequency Penalty)</span>
                                    <span className="text-primary font-mono">{rtFrequencyPenalty.toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.05" value={rtFrequencyPenalty} onChange={e => setRtFrequencyPenalty(parseFloat(e.target.value))} className="w-full accent-emerald-500 appearance-none h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                                <p className="text-[9px] text-slate-400 italic">防止复读机：如果 Agent刚提过环境信息，短时间内再次提及的概率将大幅下降。</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>存在惩罚 (Presence Penalty)</span>
                                    <span className="text-primary font-mono">{rtPresencePenalty.toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.05" value={rtPresencePenalty} onChange={e => setRtPresencePenalty(parseFloat(e.target.value))} className="w-full accent-blue-500 appearance-none h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                                <p className="text-[9px] text-slate-400 italic">防止纠缠：提过一次后，其权重将持续受抑，鼓励聊点别的。</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>低电紧急阈值 (Battery Urgency)</span>
                                    <span className="text-primary font-mono">{rtBatteryUrgencyThreshold}%</span>
                                </div>
                                <input type="range" min="5" max="40" step="1" value={rtBatteryUrgencyThreshold} onChange={e => setRtBatteryUrgencyThreshold(parseInt(e.target.value, 10))} className="w-full accent-amber-500 appearance-none h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                                <p className="text-[9px] text-slate-400 italic">越高越容易在电量偏低时触发关怀提醒，越低则更克制。</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 pl-1">
                                    <span>深夜起算时间 (Late Night Hour)</span>
                                    <span className="text-primary font-mono">{rtLateNightHour}:00</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[20, 21, 22, 23, 0, 1, 2].map(h => (
                                        <button key={h} onClick={() => setRtLateNightHour(h)} className={`py-1.5 rounded-lg text-[10px] font-bold ${rtLateNightHour === h ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>{h}:00</button>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-400 italic">用于判断“深夜/熬夜”语境，从该时刻后提高时间维度紧迫度。</p>
                            </div>
                        </div>
                    </div>

                </div>
            </Modal>

        </div>
    );
};

export default Settings;
