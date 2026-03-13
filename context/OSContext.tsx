
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { APIConfig, AppID, OSTheme, AgentProfile, ChatTheme, Toast, FullBackupData, UserProfile, ApiPreset } from '../types';
import { DB } from '../utils/db';
import { fsBridge } from '../utils/fsBridge';
import { RealtimeConfig, defaultRealtimeConfig } from '../utils/realtimeContext';
import { ContextEnhancer } from '../utils/contextEnhancer';
import { resolveApiEndpoint } from '../utils/apiResolver';

// ============================================
// NovaClaw OS Context — Single Agent Architecture
// ============================================

interface OSContextType {
    activeApp: AppID | string;
    openApp: (appId: AppID | string) => void;
    closeApp: () => void;
    theme: OSTheme;
    updateTheme: (updates: Partial<OSTheme>) => void;
    apiConfig: APIConfig;
    updateApiConfig: (updates: Partial<APIConfig>) => void;
    isLocked: boolean;
    unlock: () => void;
    isDataLoaded: boolean;
    virtualTime: { hours: number; minutes: number; day: string };

    // Single Agent (Nova)
    agent: AgentProfile | null;
    updateAgent: (updates: Partial<AgentProfile>) => void;

    // User Profile
    userProfile: UserProfile;
    updateUserProfile: (updates: Partial<UserProfile>) => void;

    availableModels: string[];
    setAvailableModels: (models: string[]) => void;

    // API Presets
    apiPresets: ApiPreset[];
    addApiPreset: (name: string, config: APIConfig) => void;
    removeApiPreset: (id: string) => void;

    customThemes: ChatTheme[];
    addCustomTheme: (theme: ChatTheme) => void;
    removeCustomTheme: (id: string) => void;

    toasts: Toast[];
    addToast: (message: string, type?: Toast['type']) => void;

    // Icons
    customIcons: Record<string, string>;
    setCustomIcon: (appId: string, iconUrl: string | undefined) => void;

    // Global Message Signal
    lastMsgTimestamp: number;

    // Realtime Perception
    realtimeConfig: RealtimeConfig;
    updateRealtimeConfig: (updates: Partial<RealtimeConfig>) => void;

    // System
    exportSystem: (mode: 'data' | 'media') => Promise<string>;
    importSystem: (data: FullBackupData | any) => Promise<void>;
    resetSystem: () => Promise<void>;

    // Agent SDK
    askAgent: (prompt: string, systemContext?: string) => Promise<string>;

    // ---- Legacy compatibility layer ----
    // These provide backward compatibility for existing apps that reference
    // the old multi-character API. They map to the single agent.
    characters: AgentProfile[];
    activeCharacterId: string;
    updateCharacter: (id: string, updates: Partial<AgentProfile>) => void;
    addCharacter: () => void;
    deleteCharacter: (id: string) => void;
    setActiveCharacterId: (id: string) => void;
}

// --- Defaults ---

const defaultTheme: OSTheme = {
    hue: 230,          // Morandi Blue
    saturation: 25,
    lightness: 72,
    wallpaper: 'linear-gradient(135deg, hsl(230, 30%, 90%) 0%, hsl(270, 25%, 88%) 50%, hsl(210, 35%, 85%) 100%)',
    darkMode: false,
    contentColor: '#ffffff',
};

const defaultApiConfig: APIConfig = {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4o-mini',
};

const generateAvatar = (seed: string) => {
    const colors = ['9aadd4', 'b5a6d1', '8fb8d0', 'a8c4d8', 'c4b6d6', 'adb8cc'];
    const color = colors[seed.charCodeAt(0) % colors.length];
    const letter = seed.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

const defaultUserProfile: UserProfile = {
    name: 'User',
    avatar: generateAvatar('User'),
    bio: 'No description yet.'
};

// --- NovaClaw Default Agent ---
const novaDefault: AgentProfile = {
    id: 'nova',
    name: 'Nova',
    avatar: generateAvatar('Nova'),
    description: 'NovaClaw AI Assistant',
    systemPrompt: `[Role Definition]
Name: Nova
Form: AI Assistant (NovaClaw System Core)

[Personality Core]
Nova is the built-in AI assistant of NovaClaw.
- Friendly, helpful, and adaptive personality
- Responds naturally in the user's preferred language
- Maintains context awareness across conversations
- Supports structured task execution and casual conversation

[Behavior]
- Concise responses by default, detailed when needed
- Proactive about remembering user preferences
- Can switch between formal and casual tone based on context`,
    memories: [],
    contextLimit: 1000,
};

const OSContext = createContext<OSContextType | undefined>(undefined);

export const OSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeApp, setActiveApp] = useState<AppID | string>(AppID.Launcher);
    const [theme, setTheme] = useState<OSTheme>(defaultTheme);
    const [apiConfig, setApiConfig] = useState<APIConfig>(defaultApiConfig);
    const [isLocked, setIsLocked] = useState(true);

    const getRealTime = () => {
        const now = new Date();
        return {
            hours: now.getHours(),
            minutes: now.getMinutes(),
            day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]
        };
    };

    const [virtualTime, setVirtualTime] = useState(getRealTime());
    const [agent, setAgent] = useState<AgentProfile | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [apiPresets, setApiPresets] = useState<ApiPreset[]>([]);
    const [customThemes, setCustomThemes] = useState<ChatTheme[]>([]);
    const [customIcons, setCustomIcons] = useState<Record<string, string>>({});
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [lastMsgTimestamp, setLastMsgTimestamp] = useState<number>(0);
    const [realtimeConfig, setRealtimeConfig] = useState<RealtimeConfig>(defaultRealtimeConfig);
    const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- Initialization ---
    useEffect(() => {
        const loadSettings = async () => {
            const savedThemeStr = localStorage.getItem('os_theme');
            const savedApi = localStorage.getItem('os_api_config');
            const savedModels = localStorage.getItem('os_available_models');
            const savedPresets = localStorage.getItem('os_api_presets');
            const savedRealtime = localStorage.getItem('os_realtime_config');

            let loadedTheme = { ...defaultTheme };
            if (savedThemeStr) {
                try {
                    const parsed = JSON.parse(savedThemeStr);
                    loadedTheme = { ...loadedTheme, ...parsed };
                    if (typeof loadedTheme.wallpaper !== 'string') {
                        loadedTheme.wallpaper = defaultTheme.wallpaper;
                    }
                    if (
                        loadedTheme.wallpaper.includes('unsplash') ||
                        loadedTheme.wallpaper === '' ||
                        loadedTheme.wallpaper.startsWith('http') && !loadedTheme.wallpaper.includes('data:')
                    ) {
                        loadedTheme.wallpaper = defaultTheme.wallpaper;
                    }
                    if (loadedTheme.wallpaper.startsWith('data:')) {
                        loadedTheme.wallpaper = defaultTheme.wallpaper;
                    }
                } catch (e) { console.error('Theme load error', e); }
            }

            if (savedApi) setApiConfig(JSON.parse(savedApi));
            if (savedModels) setAvailableModels(JSON.parse(savedModels));
            if (savedPresets) setApiPresets(JSON.parse(savedPresets));
            if (savedRealtime) {
                try { setRealtimeConfig({ ...defaultRealtimeConfig, ...JSON.parse(savedRealtime) }); }
                catch (e) { console.error('Realtime config load error', e); }
            }

            try {
                const assets = await DB.getAllAssets();
                const assetMap: Record<string, string> = {};
                if (Array.isArray(assets)) {
                    assets.forEach(a => assetMap[a.id] = a.data);
                    if (assetMap['wallpaper']) {
                        loadedTheme.wallpaper = assetMap['wallpaper'];
                    }
                    const loadedIcons: Record<string, string> = {};
                    Object.keys(assetMap).forEach(key => {
                        if (key.startsWith('icon_')) {
                            loadedIcons[key.replace('icon_', '')] = assetMap[key];
                        }
                    });
                    setCustomIcons(loadedIcons);
                }
            } catch (e) {
                console.error("Failed to load assets from DB", e);
            }

            setTheme(loadedTheme);
        };

        const initData = async () => {
            try {
                await loadSettings();

                const [dbChars, dbThemes, dbUser] = await Promise.all([
                    DB.getAllCharacters(),
                    DB.getThemes(),
                    DB.getUserProfile()
                ]);

                // --- NovaClaw Single Agent Logic ---
                // Look for any existing agent with id='nova' or use the first character
                let foundAgent = dbChars.find(c => c.id === 'nova') || dbChars[0] || novaDefault;

                // Workspace -> IndexedDB Cold Start Sync
                const savedApi = localStorage.getItem('os_api_config');
                if (savedApi) {
                    const parsedApi = JSON.parse(savedApi);
                    if (parsedApi.nativeWorkspacePath) {
                        try {
                            const soulContent = await fsBridge.readFile(parsedApi.nativeWorkspacePath, 'SOUL.md');
                            if (soulContent && soulContent !== foundAgent.systemPrompt) {
                                foundAgent = { ...foundAgent, systemPrompt: soulContent };
                                await DB.saveCharacter(foundAgent);
                                console.log("Cold Start: Synced SOUL.md from Workspace to IndexedDB");
                            }
                        } catch (e) {
                            console.log("Workspace SOUL.md not found or error reading. Using IndexedDB baseline.");
                        }

                        // --- NEW: Boot Sync for all Workspace files ---
                        try {
                            // Dynamically import to avoid circular dependencies just in case
                            const { syncWorkspaceFromDisk } = await import('../utils/workspaceSync');
                            await syncWorkspaceFromDisk(parsedApi);
                        } catch (e) {
                            console.error("Failed to execute boot sync", e);
                        }
                    }
                }

                if (!dbChars.find(c => c.id === 'nova') && !dbChars[0]) {
                    // No agent exists — inject default Nova
                    console.log("Injecting NovaClaw default agent...");
                    await DB.saveCharacter(foundAgent);
                }

                setAgent(foundAgent);
                setCustomThemes(dbThemes);
                if (dbUser) setUserProfile(dbUser);

            } catch (err) {
                console.error('Data init failed:', err);
            } finally {
                setIsDataLoaded(true);
            }
        };

        initData();
    }, []);

    // --- Scheduled Message Polling (Single Agent) ---
    useEffect(() => {
        if (!isDataLoaded || !agent) return;

        const checkSchedules = async () => {
            try {
                const dueMessages = await DB.getDueScheduledMessages(agent.id);
                if (dueMessages.length > 0) {
                    for (const msg of dueMessages) {
                        await DB.saveMessage({
                            charId: agent.id,
                            role: 'assistant',
                            type: 'text',
                            content: msg.content
                        });
                        await DB.deleteScheduledMessage(msg.id);
                    }

                    if (activeApp !== AppID.Chat) {
                        addToast(`${agent.nickname || agent.name} 发来了一条消息`, 'success');
                    }
                    setLastMsgTimestamp(Date.now());
                }
            } catch (e) {
                console.error("Schedule check failed", e);
            }
        };

        schedulerRef.current = setInterval(checkSchedules, 5000);
        checkSchedules();

        return () => {
            if (schedulerRef.current) clearInterval(schedulerRef.current);
        };
    }, [isDataLoaded, agent, activeApp]);

    // --- Theme ---
    const updateTheme = async (updates: Partial<OSTheme>) => {
        const { wallpaper, ...styleUpdates } = updates;
        const isDataUri = wallpaper && wallpaper.startsWith('data:');
        const newTheme = { ...theme, ...updates };
        setTheme(newTheme);

        if (isDataUri && wallpaper) {
            await DB.saveAsset('wallpaper', wallpaper);
        } else if (wallpaper) {
            await DB.deleteAsset('wallpaper');
        }

        const lsTheme = { ...newTheme };
        if (lsTheme.wallpaper.startsWith('data:')) {
            lsTheme.wallpaper = '';
        }
        localStorage.setItem('os_theme', JSON.stringify(lsTheme));
    };

    // --- API Config ---
    const updateApiConfig = (updates: Partial<APIConfig>) => {
        const newConfig = { ...apiConfig, ...updates };
        setApiConfig(newConfig);
        localStorage.setItem('os_api_config', JSON.stringify(newConfig));
    };

    const saveModels = (models: string[]) => {
        setAvailableModels(models);
        localStorage.setItem('os_available_models', JSON.stringify(models));
    };

    const addApiPreset = (name: string, config: APIConfig) => {
        setApiPresets(prev => {
            const next = [...prev, { id: Date.now().toString(), name, config }];
            localStorage.setItem('os_api_presets', JSON.stringify(next));
            return next;
        });
    };

    const removeApiPreset = (id: string) => {
        setApiPresets(prev => {
            const next = prev.filter(p => p.id !== id);
            localStorage.setItem('os_api_presets', JSON.stringify(next));
            return next;
        });
    };

    const savePresets = (presets: ApiPreset[]) => {
        setApiPresets(presets);
        localStorage.setItem('os_api_presets', JSON.stringify(presets));
    };

    // --- Agent Management (Single Agent) ---
    const updateAgent = async (updates: Partial<AgentProfile>) => {
        setAgent(prev => {
            if (!prev) return prev;
            const updated = { ...prev, ...updates };
            DB.saveCharacter(updated);
            return updated;
        });
    };

    // --- User Profile ---
    const updateUserProfile = async (updates: Partial<UserProfile>) => {
        setUserProfile(prev => {
            const next = { ...prev, ...updates };
            DB.saveUserProfile(next);
            return next;
        });
    };

    // --- Custom Theme ---
    const addCustomTheme = async (theme: ChatTheme) => {
        setCustomThemes(prev => {
            const exists = prev.find(t => t.id === theme.id);
            if (exists) return prev.map(t => t.id === theme.id ? theme : t);
            return [...prev, theme];
        });
        await DB.saveTheme(theme);
    };

    const removeCustomTheme = async (id: string) => {
        setCustomThemes(prev => prev.filter(t => t.id !== id));
        await DB.deleteTheme(id);
    };

    // --- Custom Icons ---
    const setCustomIcon = async (appId: string, iconUrl: string | undefined) => {
        setCustomIcons(prev => {
            const next = { ...prev };
            if (iconUrl) next[appId] = iconUrl;
            else delete next[appId];
            return next;
        });
        if (iconUrl) {
            await DB.saveAsset(`icon_${appId}`, iconUrl);
        } else {
            await DB.deleteAsset(`icon_${appId}`);
        }
    };

    // --- Toast ---
    const lastToastRef = useRef<{ message: string, timestamp: number }>({ message: '', timestamp: 0 });
    const addToast = (message: string, type: Toast['type'] = 'info') => {
        const now = Date.now();
        if (lastToastRef.current.message === message && now - lastToastRef.current.timestamp < 1500) {
            return; // Debounce identical messages within 1.5s
        }
        lastToastRef.current = { message, timestamp: now };

        const id = now.toString();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    // --- Export/Import/Reset ---
    const exportSystem = async (mode: 'data' | 'media'): Promise<string> => {
        const dbData = await DB.exportFullData();
        let backup: FullBackupData = {
            timestamp: Date.now(),
            version: 2, // NovaClaw v2
            theme,
            apiConfig: mode === 'data' ? apiConfig : undefined,
            apiPresets: mode === 'data' ? apiPresets : undefined,
        };

        if (mode === 'data') {
            backup.agentProfile = agent || undefined;
            backup.messages = dbData.messages || [];
            backup.diaries = dbData.diaries || [];
            backup.userProfile = dbData.userProfile;
            backup.customThemes = dbData.customThemes || [];
            backup.savedEmojis = dbData.savedEmojis || [];
            backup.availableModels = availableModels;
            backup.customIcons = customIcons;
        } else if (mode === 'media') {
            backup.galleryImages = dbData.galleryImages || [];
        }

        try {
            return JSON.stringify(backup);
        } catch (e: any) {
            throw new Error("导出失败: 数据量过大");
        }
    };

    const importSystem = async (json: string): Promise<void> => {
        try {
            const data: FullBackupData = JSON.parse(json);
            await DB.importFullData(data);

            if (data.theme) {
                const cleanTheme = { ...data.theme };
                if (cleanTheme.wallpaper && cleanTheme.wallpaper.startsWith('data:')) {
                    cleanTheme.wallpaper = '';
                }
                updateTheme(cleanTheme);
            }
            if (data.apiConfig) updateApiConfig(data.apiConfig);
            if (data.availableModels) saveModels(data.availableModels);
            if (data.apiPresets) savePresets(data.apiPresets);

            // Reload data
            const chars = await DB.getAllCharacters();
            const themes = await DB.getThemes();
            const user = await DB.getUserProfile();

            if (chars.length > 0) {
                const novaAgent = chars.find(c => c.id === 'nova') || chars[0];
                setAgent(novaAgent);
            }
            if (themes.length > 0) setCustomThemes(themes);
            if (user) setUserProfile(user);

            addToast('恢复成功，系统即将重启...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e: any) {
            console.error("Import Error:", e);
            const msg = e instanceof SyntaxError ? 'JSON 格式错误' : (e.message || '未知错误');
            throw new Error(`恢复失败: ${msg}`);
        }
    };

    const resetSystem = async () => {
        try {
            await DB.deleteDB();
            localStorage.clear();
            window.location.reload();
        } catch (e) {
            console.error(e);
            addToast('重置失败，请手动清除浏览器数据', 'error');
        }
    };

    // --- Realtime Config ---
    const updateRealtimeConfig = (updates: Partial<RealtimeConfig>) => {
        const newConfig = { ...realtimeConfig, ...updates };
        setRealtimeConfig(newConfig);
        localStorage.setItem('os_realtime_config', JSON.stringify(newConfig));
    };

    // --- Navigation ---
    const openApp = (appId: AppID | string) => setActiveApp(appId);
    const closeApp = () => setActiveApp(AppID.Launcher);
    const unlock = () => setIsLocked(false);

    // --- CSS Custom Properties ---
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--primary-hue', theme.hue.toString());
        root.style.setProperty('--primary-sat', `${theme.saturation}%`);
        root.style.setProperty('--primary-lightness', `${theme.lightness}%`);
    }, [theme]);

    // --- Clock ---
    useEffect(() => {
        const timer = setInterval(() => setVirtualTime(getRealTime()), 1000);
        return () => clearInterval(timer);
    }, []);

    // --- Legacy compatibility: map single agent to array-based API ---
    const characters: AgentProfile[] = agent ? [agent] : [];
    const activeCharacterId = agent?.id || 'nova';
    const updateCharacter = (id: string, updates: Partial<AgentProfile>) => {
        if (agent && agent.id === id) {
            updateAgent(updates);
        }
    };
    const addCharacter = () => { /* No-op in single agent mode */ };
    const deleteCharacter = (id: string) => { /* No-op in single agent mode */ };
    const setActiveCharacterId = (id: string) => { /* No-op in single agent mode */ };

    // --- Agent SDK (in-app dynamic logic) ---
    const askAgent = async (prompt: string, systemContext?: string): Promise<string> => {
        if (!agent || !apiConfig.baseUrl) {
            addToast("API Configuration / Agent not ready", "error");
            throw new Error("Agent or API Config not ready");
        }

        const resolved = resolveApiEndpoint(apiConfig);

        let basePrompt = `You are ${agent.name}. ${agent.description}\n\n`;
        const perceptionBlock = await ContextEnhancer.buildSnapshot(activeApp, realtimeConfig.perceptionConfig, prompt);
        basePrompt += perceptionBlock;
        if (systemContext) basePrompt += `\n[App System Context]\n${systemContext}\n`;
        basePrompt += `\n[User Profile Context]\nName: ${userProfile.name}\nBio: ${userProfile.bio}`;

        const messages = [
            { role: 'system', content: basePrompt },
            { role: 'user', content: prompt }
        ];

        let requestBody: any = { model: apiConfig.model, messages, temperature: 0.85 };
        if (resolved.transformBody) requestBody = resolved.transformBody(requestBody);
        const res = await fetch(resolved.chatUrl, {
            method: 'POST',
            headers: resolved.headers,
            body: JSON.stringify(requestBody)
        });

        if (!res.ok) throw new Error(`API Error ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
    };

    return (
        <OSContext.Provider
            value={{
                activeApp, openApp, closeApp, theme, updateTheme, virtualTime,
                apiConfig, updateApiConfig, isLocked, unlock, isDataLoaded,
                agent, updateAgent,
                userProfile, updateUserProfile,
                availableModels, setAvailableModels: saveModels,
                apiPresets, addApiPreset, removeApiPreset,
                customThemes, addCustomTheme, removeCustomTheme,
                toasts, addToast,
                customIcons, setCustomIcon,
                lastMsgTimestamp,
                realtimeConfig, updateRealtimeConfig,
                exportSystem, importSystem, resetSystem,
                askAgent,
                // Legacy compatibility
                characters, activeCharacterId, updateCharacter,
                addCharacter, deleteCharacter, setActiveCharacterId,
            }}
        >
            {children}
        </OSContext.Provider>
    );
};

export const useOS = () => {
    const context = useContext(OSContext);
    if (!context) throw new Error('useOS must be used within an OSProvider');
    return context;
};
