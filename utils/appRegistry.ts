/**
 * AppRegistry
 *
 * - Static built-in app metadata
 * - Dynamic app capability registry (agent-created apps) — disk-backed
 * - Two-stage deletion: trash (recoverable) → permanently deleted (tombstone)
 *
 * Storage:
 *   memory/indexes/apps/registry.json    — active + trashed apps
 *   memory/indexes/apps/tombstones.json  — permanently deleted (agent awareness)
 *
 * In-memory cache keeps reads synchronous; disk writes are async and fire-and-forget.
 */

import { INSTALLED_APPS } from '../constants';
import { fsBridge } from './fsBridge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AppInfo {
    id: string;
    name: string;
    description: string;
    capabilities?: string[];
}

export interface DynamicAppCapability {
    appId: string;
    description?: string;
    capabilities: string[];
    /** active = installed and callable; trashed = soft-deleted, recoverable */
    status: 'active' | 'trashed';
    createdAt: number;
    updatedAt: number;
    trashedAt?: number;
    trashedBy?: 'user' | 'agent' | 'system';
    trashReason?: string;
}

export interface DynamicAppTombstone {
    appId: string;
    /** Preserved so the agent knows what this app did */
    capabilities: string[];
    description?: string;
    deletedAt: number;
    deletedBy: 'user' | 'agent' | 'system';
    reason?: string;
    /** Was it soft-deleted first, or deleted directly? */
    permanentlyDeletedFrom: 'trash' | 'direct';
}

// ── Static metadata ────────────────────────────────────────────────────────────

const APP_DESCRIPTIONS: Record<string, string> = {
    chat: '聊天消息 - 和用户实时交流',
    checkphone: '查手机 - 手机内管理面板',
    schedule: '时光契约 - 纪念日和任务管理',
    journal: '交换日记 - 双向日记阅读/写入',
    date: '见面 - 场景互动',
    user: '个人档案 - 用户与 Agent 资料',
    gallery: '相册 - 图片/视频浏览与管理',
    thememaker: '气泡工坊 - 聊天气泡主题',
    appearance: '外观 - 壁纸与界面视觉',
    study: '自习室 - 学习辅助',
    freeroam: '自由活动 - 自由探索场景',
    xhs_stock: '小红书图库 - 发布素材管理',
    music: '音乐 - 播放控制',
    browser: '浏览器 - 网页搜索能力',
    settings: '设置 - API/权限/系统配置',
};

const APP_CAPABILITIES: Record<string, string[]> = {
    chat: ['send_message', 'send_media', 'call_control'],
    journal: ['read_diary', 'write_diary', 'list_diary'],
    gallery: ['list_gallery', 'read_gallery_item', 'upload_gallery_item'],
    schedule: ['list_task', 'update_task', 'list_anniversary'],
    xhs_stock: ['list_xhs_stock', 'add_xhs_stock', 'read_xhs_stock'],
    settings: ['read_config', 'update_config'],
    checkphone: ['open_panel', 'view_memory_summary'],
    browser: ['web_search'],
    study: ['view_study_state', 'update_study_state'],
    freeroam: ['xhs_browse', 'xhs_action'],
    date: ['scene_dialog'],
    user: ['read_profile', 'update_profile'],
    thememaker: ['read_theme', 'update_theme'],
    appearance: ['read_appearance', 'update_appearance'],
    music: ['play_music', 'pause_music'],
};

// ── Disk paths ─────────────────────────────────────────────────────────────────

const REGISTRY_PATH = 'memory/indexes/apps/registry.json';
const TOMBSTONE_PATH = 'memory/indexes/apps/tombstones.json';
const DEFAULT_DYNAMIC_CAPABILITIES = ['query_index', 'read_ref', 'search', 'resolve_file'];

// ── In-memory cache ────────────────────────────────────────────────────────────

interface AppRegistryCache {
    rootPath: string;
    allowGlobal: boolean;
    caps: DynamicAppCapability[];
    tombstones: DynamicAppTombstone[];
}

let _cache: AppRegistryCache | null = null;

const normalizeCapability = (capability: string): string =>
    String(capability || '').trim().toLowerCase();

// ── Disk I/O ───────────────────────────────────────────────────────────────────

const ensureDir = async (rootPath: string, allowGlobal: boolean) => {
    for (const dir of ['memory', 'memory/indexes', 'memory/indexes/apps']) {
        await fsBridge.createFolder(rootPath, dir, allowGlobal).catch(() => { });
    }
};

const persistToDisc = async () => {
    if (!_cache) return;
    const { rootPath, allowGlobal, caps, tombstones } = _cache;
    try {
        await ensureDir(rootPath, allowGlobal);
        await fsBridge.writeFile(
            rootPath, REGISTRY_PATH,
            JSON.stringify({ version: 1, updatedAt: Date.now(), apps: caps }, null, 2),
            allowGlobal,
        );
        await fsBridge.writeFile(
            rootPath, TOMBSTONE_PATH,
            JSON.stringify({ version: 1, updatedAt: Date.now(), tombstones }, null, 2),
            allowGlobal,
        );
    } catch (e) {
        console.warn('AppRegistry: failed to persist to disk', e);
    }
};

// ── Legacy localStorage migration (one-time) ──────────────────────────────────

const migrateFromLocalStorage = (): { caps: DynamicAppCapability[]; tombstones: DynamicAppTombstone[] } => {
    const LEGACY_CAPS_KEY = 'agent_app_capabilities_v1';
    const LEGACY_TOMBSTONE_KEY = 'agent_app_tombstones_v1';
    let caps: DynamicAppCapability[] = [];
    let tombstones: DynamicAppTombstone[] = [];
    try {
        const rawCaps = localStorage.getItem(LEGACY_CAPS_KEY);
        if (rawCaps) {
            const parsed = JSON.parse(rawCaps);
            if (Array.isArray(parsed)) {
                caps = parsed
                    .map((item: any): DynamicAppCapability => ({
                        appId: String(item?.appId || '').trim(),
                        description: item?.description ? String(item.description) : undefined,
                        capabilities: Array.isArray(item?.capabilities)
                            ? Array.from(new Set<string>((item.capabilities as any[]).map((x: any) => normalizeCapability(String(x || ''))).filter(Boolean)))
                            : [],
                        status: 'active',
                        createdAt: Number(item?.updatedAt) || Date.now(),
                        updatedAt: Number(item?.updatedAt) || Date.now(),
                    }))
                    .filter(x => !!x.appId);
            }
            localStorage.removeItem(LEGACY_CAPS_KEY);
        }
        const rawTombstones = localStorage.getItem(LEGACY_TOMBSTONE_KEY);
        if (rawTombstones) {
            const parsed = JSON.parse(rawTombstones);
            if (Array.isArray(parsed)) {
                tombstones = parsed
                    .map((item: any): DynamicAppTombstone => ({
                        appId: String(item?.appId || '').trim(),
                        capabilities: [],
                        deletedAt: Number(item?.deletedAt) || Date.now(),
                        deletedBy: item?.deletedBy === 'user' || item?.deletedBy === 'agent' ? item.deletedBy : 'system',
                        reason: item?.reason ? String(item.reason) : undefined,
                        permanentlyDeletedFrom: 'direct',
                    }))
                    .filter(x => !!x.appId);
            }
            localStorage.removeItem(LEGACY_TOMBSTONE_KEY);
        }
    } catch { /* ignore migration errors */ }
    return { caps, tombstones };
};

// ── Public API ─────────────────────────────────────────────────────────────────

export const AppRegistry = {

    /**
     * Load registry and tombstones from disk into the in-memory cache.
     * Should be called once on app startup from OSContext.
     * Also migrates any existing localStorage data automatically.
     */
    async initialize(rootPath: string, allowGlobal: boolean): Promise<void> {
        if (!rootPath) return;
        _cache = { rootPath, allowGlobal, caps: [], tombstones: [] };

        // Try loading from disk
        let diskCaps: DynamicAppCapability[] = [];
        let diskTombstones: DynamicAppTombstone[] = [];
        try {
            const raw = await fsBridge.readFile(rootPath, REGISTRY_PATH, allowGlobal);
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.apps)) diskCaps = parsed.apps;
        } catch { /* no file yet, start fresh */ }
        try {
            const raw = await fsBridge.readFile(rootPath, TOMBSTONE_PATH, allowGlobal);
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.tombstones)) diskTombstones = parsed.tombstones;
        } catch { /* no file yet */ }

        // Merge in any localStorage leftovers (one-time migration)
        const migrated = migrateFromLocalStorage();
        const diskIds = new Set(diskCaps.map(x => x.appId));
        for (const item of migrated.caps) {
            if (!diskIds.has(item.appId)) diskCaps.push(item);
        }
        const diskTombIds = new Set(diskTombstones.map(x => x.appId));
        for (const item of migrated.tombstones) {
            if (!diskTombIds.has(item.appId)) diskTombstones.push(item);
        }

        _cache.caps = diskCaps;
        _cache.tombstones = diskTombstones;

        // Persist merged state if migration produced data
        if (migrated.caps.length > 0 || migrated.tombstones.length > 0) {
            await persistToDisc();
        }
    },

    // ── Queries ────────────────────────────────────────────────────────────────

    getAll(): AppInfo[] {
        const apps: AppInfo[] = INSTALLED_APPS.map(app => ({
            id: String(app.id),
            name: app.name,
            description: APP_DESCRIPTIONS[String(app.id)] || app.name,
            capabilities: APP_CAPABILITIES[String(app.id)] || [],
        }));
        const dynamic = (_cache?.caps ?? []).filter(x => x.status === 'active');
        dynamic.forEach(item => {
            apps.push({
                id: item.appId,
                name: item.appId,
                description: item.description || `${item.appId} — Agent 动态应用`,
                capabilities: item.capabilities,
            });
        });
        return apps;
    },

    getAppListForPrompt(): string {
        return this.getAll()
            .map(a => `${a.name}(${a.description.split('-')[1]?.trim() || a.description})`)
            .join(', ');
    },

    getCapabilityListForPrompt(maxPerApp = 4): string {
        return this.getAll()
            .map(app => {
                const caps = (app.capabilities || []).slice(0, Math.max(1, maxPerApp));
                return caps.length === 0 ? `${app.name}: none` : `${app.name}: ${caps.join('/')}`;
            })
            .join('; ');
    },

    getDescription(appId: string): string {
        if (APP_DESCRIPTIONS[appId]) return APP_DESCRIPTIONS[appId];
        const cap = (_cache?.caps ?? []).find(x => x.appId === appId);
        if (cap) return `${cap.description || appId}${cap.status === 'trashed' ? ' (已移入垃圾箱)' : ''}`;
        const tomb = (_cache?.tombstones ?? []).find(x => x.appId === appId);
        if (tomb) return `${appId} — 已永久删除的动态应用`;
        return '未知应用';
    },

    /** Returns capabilities only for ACTIVE apps; trashed apps cannot be called */
    getCapabilities(appId: string): string[] {
        const builtin = APP_CAPABILITIES[appId];
        if (builtin) return [...builtin];
        const cap = (_cache?.caps ?? []).find(x => x.appId === appId && x.status === 'active');
        return [...(cap?.capabilities || [])];
    },

    isDynamicApp(appId: string): boolean {
        const safeId = String(appId || '').trim();
        if (!safeId) return false;
        return !!this.getDynamicAppCapability(safeId) || !!this.getDynamicAppTombstone(safeId);
    },

    isCapabilityAllowed(appId: string, capability: string): boolean {
        const safeId = String(appId || '').trim();
        const safeCap = normalizeCapability(capability);
        if (!safeId || !safeCap) return false;
        const capabilities = this.getCapabilities(safeId).map(normalizeCapability);
        if (capabilities.length === 0) return false;
        if (capabilities.includes('*')) return true;
        return capabilities.includes(safeCap);
    },

    /** All dynamic apps (active + trashed) */
    getDynamicAppCapabilities(): DynamicAppCapability[] {
        return _cache?.caps ?? [];
    },

    getActiveApps(): DynamicAppCapability[] {
        return (_cache?.caps ?? []).filter(x => x.status === 'active');
    },

    getTrashedApps(): DynamicAppCapability[] {
        return (_cache?.caps ?? []).filter(x => x.status === 'trashed');
    },

    getDynamicAppCapability(appId: string): DynamicAppCapability | null {
        return (_cache?.caps ?? []).find(x => x.appId === appId) || null;
    },

    getDynamicAppTombstones(): DynamicAppTombstone[] {
        return _cache?.tombstones ?? [];
    },

    getDynamicAppTombstone(appId: string): DynamicAppTombstone | null {
        const safeId = String(appId || '').trim();
        return (_cache?.tombstones ?? []).find(x => x.appId === safeId) || null;
    },

    // ── Mutations ──────────────────────────────────────────────────────────────

    /** Register or update a dynamic app (marks it active, clears any tombstone) */
    registerDynamicAppCapability(appId: string, capabilities: string[], description?: string): void {
        const safeId = String(appId || '').trim();
        if (!safeId) return;
        const nextCaps = Array.from(new Set(
            capabilities.map(x => normalizeCapability(String(x || ''))).filter(Boolean),
        ));
        if (!_cache) {
            // Not yet initialized — fall back to lightweight in-memory only (no disk write)
            _cache = { rootPath: '', allowGlobal: false, caps: [], tombstones: [] };
        }
        const idx = _cache.caps.findIndex(x => x.appId === safeId);
        const now = Date.now();
        const payload: DynamicAppCapability = {
            appId: safeId,
            description: description ? String(description).slice(0, 120) : `${safeId} — Agent 动态应用`,
            capabilities: nextCaps,
            status: 'active',
            createdAt: idx >= 0 ? (_cache.caps[idx].createdAt ?? now) : now,
            updatedAt: now,
        };
        if (idx >= 0) _cache.caps[idx] = payload;
        else _cache.caps.push(payload);
        // Remove from tombstones if being re-created
        _cache.tombstones = _cache.tombstones.filter(x => x.appId !== safeId);
        persistToDisc();
    },

    /**
     * Soft-delete: move app to trash (still recoverable).
     * The CALLER is responsible for moving the file to @agent_apps/.trash/.
     */
    trashApp(
        appId: string,
        options?: { reason?: string; trashedBy?: 'user' | 'agent' | 'system' },
    ): boolean {
        const safeId = String(appId || '').trim();
        if (!safeId || !_cache) return false;
        const idx = _cache.caps.findIndex(x => x.appId === safeId && x.status === 'active');
        if (idx < 0) return false;
        _cache.caps[idx] = {
            ..._cache.caps[idx],
            status: 'trashed',
            updatedAt: Date.now(),
            trashedAt: Date.now(),
            trashedBy: options?.trashedBy ?? 'system',
            trashReason: options?.reason,
        };
        persistToDisc();
        return true;
    },

    /**
     * Restore a trashed app back to active.
     * The CALLER is responsible for moving the file back to @agent_apps/.
     */
    restoreApp(appId: string): boolean {
        const safeId = String(appId || '').trim();
        if (!safeId || !_cache) return false;
        const idx = _cache.caps.findIndex(x => x.appId === safeId && x.status === 'trashed');
        if (idx < 0) return false;
        const { trashedAt: _ta, trashedBy: _tb, trashReason: _tr, ...rest } = _cache.caps[idx];
        _cache.caps[idx] = { ...rest, status: 'active', updatedAt: Date.now() };
        persistToDisc();
        return true;
    },

    /**
     * Permanently delete an app: removes from registry, creates tombstone.
     * The CALLER is responsible for deleting the file from @agent_apps/.trash/.
     */
    permanentlyDeleteApp(
        appId: string,
        options?: { reason?: string; deletedBy?: 'user' | 'agent' | 'system' },
    ): void {
        const safeId = String(appId || '').trim();
        if (!safeId || !_cache) return;
        const existing = _cache.caps.find(x => x.appId === safeId);
        const wasInTrash = existing?.status === 'trashed';
        // Remove from caps list
        _cache.caps = _cache.caps.filter(x => x.appId !== safeId);
        // Add tombstone (preserving capability info for agent awareness)
        _cache.tombstones = _cache.tombstones.filter(x => x.appId !== safeId);
        _cache.tombstones.push({
            appId: safeId,
            capabilities: existing?.capabilities ?? [],
            description: existing?.description,
            deletedAt: Date.now(),
            deletedBy: options?.deletedBy ?? 'user',
            reason: options?.reason,
            permanentlyDeletedFrom: wasInTrash ? 'trash' : 'direct',
        });
        // Keep tombstone list bounded
        if (_cache.tombstones.length > 200) _cache.tombstones = _cache.tombstones.slice(-200);
        persistToDisc();
    },

    /**
     * @deprecated Use trashApp() for agent/user deletes; kept for backward compatibility.
     * Creates a tombstone directly without a trash stage.
     */
    removeDynamicAppCapability(
        appId: string,
        options?: { reason?: string; deletedBy?: 'user' | 'agent' | 'system' },
    ): void {
        this.permanentlyDeleteApp(appId, { ...options, reason: options?.reason ?? 'removed_dynamic_app' });
    },

    /**
     * Reconcile registry against the files currently on disk.
     * Pass separate arrays for active vs trashed file IDs (scanned from filesystem).
     * - Files on disk but not in registry → auto-register as active
     * - Files in trash dir but not in registry as trashed → add as trashed
     * - In registry as active but missing from both → leave in place (could be sync lag)
     */
    reconcileDynamicApps(
        presentActiveIds: string[],
        presentTrashedIds: string[] = [],
        options?: {
            defaultCapabilities?: string[];
            restoredDescriptionBuilder?: (appId: string) => string;
        },
    ): { added: string[]; trashed: string[]; updated: string[] } {
        if (!_cache) return { added: [], trashed: [], updated: [] };

        const normalizedActive = Array.from(new Set(
            (Array.isArray(presentActiveIds) ? presentActiveIds : [])
                .map(x => String(x || '').trim()).filter(Boolean),
        ));
        const normalizedTrashed = Array.from(new Set(
            (Array.isArray(presentTrashedIds) ? presentTrashedIds : [])
                .map(x => String(x || '').trim()).filter(Boolean),
        ));
        const activeSet = new Set(normalizedActive);
        const trashedSet = new Set(normalizedTrashed);

        const defaultCapabilities = Array.from(new Set(
            (options?.defaultCapabilities || DEFAULT_DYNAMIC_CAPABILITIES)
                .map(x => normalizeCapability(String(x || ''))).filter(Boolean),
        ));

        const added: string[] = [];
        const trashed: string[] = [];
        const updated: string[] = [];

        const existingMap = new Map(_cache.caps.map(x => [x.appId, x]));

        // Files found in active folder → ensure they're active in registry
        for (const appId of normalizedActive) {
            const item = existingMap.get(appId);
            if (!item) {
                this.registerDynamicAppCapability(
                    appId, defaultCapabilities,
                    options?.restoredDescriptionBuilder?.(appId) || `${appId} — Agent 动态应用`,
                );
                added.push(appId);
            } else if (item.status === 'trashed') {
                // File was restored to active folder externally
                this.restoreApp(appId);
                updated.push(appId);
            }
        }

        // Files found in trash folder → ensure they're trashed in registry
        for (const appId of normalizedTrashed) {
            const item = existingMap.get(appId);
            if (!item) {
                // Unknown trashed file — register as trashed
                const now = Date.now();
                _cache.caps.push({
                    appId,
                    capabilities: defaultCapabilities,
                    status: 'trashed',
                    createdAt: now,
                    updatedAt: now,
                    trashedAt: now,
                    trashedBy: 'system',
                    trashReason: 'discovered_in_trash_on_scan',
                });
                trashed.push(appId);
            } else if (item.status === 'active') {
                // File was manually moved to trash externally
                this.trashApp(appId, { reason: 'moved_to_trash_externally', trashedBy: 'system' });
                trashed.push(appId);
            }
        }

        // Update capabilities for any active app that has none
        for (const appId of normalizedActive) {
            const item = _cache.caps.find(x => x.appId === appId);
            if (item && item.capabilities.length === 0) {
                this.registerDynamicAppCapability(
                    appId, defaultCapabilities,
                    item.description || options?.restoredDescriptionBuilder?.(appId) || `${appId} — Agent 动态应用`,
                );
                if (!updated.includes(appId)) updated.push(appId);
            }
        }

        // Check for apps in registry as active that don't appear in either scan
        // (could be a sync lag — don't auto-trash, just log)
        for (const item of _cache.caps.filter(x => x.status === 'active')) {
            if (!activeSet.has(item.appId) && !trashedSet.has(item.appId)) {
                // File missing from both folders — likely a sync issue, leave as-is
                console.warn(`AppRegistry: active app "${item.appId}" not found on disk during reconcile`);
            }
        }

        if (added.length > 0 || trashed.length > 0 || updated.length > 0) {
            persistToDisc();
        }
        return { added, trashed, updated };
    },
};
