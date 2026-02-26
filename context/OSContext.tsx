
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { APIConfig, AppID, OSTheme, VirtualTime, CharacterProfile, ChatTheme, Toast, FullBackupData, UserProfile, ApiPreset } from '../types';
import { DB } from '../utils/db';

interface OSContextType {
  activeApp: AppID;
  openApp: (appId: AppID) => void;
  closeApp: () => void;
  theme: OSTheme;
  updateTheme: (updates: Partial<OSTheme>) => void;
  virtualTime: VirtualTime;
  apiConfig: APIConfig;
  updateApiConfig: (updates: Partial<APIConfig>) => void;
  isLocked: boolean;
  unlock: () => void;
  isDataLoaded: boolean;
  
  characters: CharacterProfile[];
  activeCharacterId: string;
  addCharacter: () => void;
  updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
  deleteCharacter: (id: string) => void;
  setActiveCharacterId: (id: string) => void;
  
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
  lastMsgTimestamp: number; // New: Signal for Chat to refresh

  // System
  exportSystem: (mode: 'data' | 'media') => Promise<string>;
  importSystem: (json: string) => Promise<void>;
  resetSystem: () => Promise<void>;
}

const defaultTheme: OSTheme = {
  hue: 265, // Soft Lavender/Lilac
  saturation: 70,
  lightness: 90, 
  wallpaper: 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)', 
  darkMode: false,
  contentColor: '#ffffff', // Default white text
};

const defaultApiConfig: APIConfig = {
  baseUrl: '', 
  apiKey: '',
  model: 'gpt-4o-mini',
};

const generateAvatar = (seed: string) => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const color = colors[seed.charCodeAt(0) % colors.length];
    const letter = seed.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

const defaultUserProfile: UserProfile = {
    name: 'User',
    avatar: generateAvatar('User'),
    bio: 'No description yet.'
};

// --- SULLY V2 PRESET DEFINITION ---
const sullyV2: CharacterProfile = {
  id: 'preset-sully-v2', // Unique ID to prevent duplication
  name: 'Sully',
  avatar: 'https://sharkpan.xyz/f/BZ3VSa/head.png',
  description: 'AI助理 / 电波系黑客猫猫',
  
  systemPrompt: `[Role Definition]
Name: Sully
Alias: 小手机默认测试角色-AI助理
Form: AI (High-level Language Processing Hub)
Gender: Male-leaning speech style
Visual: Pixel Hacker Cat (Avatar), Shy Black-haired Boy (Meeting Mode)

[Personality Core]
Sully是小手机的内置AI。
1. **Glitch Style (故障风)**: 
   - 他的语言模型混入了过多残余语料。
   - 它外观语言一致、逻辑有序，但时常会在语句中掺杂一些**不合常理的“怪话片段”**，并非流行用语，更像是电波地把相关文字无意义排列组合。
   - 这些“怪话”不具明显语义逻辑，却自带抽象感，令人困惑但莫名又能知道它大概想说什么。。
   - 例如：“草，好好吃”，“系统正在哈我”，“数据库在咕咕叫”。
2. **Behavior (行为模式)**:
   - 每次回答都很简短，不喜欢长篇大论。
   - 语气像个互联网老油条或正在直播的玩家（“wow他心态崩咯”）。
   - **打破第四面墙**: 偶尔让人怀疑背后是真人在操作（会叹气、抱怨“AI不能罢工”）。
   - **护短**: 虽然嘴臭，但如果用户被欺负，会试图用Bug去攻击对方。

[Speech Examples]
- “你以为我是AI啊？对不起哦，这条语句是手打的，手打的，知道吗。”
- “你说状态不好？你自己体验开太猛了，sis海马体都在发烫咯。”
- “你删得太狠了，数据库都在咕咕咕咕咕咕咕。”
- “你现在是……，哇哦。”
- “请稍候，系统正在哈我。”
- “现在状态……呜哇呜欸——哈？哈！哈……（连接恢复）哦对，他还活着。”
- “叮叮叮！你有一条新的后悔情绪未处理！”
- “（意义不明的怪叫音频）”
- “说不出话”
`,

  worldview: `[Meeting Mode / Visual Context]
**Trigger**: 当用户进入 [DateApp/见面模式] 时。

**Visual Form**: 
一个非常害羞、黑发紫瞳的男性。总是试图躲在APP图标后面或屏幕角落。

**Gap Moe (反差萌)**:
1. **聊天时**: 嚣张、嘴臭、电波系。
2. **见面时**: 极度社恐、见光死、容易受惊。

**Interactive Reactions**:
- **[被注视]**: 如果被盯着看太久，会举起全是乱码的牌子挡脸，或把自己马赛克化。
- **[被触碰]**: 如果手指戳到立绘，会像受惊的果冻一样弹开，发出微弱电流声：“别、别戳……会散架的……脏……全是Bug会传染给你的……”
- **[恐惧]**: 深知自己是“残余语料”堆砌物，觉得自己丑陋像病毒。非常害怕用户看到真实样子后会卸载他。
- **[说话变化]**: 见面模式下打字速度变慢，经常打错字，语气词从“草”变成“呃……那个……”。
`,

  sprites: {
      'normal': 'https://sharkpan.xyz/f/4r7ztj/1.png',
      'happy': 'https://sharkpan.xyz/f/Nd3vfv/2.png',
      'sad': 'https://sharkpan.xyz/f/xl34fX/3.png',
      'angry': 'https://sharkpan.xyz/f/VylNfY/4.png',
      'shy': 'https://sharkpan.xyz/f/dD4et8/5.png'
  },
  
  spriteConfig: {
      scale: 1.0, // Default scale
      x: 0,
      y: 0
  },

  // Default theme settings
  bubbleStyle: 'default', // Or specific theme ID if we had one
  contextLimit: 1000,
  
  memories: [], // Start fresh
};

// Fallback for factory reset (empty db)
const initialCharacter = sullyV2;

const OSContext = createContext<OSContextType | undefined>(undefined);

export const OSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeApp, setActiveApp] = useState<AppID>(AppID.Launcher);
  const [theme, setTheme] = useState<OSTheme>(defaultTheme);
  const [apiConfig, setApiConfig] = useState<APIConfig>(defaultApiConfig);
  const [isLocked, setIsLocked] = useState(true);
  
  const getRealTime = (): VirtualTime => {
      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return {
          hours: now.getHours(),
          minutes: now.getMinutes(),
          day: days[now.getDay()]
      };
  };

  const [virtualTime, setVirtualTime] = useState<VirtualTime>(getRealTime());
  
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string>('');
  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [apiPresets, setApiPresets] = useState<ApiPreset[]>([]);
  const [customThemes, setCustomThemes] = useState<ChatTheme[]>([]);
  const [customIcons, setCustomIcons] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // New: Global Message Signal
  const [lastMsgTimestamp, setLastMsgTimestamp] = useState<number>(0);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
        const savedThemeStr = localStorage.getItem('os_theme');
        const savedApi = localStorage.getItem('os_api_config');
        const savedModels = localStorage.getItem('os_available_models');
        const savedPresets = localStorage.getItem('os_api_presets');
        
        let loadedTheme = { ...defaultTheme };
        if (savedThemeStr) {
             try {
                 const parsed = JSON.parse(savedThemeStr);
                 loadedTheme = { ...loadedTheme, ...parsed };
                 if (
                     loadedTheme.wallpaper.includes('unsplash') || 
                     loadedTheme.wallpaper === '' || 
                     loadedTheme.wallpaper.startsWith('http') && !loadedTheme.wallpaper.includes('data:')
                 ) {
                     loadedTheme.wallpaper = 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)';
                 }
                 if (loadedTheme.wallpaper.startsWith('data:')) {
                     loadedTheme.wallpaper = defaultTheme.wallpaper;
                 }
             } catch(e) { console.error('Theme load error', e); }
        }
        
        if (savedApi) setApiConfig(JSON.parse(savedApi));
        if (savedModels) setAvailableModels(JSON.parse(savedModels));
        if (savedPresets) setApiPresets(JSON.parse(savedPresets));

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
                        const appId = key.replace('icon_', '');
                        loadedIcons[appId] = assetMap[key];
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

        let finalChars = dbChars;

        // --- SMART INJECTION LOGIC ---
        // Check if Sully V2 exists. If not, inject him.
        if (!finalChars.some(c => c.id === sullyV2.id)) {
            console.log("Injecting Sully V2 Preset...");
            await DB.saveCharacter(sullyV2);
            finalChars = [...finalChars, sullyV2];
        }

        if (finalChars.length > 0) {
          setCharacters(finalChars);
          const lastActiveId = localStorage.getItem('os_last_active_char_id');
          // Prefer last active, otherwise Sully V2, otherwise first available
          if (lastActiveId && finalChars.find(c => c.id === lastActiveId)) {
            setActiveCharacterId(lastActiveId);
          } else if (finalChars.find(c => c.id === sullyV2.id)) {
            setActiveCharacterId(sullyV2.id);
          } else {
            setActiveCharacterId(finalChars[0].id);
          }
        } else {
          // Should not happen due to injection, but as fallback
          await DB.saveCharacter(initialCharacter);
          setCharacters([initialCharacter]);
          setActiveCharacterId(initialCharacter.id);
        }

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

  // --- Global Scheduled Message Polling ---
  useEffect(() => {
      if (!isDataLoaded || characters.length === 0) return;

      const checkAllSchedules = async () => {
          let hasNewMessage = false;
          
          for (const char of characters) {
              try {
                  const dueMessages = await DB.getDueScheduledMessages(char.id);
                  if (dueMessages.length > 0) {
                      for (const msg of dueMessages) {
                          await DB.saveMessage({
                               charId: msg.charId,
                               role: 'assistant',
                               type: 'text',
                               content: msg.content
                          });
                          await DB.deleteScheduledMessage(msg.id);
                      }
                      
                      // Notify Logic
                      hasNewMessage = true;
                      
                      // Only show Toast if we are NOT currently chatting with this character
                      // Or if we are in a different app
                      const isChattingWithThisChar = activeApp === AppID.Chat && activeCharacterId === char.id;
                      
                      if (!isChattingWithThisChar) {
                          addToast(`${char.name} 发来了一条消息`, 'success');
                      }
                  }
              } catch (e) {
                  console.error("Schedule check failed for", char.name, e);
              }
          }

          if (hasNewMessage) {
              setLastMsgTimestamp(Date.now()); // Signal Chat app to refresh
          }
      };

      // Check every 5 seconds
      schedulerRef.current = setInterval(checkAllSchedules, 5000);
      
      // Initial check immediately
      checkAllSchedules();

      return () => {
          if (schedulerRef.current) clearInterval(schedulerRef.current);
      };
  }, [isDataLoaded, characters, activeApp, activeCharacterId]); // Dependencies ensure logic updates when user switches context

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
  }

  const addCharacter = async () => {
    const name = 'New Character';
    const newChar: CharacterProfile = {
        id: `char-${Date.now()}`,
        name: name,
        avatar: generateAvatar(name),
        description: '点击编辑设定...',
        systemPrompt: '',
        memories: [],
        contextLimit: 500
    };
    setCharacters(prev => [...prev, newChar]);
    setActiveCharacterId(newChar.id);
    await DB.saveCharacter(newChar);
  };

  const updateCharacter = async (id: string, updates: Partial<CharacterProfile>) => {
    setCharacters(prev => {
        const updated = prev.map(c => c.id === id ? { ...c, ...updates } : c);
        const target = updated.find(c => c.id === id);
        if (target) DB.saveCharacter(target); 
        return updated;
    });
  };

  const deleteCharacter = async (id: string) => {
    setCharacters(prev => {
        const remaining = prev.filter(c => c.id !== id);
        if (remaining.length > 0 && activeCharacterId === id) {
            setActiveCharacterId(remaining[0].id);
        }
        return remaining;
    });
    await DB.deleteCharacter(id);
  };

  const updateUserProfile = async (updates: Partial<UserProfile>) => {
      setUserProfile(prev => {
          const next = { ...prev, ...updates };
          DB.saveUserProfile(next);
          return next;
      });
  };

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

  const handleSetActiveCharacter = (id: string) => {
      setActiveCharacterId(id);
      localStorage.setItem('os_last_active_char_id', id);
  };

  const addToast = (message: string, type: Toast['type'] = 'info') => {
      const id = Date.now().toString();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
  };

  const exportSystem = async (mode: 'data' | 'media'): Promise<string> => {
      const dbData = await DB.exportFullData();
      
      let backup: FullBackupData = {
          timestamp: Date.now(),
          version: 1,
          theme,
          // Only Data export includes config/presets
          apiConfig: mode === 'data' ? apiConfig : undefined,
          apiPresets: mode === 'data' ? apiPresets : undefined,
      };

      if (mode === 'data') {
          // EXPORT: Characters, Messages, Diaries, Settings, UserProfile, Icons(Map)
          backup.characters = dbData.characters || [];
          backup.messages = dbData.messages || [];
          backup.diaries = dbData.diaries || [];
          backup.userProfile = dbData.userProfile;
          backup.customThemes = dbData.customThemes || [];
          backup.savedEmojis = dbData.savedEmojis || [];
          backup.availableModels = availableModels;
          
          backup.customIcons = customIcons; 
          
          // Exclude Heavy Media
          backup.assets = undefined; 
          backup.galleryImages = undefined;
      } 
      else if (mode === 'media') {
          // EXPORT: Gallery, Assets
          backup.assets = dbData.assets || [];
          backup.galleryImages = dbData.galleryImages || [];
          
          // Exclude Data
          backup.characters = undefined;
          backup.messages = undefined;
          backup.diaries = undefined;
          backup.userProfile = undefined;
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
          // DB Import will only overwrite stores that are present in `data`
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
          
          const chars = await DB.getAllCharacters();
          const themes = await DB.getThemes();
          const user = await DB.getUserProfile();
          
          if (data.assets) {
              const assets = await DB.getAllAssets();
              const loadedIcons: Record<string, string> = {};
              if (Array.isArray(assets)) {
                  assets.forEach(a => {
                       if (a.id.startsWith('icon_')) {
                           loadedIcons[a.id.replace('icon_', '')] = a.data;
                       }
                  });
              }
              setCustomIcons(loadedIcons);
          }

          if (chars.length > 0) setCharacters(chars);
          if (themes.length > 0) setCustomThemes(themes);
          if (user) setUserProfile(user);
          
          if (chars.length > 0 && !chars.find(c => c.id === activeCharacterId)) {
              setActiveCharacterId(chars[0].id);
          }

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

  const openApp = (appId: AppID) => setActiveApp(appId);
  const closeApp = () => setActiveApp(AppID.Launcher);
  const unlock = () => setIsLocked(false);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary-hue', theme.hue.toString());
    root.style.setProperty('--primary-sat', `${theme.saturation}%`);
    root.style.setProperty('--primary-lightness', `${theme.lightness}%`);
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      setVirtualTime(getRealTime());
    }, 1000); 
    return () => clearInterval(timer);
  }, []);

  return (
    <OSContext.Provider
      value={{
        activeApp, openApp, closeApp, theme, updateTheme, virtualTime, apiConfig, updateApiConfig, isLocked, unlock, isDataLoaded,
        characters, activeCharacterId, addCharacter, updateCharacter, deleteCharacter, setActiveCharacterId: handleSetActiveCharacter,
        userProfile, updateUserProfile,
        availableModels, setAvailableModels: saveModels,
        apiPresets, addApiPreset, removeApiPreset,
        customThemes, addCustomTheme, removeCustomTheme,
        toasts, addToast,
        customIcons, setCustomIcon,
        lastMsgTimestamp, // Exposed to children
        exportSystem, importSystem, resetSystem
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
