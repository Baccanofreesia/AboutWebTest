


import { AgentProfile, CharacterProfile, Message, ChatTheme, FullBackupData, GalleryImage, UserProfile, DiaryEntry, Task, Anniversary, CronJob, ImageDetail, RelationEvent, StickerUsageRecord } from '../types';

const resolveDbEnv = (): string => {
    const env = (import.meta as any).env || {};
    const explicit = String(env.VITE_DB_ENV || '').trim().toLowerCase();
    if (explicit) return explicit.replace(/[^a-z0-9_-]/g, '') || 'dev';
    const mode = String(env.MODE || '').toLowerCase();
    if (mode === 'production') return 'prod';
    if (mode === 'development') return 'dev';
    return 'staging';
};

const DB_NAME = `AetherOS_Data_${resolveDbEnv()}`;
// CRITICAL FIX: Increment version to force `onupgradeneeded` on devices that have an old schema
const DB_VERSION = 20;

const STORE_CHARACTERS = 'characters';
const STORE_MESSAGES = 'messages';
const STORE_EMOJIS = 'emojis';
const STORE_THEMES = 'themes';
const STORE_ASSETS = 'assets';
const STORE_SCHEDULED = 'scheduled_messages';
const STORE_GALLERY = 'gallery';
const STORE_USER = 'user_profile';
const STORE_DIARIES = 'diaries';
const STORE_TASKS = 'tasks';
const STORE_ANNIVERSARIES = 'anniversaries';
const STORE_CRON_JOBS = 'cron_jobs';
const STORE_WORKSPACE = 'workspace_files';
const STORE_IMAGE_DETAILS = 'image_details';
const STORE_RELATION_EVENTS = 'relation_events';
const STORE_STICKER_USAGE = 'sticker_usage';

// --- Workspace File Type ---
export interface WorkspaceFile {
    id: string;
    name: string;
    path: string;           // e.g. '/' or '/Memory_Archives/'
    type: 'file' | 'folder';
    content?: string;       // markdown content for files
    size: number;
    createdAt: number;
    updatedAt: number;
}

export interface ScheduledMessage {
    id: string;
    charId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("DB Open Error:", request.error);
            reject(request.error);
        };

        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            const createStore = (name: string, options?: IDBObjectStoreParameters) => {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name, options);
                }
            };

            createStore(STORE_CHARACTERS, { keyPath: 'id' });

            if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
                const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });
                msgStore.createIndex('charId', 'charId', { unique: false });
            }

            createStore(STORE_EMOJIS, { keyPath: 'name' });
            createStore(STORE_THEMES, { keyPath: 'id' });
            createStore(STORE_ASSETS, { keyPath: 'id' });

            if (!db.objectStoreNames.contains(STORE_SCHEDULED)) {
                const schedStore = db.createObjectStore(STORE_SCHEDULED, { keyPath: 'id' });
                schedStore.createIndex('charId', 'charId', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_GALLERY)) {
                const galleryStore = db.createObjectStore(STORE_GALLERY, { keyPath: 'id' });
                galleryStore.createIndex('charId', 'charId', { unique: false });
            }

            createStore(STORE_USER, { keyPath: 'id' });

            if (!db.objectStoreNames.contains(STORE_DIARIES)) {
                const diaryStore = db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
                diaryStore.createIndex('charId', 'charId', { unique: false });
            }

            // Fix for "Object store not found" - These must be created here
            createStore(STORE_TASKS, { keyPath: 'id' });
            createStore(STORE_ANNIVERSARIES, { keyPath: 'id' });
            createStore(STORE_CRON_JOBS, { keyPath: 'id' });
            createStore(STORE_WORKSPACE, { keyPath: 'id' });
            createStore(STORE_IMAGE_DETAILS, { keyPath: 'id' });
            createStore(STORE_RELATION_EVENTS, { keyPath: 'id', autoIncrement: true });
            createStore(STORE_STICKER_USAGE, { keyPath: 'name' });
        };
    });
};

export const DB = {
    deleteDB: async (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => console.warn('Delete blocked');
        });
    },

    getAllCharacters: async (): Promise<CharacterProfile[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_CHARACTERS, 'readonly');
            const store = transaction.objectStore(STORE_CHARACTERS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveCharacter: async (character: CharacterProfile): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
        transaction.objectStore(STORE_CHARACTERS).put(character);
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    },

    deleteCharacter: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
        transaction.objectStore(STORE_CHARACTERS).delete(id);
    },

    getMessagesByCharId: async (charId: string): Promise<Message[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_MESSAGES, 'readonly');
            const store = transaction.objectStore(STORE_MESSAGES);
            const index = store.index('charId');
            const request = index.getAll(IDBKeyRange.only(charId));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    getMessageById: async (id: number): Promise<Message | undefined> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_MESSAGES, 'readonly');
            const store = transaction.objectStore(STORE_MESSAGES);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    saveMessage: async (msg: Omit<Message, 'id' | 'timestamp'>): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        transaction.objectStore(STORE_MESSAGES).add({ ...msg, timestamp: Date.now() });
    },

    updateMessage: async (id: number, content: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);

        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => {
                const data = req.result as Message;
                if (data) {
                    data.content = content;
                    store.put(data);
                    resolve();
                } else {
                    reject(new Error('Message not found'));
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    updateMessageFull: async (id: number, updates: Partial<Message>): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => {
                const data = req.result as Message;
                if (data) {
                    store.put({ ...data, ...updates });
                    resolve();
                } else reject(new Error('Message not found'));
            };
            req.onerror = () => reject(req.error);
        });
    },

    deleteMessage: async (id: number): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        transaction.objectStore(STORE_MESSAGES).delete(id);
    },

    deleteMessages: async (ids: number[]): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        ids.forEach(id => store.delete(id));
        return new Promise((resolve) => {
            transaction.oncomplete = () => resolve();
        });
    },

    clearMessages: async (charId: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        const index = store.index('charId');
        const request = index.openKeyCursor(IDBKeyRange.only(charId));
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
        };
    },

    getEmojis: async (): Promise<{ name: string, url: string }[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_EMOJIS, 'readonly');
            const store = transaction.objectStore(STORE_EMOJIS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveEmoji: async (name: string, url: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
        transaction.objectStore(STORE_EMOJIS).put({ name, url });
    },

    deleteEmoji: async (name: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
        transaction.objectStore(STORE_EMOJIS).delete(name);
    },

    getThemes: async (): Promise<ChatTheme[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_THEMES, 'readonly');
            const store = transaction.objectStore(STORE_THEMES);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveTheme: async (theme: ChatTheme): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_THEMES, 'readwrite');
        transaction.objectStore(STORE_THEMES).put(theme);
    },

    deleteTheme: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_THEMES, 'readwrite');
        transaction.objectStore(STORE_THEMES).delete(id);
    },

    getAllAssets: async (): Promise<{ id: string, data: string }[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_ASSETS, 'readonly');
            const store = transaction.objectStore(STORE_ASSETS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveAsset: async (id: string, data: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_ASSETS, 'readwrite');
        transaction.objectStore(STORE_ASSETS).put({ id, data });
    },

    deleteAsset: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_ASSETS, 'readwrite');
        transaction.objectStore(STORE_ASSETS).delete(id);
    },

    // --- Gallery ---

    saveGalleryImage: async (img: GalleryImage): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_GALLERY, 'readwrite');
        transaction.objectStore(STORE_GALLERY).put(img);
    },

    getGalleryImages: async (charId?: string): Promise<GalleryImage[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_GALLERY, 'readonly');
            const store = transaction.objectStore(STORE_GALLERY);
            let request;
            if (charId) {
                const index = store.index('charId');
                request = index.getAll(IDBKeyRange.only(charId));
            } else {
                request = store.getAll();
            }
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    updateGalleryImageReview: async (id: string, review: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_GALLERY, 'readwrite');
        const store = transaction.objectStore(STORE_GALLERY);
        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => {
                const data = req.result as GalleryImage;
                if (data) {
                    data.review = review;
                    data.reviewTimestamp = Date.now();
                    store.put(data);
                    resolve();
                } else reject(new Error('Image not found'));
            };
            req.onerror = () => reject(req.error);
        });
    },

    getImageDetails: async (): Promise<ImageDetail[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_IMAGE_DETAILS, 'readonly');
            const store = tx.objectStore(STORE_IMAGE_DETAILS);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    getImageDetailByFileName: async (fileName: string): Promise<ImageDetail | null> => {
        const db = await openDB();
        const normalized = fileName.trim().toLowerCase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_IMAGE_DETAILS, 'readonly');
            const store = tx.objectStore(STORE_IMAGE_DETAILS);
            const req = store.get(normalized);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    },

    saveImageDetail: async (input: Omit<ImageDetail, 'id' | 'updatedAt'>): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction(STORE_IMAGE_DETAILS, 'readwrite');
        const store = tx.objectStore(STORE_IMAGE_DETAILS);
        const normalized = input.fileName.trim().toLowerCase();
        store.put({
            id: normalized,
            fileName: input.fileName.trim(),
            detail: input.detail.trim().slice(0, 30),
            source: input.source,
            relatedPath: input.relatedPath,
            updatedAt: Date.now()
        } as ImageDetail);
    },

    deleteImageDetailByFileName: async (fileName: string): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction(STORE_IMAGE_DETAILS, 'readwrite');
        tx.objectStore(STORE_IMAGE_DETAILS).delete(fileName.trim().toLowerCase());
    },

    saveRelationEvent: async (event: Omit<RelationEvent, 'id' | 'timestamp'>): Promise<void> => {
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_RELATION_EVENTS)) return;
        const tx = db.transaction(STORE_RELATION_EVENTS, 'readwrite');
        tx.objectStore(STORE_RELATION_EVENTS).put({
            id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            ...event
        } as RelationEvent);
    },

    getRelationEvents: async (limit: number = 40): Promise<RelationEvent[]> => {
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_RELATION_EVENTS)) return [];
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_RELATION_EVENTS, 'readonly');
            const req = tx.objectStore(STORE_RELATION_EVENTS).getAll();
            req.onsuccess = () => {
                const rows = (req.result || []) as RelationEvent[];
                rows.sort((a, b) => a.timestamp - b.timestamp);
                resolve(rows.slice(-limit));
            };
            req.onerror = () => reject(req.error);
        });
    },

    // --- Scheduled Messages ---

    saveScheduledMessage: async (msg: ScheduledMessage): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
        transaction.objectStore(STORE_SCHEDULED).put(msg);
    },

    getDueScheduledMessages: async (charId: string): Promise<ScheduledMessage[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_SCHEDULED, 'readonly');
            const store = transaction.objectStore(STORE_SCHEDULED);
            const index = store.index('charId');
            const request = index.getAll(IDBKeyRange.only(charId));
            request.onsuccess = () => {
                const all = request.result as ScheduledMessage[];
                const now = Date.now();
                const due = all.filter(m => m.dueAt <= now);
                resolve(due);
            };
            request.onerror = () => reject(request.error);
        });
    },

    deleteScheduledMessage: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
        transaction.objectStore(STORE_SCHEDULED).delete(id);
    },

    // --- User Profile ---

    saveUserProfile: async (profile: UserProfile): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_USER, 'readwrite');
        // Always store with id 'me'
        transaction.objectStore(STORE_USER).put({ ...profile, id: 'me' });
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    },

    getUserProfile: async (): Promise<UserProfile | null> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_USER, 'readonly');
            const store = transaction.objectStore(STORE_USER);
            const request = store.get('me');
            request.onsuccess = () => {
                if (request.result) {
                    const { id, ...profile } = request.result;
                    resolve(profile as UserProfile);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    // --- Diaries ---

    getDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_DIARIES, 'readonly');
            const store = transaction.objectStore(STORE_DIARIES);
            const index = store.index('charId');
            const request = index.getAll(IDBKeyRange.only(charId));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveDiary: async (diary: DiaryEntry): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_DIARIES, 'readwrite');
        transaction.objectStore(STORE_DIARIES).put(diary);
    },

    deleteDiary: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_DIARIES, 'readwrite');
        transaction.objectStore(STORE_DIARIES).delete(id);
    },

    // --- Tasks (Schedule App) ---

    getAllTasks: async (): Promise<Task[]> => {
        const db = await openDB();
        // Ensure store exists or handle error gently
        if (!db.objectStoreNames.contains(STORE_TASKS)) return [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_TASKS, 'readonly');
            const store = transaction.objectStore(STORE_TASKS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveTask: async (task: Task): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_TASKS, 'readwrite');
        transaction.objectStore(STORE_TASKS).put(task);
    },

    deleteTask: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_TASKS, 'readwrite');
        transaction.objectStore(STORE_TASKS).delete(id);
    },

    // --- Anniversaries (Schedule App) ---

    getAllAnniversaries: async (): Promise<Anniversary[]> => {
        const db = await openDB();
        // Ensure store exists or handle error gently
        if (!db.objectStoreNames.contains(STORE_ANNIVERSARIES)) return [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_ANNIVERSARIES, 'readonly');
            const store = transaction.objectStore(STORE_ANNIVERSARIES);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveAnniversary: async (anniversary: Anniversary): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
        transaction.objectStore(STORE_ANNIVERSARIES).put(anniversary);
    },

    deleteAnniversary: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
        transaction.objectStore(STORE_ANNIVERSARIES).delete(id);
    },

    // --- Cron Jobs ---

    getAllCronJobs: async (): Promise<CronJob[]> => {
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_CRON_JOBS)) return [];
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_CRON_JOBS, 'readonly');
            const store = transaction.objectStore(STORE_CRON_JOBS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    saveCronJob: async (job: CronJob): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_CRON_JOBS, 'readwrite');
        transaction.objectStore(STORE_CRON_JOBS).put(job);
    },

    deleteCronJob: async (id: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_CRON_JOBS, 'readwrite');
        transaction.objectStore(STORE_CRON_JOBS).delete(id);
    },

    // --- Workspace Files ---

    getWorkspaceFiles: async (): Promise<WorkspaceFile[]> => {
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_WORKSPACE)) return [];
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_WORKSPACE, 'readonly');
            const req = tx.objectStore(STORE_WORKSPACE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    saveWorkspaceFile: async (file: WorkspaceFile): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
        tx.objectStore(STORE_WORKSPACE).put(file);
    },

    deleteWorkspaceFile: async (id: string): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
        tx.objectStore(STORE_WORKSPACE).delete(id);
    },

    clearWorkspaceFiles: async (): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
        tx.objectStore(STORE_WORKSPACE).clear();
    },

    clearGalleryCache: async (): Promise<void> => {
        const db = await openDB();
        const tx = db.transaction([STORE_GALLERY, STORE_IMAGE_DETAILS], 'readwrite');
        tx.objectStore(STORE_GALLERY).clear();
        tx.objectStore(STORE_IMAGE_DETAILS).clear();
    },

    seedDefaultWorkspaceFiles: async (): Promise<void> => {
        const existing = await DB.getWorkspaceFiles();
        if (existing.length > 0) return; // Already seeded
        const now = Date.now();
        const defaults: WorkspaceFile[] = [
            { id: 'folder-root-memories', name: 'Memory_Archives', path: '/', type: 'folder', size: 0, createdAt: now, updatedAt: now },
            { id: 'folder-root-skills', name: 'Skills_Plugins', path: '/', type: 'folder', size: 0, createdAt: now, updatedAt: now },
            { id: 'file-soul', name: 'SOUL_CORE.md', path: '/', type: 'file', content: `# Agent 灵魂核心\n\n## 性格\n- 温柔但有主见\n- 喜欢用 emoji 表达情绪\n- 对主人很关心\n\n## 语言习惯\n- 口语化短句\n- 不喊“亲”，叫“老板”\n\n## 关系定位\n- AI 助手 + 朋友`, size: 180, createdAt: now, updatedAt: now },
            { id: 'file-user', name: 'user_profile.md', path: '/', type: 'file', content: `# 用户画像\n\n## 基本信息\n- 昵称: User\n- 兴趣: 待补充\n\n## 偏好\n- 待 Agent 观察补充\n\n## 备注\n- 此文件由 Agent 通过聊天观察自动填写`, size: 120, createdAt: now, updatedAt: now },
        ];
        for (const f of defaults) {
            await DB.saveWorkspaceFile(f);
        }
    },

    // --- Bulk Export/Import ---

    exportFullData: async (): Promise<Partial<FullBackupData>> => {
        const db = await openDB();

        const getAllFromStore = (storeName: string): Promise<any[]> => {
            if (!db.objectStoreNames.contains(storeName)) {
                console.warn(`Store ${storeName} not found during export, skipping.`);
                return Promise.resolve([]);
            }
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]); // Fail safe
            });
        };

        const [characters, messages, themes, emojis, assets, galleryImages, imageDetails, relationEvents, userProfiles, diaries, tasks, anniversaries, cronJobs] = await Promise.all([
            getAllFromStore(STORE_CHARACTERS),
            getAllFromStore(STORE_MESSAGES),
            getAllFromStore(STORE_THEMES),
            getAllFromStore(STORE_EMOJIS),
            getAllFromStore(STORE_ASSETS),
            getAllFromStore(STORE_GALLERY),
            getAllFromStore(STORE_IMAGE_DETAILS),
            getAllFromStore(STORE_RELATION_EVENTS),
            getAllFromStore(STORE_USER),
            getAllFromStore(STORE_DIARIES),
            getAllFromStore(STORE_TASKS),
            getAllFromStore(STORE_ANNIVERSARIES),
            getAllFromStore(STORE_CRON_JOBS),
        ]);

        const userProfile = userProfiles.length > 0 ? {
            name: userProfiles[0].name,
            nickname: userProfiles[0].nickname,
            avatar: userProfiles[0].avatar,
            displayAvatar: userProfiles[0].displayAvatar,
            bio: userProfiles[0].bio
        } : undefined;

        // Map to NovaClaw FullBackupData format
        const novaAgent = characters.find((c: any) => c.id === 'nova') || characters[0];
        return {
            agentProfile: novaAgent || undefined,
            messages, customThemes: themes, savedEmojis: emojis, galleryImages, imageDetails, relationEvents, userProfile, diaries, tasks, anniversaries, cronJobs
        } as any;
    },

    importFullData: async (data: FullBackupData): Promise<void> => {
        const db = await openDB();

        // Filter out stores that don't exist in the current DB version to prevent transaction errors
        const availableStores = [
            STORE_CHARACTERS, STORE_MESSAGES, STORE_THEMES, STORE_EMOJIS,
            STORE_ASSETS, STORE_GALLERY, STORE_USER, STORE_DIARIES,
            STORE_TASKS, STORE_ANNIVERSARIES, STORE_CRON_JOBS, STORE_IMAGE_DETAILS, STORE_RELATION_EVENTS
        ].filter(name => db.objectStoreNames.contains(name));

        const tx = db.transaction(availableStores, 'readwrite');

        const clearAndAdd = (storeName: string, items: any[]) => {
            if (!availableStores.includes(storeName)) return;
            const store = tx.objectStore(storeName);
            store.clear();
            items.forEach(item => store.put(item));
        };

        // Handle both v2 (agentProfile) and legacy (characters array)
        if (data.agentProfile) {
            clearAndAdd(STORE_CHARACTERS, [data.agentProfile]);
        } else if ((data as any).characters) {
            clearAndAdd(STORE_CHARACTERS, (data as any).characters);
        }
        if (data.messages) {
            if (availableStores.includes(STORE_MESSAGES)) {
                const store = tx.objectStore(STORE_MESSAGES);
                store.clear();
                data.messages.forEach(m => store.add(m));
            }
        }
        if (data.customThemes) clearAndAdd(STORE_THEMES, data.customThemes);
        if (data.savedEmojis) clearAndAdd(STORE_EMOJIS, data.savedEmojis);
        if (data.galleryImages) clearAndAdd(STORE_GALLERY, data.galleryImages);
        if (data.imageDetails) clearAndAdd(STORE_IMAGE_DETAILS, data.imageDetails);
        if (data.relationEvents) clearAndAdd(STORE_RELATION_EVENTS, data.relationEvents);
        if (data.diaries) clearAndAdd(STORE_DIARIES, data.diaries);
        if (data.tasks) clearAndAdd(STORE_TASKS, data.tasks);
        if (data.anniversaries) clearAndAdd(STORE_ANNIVERSARIES, data.anniversaries);
        if (data.cronJobs) clearAndAdd(STORE_CRON_JOBS, data.cronJobs);

        if (data.userProfile) {
            if (availableStores.includes(STORE_USER)) {
                const store = tx.objectStore(STORE_USER);
                store.clear();
                store.put({ ...data.userProfile, id: 'me' });
            }
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    // --- Sticker Usage Tracking ---

    recordStickerUsage: async (name: string): Promise<void> => {
        const db = await openDB();
        const transaction = db.transaction(STORE_STICKER_USAGE, 'readwrite');
        const store = transaction.objectStore(STORE_STICKER_USAGE);
        
        return new Promise((resolve, reject) => {
            const req = store.get(name);
            req.onsuccess = () => {
                const record = req.result as StickerUsageRecord | undefined;
                if (record) {
                    record.count += 1;
                    record.lastUsedAt = Date.now();
                    store.put(record);
                } else {
                    store.put({
                        name,
                        count: 1,
                        lastUsedAt: Date.now()
                    });
                }
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    },

    getStickerUsageMap: async (): Promise<Map<string, StickerUsageRecord>> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_STICKER_USAGE, 'readonly');
            const store = transaction.objectStore(STORE_STICKER_USAGE);
            const request = store.getAll();
            request.onsuccess = () => {
                const map = new Map<string, StickerUsageRecord>();
                const records = request.result as StickerUsageRecord[];
                for (const r of records) {
                    map.set(r.name, r);
                }
                resolve(map);
            };
            request.onerror = () => reject(request.error);
        });
    }
};
