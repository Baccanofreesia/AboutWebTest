import { DB } from './db';
import { AppRegistry } from './appRegistry';
import { FileIndex, FileIndexScope, ResolveIndexedFileInput } from './fileIndex';
import { ToolAuditRecord, UsageEvent } from '../types';

export interface BehaviorQueryFilter {
    dayKey?: string;
    appId?: string;
    action?: string;
    limit?: number;
}

export interface ToolGatewayRef {
    refType: string;
    refId: string;
}

export interface ToolGatewayInvokeInput {
    callerAppId?: string;
    capability: string;
    payload?: any;
}

type ToolHandler = (payload?: any, callerAppId?: string) => Promise<any>;

const DEFAULT_SHARED_CAPABILITIES = new Set(['query_index', 'read_ref', 'search', 'resolve_file']);

const createAuditId = () => `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const saveAudit = async (input: Omit<ToolAuditRecord, 'id' | 'ts'>) => {
    const record: ToolAuditRecord = {
        id: createAuditId(),
        ts: Date.now(),
        ...input,
    };
    await DB.saveToolAudit(record).catch(() => { });
};

const normalizeCapability = (value: string) => String(value || '').trim().toLowerCase();

const scoreText = (text: string, query: string) => {
    const t = String(text || '').toLowerCase();
    const q = String(query || '').toLowerCase().trim();
    if (!q) return 0;
    if (t === q) return 100;
    if (t.includes(q)) return 60;
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 0;
    let score = 0;
    for (const p of parts) if (t.includes(p)) score += 20;
    return score;
};

const assertCapabilityAccess = (callerAppId: string | undefined, capability: string) => {
    const appId = String(callerAppId || '').trim();
    if (!appId) return;
    const cap = normalizeCapability(capability);
    if (!cap) throw new Error('Invalid capability');

    const isDynamic = AppRegistry.isDynamicApp(appId);
    if (isDynamic) {
        if (!AppRegistry.isCapabilityAllowed(appId, cap)) {
            throw new Error(`Capability "${cap}" is not declared for dynamic app "${appId}"`);
        }
        return;
    }

    const builtinCaps = AppRegistry.getCapabilities(appId).map(normalizeCapability);
    if (builtinCaps.length === 0) {
        if (DEFAULT_SHARED_CAPABILITIES.has(cap)) return;
        throw new Error(`Unknown app "${appId}" or no capability declaration found`);
    }
    if (!builtinCaps.includes(cap) && !DEFAULT_SHARED_CAPABILITIES.has(cap)) {
        throw new Error(`Capability "${cap}" is not allowed for app "${appId}"`);
    }
};

const handlers: Record<string, ToolHandler> = {};

export const ToolGateway = {
    registerHandler(capability: string, handler: ToolHandler) {
        const cap = normalizeCapability(capability);
        if (!cap) return;
        handlers[cap] = handler;
    },

    unregisterHandler(capability: string) {
        const cap = normalizeCapability(capability);
        if (!cap) return;
        delete handlers[cap];
    },

    getCapabilities(appId?: string): string[] {
        if (appId) return AppRegistry.getCapabilities(appId);
        return Array.from(DEFAULT_SHARED_CAPABILITIES);
    },

    async invoke(input: ToolGatewayInvokeInput): Promise<any> {
        const cap = normalizeCapability(input.capability);
        if (!cap) throw new Error('Missing capability');
        assertCapabilityAccess(input.callerAppId, cap);
        const handler = handlers[cap];
        if (!handler) throw new Error(`No tool handler registered for capability "${cap}"`);
        return handler(input.payload, input.callerAppId);
    },

    async queryIndex(filter: BehaviorQueryFilter = {}): Promise<UsageEvent[]> {
        try {
            const limit = Math.max(1, Math.min(1000, Number(filter.limit || 200)));
            let rows = filter.dayKey
                ? await DB.getUsageEventsByDay(filter.dayKey, limit)
                : await DB.getRecentUsageEvents(limit);
            if (filter.appId) rows = rows.filter(r => r.appId === filter.appId);
            if (filter.action) rows = rows.filter(r => r.action === filter.action);
            await saveAudit({
                action: 'query_index',
                status: 'ok',
                appId: filter.appId,
                detail: `rows=${rows.length}${filter.dayKey ? ` day=${filter.dayKey}` : ''}`,
            });
            return rows;
        } catch (e: any) {
            await saveAudit({
                action: 'query_index',
                status: 'error',
                appId: filter.appId,
                detail: e?.message || 'unknown error',
            });
            throw e;
        }
    },

    async readRef(input: ToolGatewayRef): Promise<any> {
        const refType = String(input.refType || '').trim().toLowerCase();
        const refId = String(input.refId || '').trim();
        try {
            let data: any = null;
            if (refType === 'diary') {
                const diaries = await DB.getDiariesByCharId('nova');
                data = diaries.find(d => d.id === refId) || null;
            } else if (refType === 'gallery_image') {
                const images = await DB.getGalleryImages();
                data = images.find(i => i.id === refId) || null;
            } else if (refType === 'task') {
                const tasks = await DB.getAllTasks();
                data = tasks.find(t => t.id === refId) || null;
            } else if (refType === 'anniversary') {
                const annis = await DB.getAllAnniversaries();
                data = annis.find(a => a.id === refId) || null;
            } else if (refType === 'xhs_stock') {
                const rows = await DB.getXhsStockImages();
                data = rows.find(r => r.id === refId) || null;
            } else if (refType === 'xhs_activity') {
                const rows = await DB.getAllXhsActivities();
                data = rows.find(r => r.id === refId) || null;
            } else if (refType === 'workspace_file') {
                const files = await DB.getWorkspaceFiles();
                data = files.find(f => f.id === refId || f.name === refId) || null;
            } else if (refType === 'dynamic_app') {
                data = AppRegistry.getDynamicAppCapability(refId);
            } else if (refType === 'dynamic_app_tombstone') {
                data = AppRegistry.getDynamicAppTombstone(refId);
            }

            await saveAudit({
                action: 'read_ref',
                status: 'ok',
                refType,
                refId,
                detail: data ? 'hit' : 'miss',
            });
            return data;
        } catch (e: any) {
            await saveAudit({
                action: 'read_ref',
                status: 'error',
                refType,
                refId,
                detail: e?.message || 'unknown error',
            });
            throw e;
        }
    },

    async search(appId: string, query: string, limit = 20): Promise<any[]> {
        const safeLimit = Math.max(1, Math.min(200, limit));
        const app = String(appId || '').trim().toLowerCase();
        const q = String(query || '').trim();
        try {
            let rows: any[] = [];
            if (app === 'journal') {
                const diaries = await DB.getDiariesByCharId('nova');
                rows = diaries
                    .map(d => ({
                        id: d.id,
                        date: d.date,
                        text: `${d.userPage?.text || ''} ${d.charPage?.text || ''}`.trim(),
                    }))
                    .map(r => ({ ...r, _score: scoreText(`${r.date} ${r.text}`, q) }))
                    .filter(r => r._score > 0)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, safeLimit);
            } else if (app === 'gallery') {
                const [images, details] = await Promise.all([
                    DB.getGalleryImages(),
                    DB.getImageDetails(),
                ]);
                rows = images
                    .map(img => {
                        const detail = details.find(d => d.fileName === img.id || d.relatedPath?.includes(img.id));
                        const text = `${img.id} ${detail?.detail || ''}`;
                        return { id: img.id, text, _score: scoreText(text, q) };
                    })
                    .filter(r => r._score > 0)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, safeLimit);
            } else if (app === 'schedule') {
                const [tasks, annis] = await Promise.all([DB.getAllTasks(), DB.getAllAnniversaries()]);
                const taskRows = tasks.map(t => ({
                    id: t.id,
                    type: 'task',
                    title: t.title,
                    _score: scoreText(t.title, q),
                }));
                const anniRows = annis.map(a => ({
                    id: a.id,
                    type: 'anniversary',
                    title: `${a.title} ${a.date}`,
                    _score: scoreText(`${a.title} ${a.date}`, q),
                }));
                rows = [...taskRows, ...anniRows]
                    .filter(r => r._score > 0)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, safeLimit);
            } else if (app === 'xhs_stock') {
                const stock = await DB.getXhsStockImages();
                rows = stock
                    .map(s => {
                        const text = `${s.id} ${s.tags.join(' ')}`;
                        return { id: s.id, tags: s.tags, _score: scoreText(text, q) };
                    })
                    .filter(r => r._score > 0)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, safeLimit);
            } else if (app === 'dynamic_app') {
                const dynamic = AppRegistry.getDynamicAppCapabilities();
                rows = dynamic
                    .map(d => ({
                        ...d,
                        _score: scoreText(`${d.appId} ${d.description || ''} ${d.capabilities.join(' ')}`, q),
                    }))
                    .filter(r => r._score > 0)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, safeLimit);
            }

            await saveAudit({
                action: 'search',
                status: 'ok',
                appId: app,
                detail: `rows=${rows.length} query=${q.slice(0, 40)}`,
            });
            return rows;
        } catch (e: any) {
            await saveAudit({
                action: 'search',
                status: 'error',
                appId: app,
                detail: e?.message || 'unknown error',
            });
            throw e;
        }
    },

    async resolveFile(payload: ResolveIndexedFileInput): Promise<any> {
        try {
            const result = await FileIndex.resolveIndexedFile(payload);
            await saveAudit({
                action: 'resolve_file',
                status: 'ok',
                appId: payload.scope,
                detail: `${result.status}${result.path ? ` path=${result.path}` : ''}`,
            });
            return result;
        } catch (e: any) {
            await saveAudit({
                action: 'resolve_file',
                status: 'error',
                appId: payload.scope as FileIndexScope,
                detail: e?.message || 'unknown error',
            });
            throw e;
        }
    },
};

ToolGateway.registerHandler('query_index', async (payload) => {
    return ToolGateway.queryIndex(payload || {});
});

ToolGateway.registerHandler('read_ref', async (payload) => {
    return ToolGateway.readRef(payload || {});
});

ToolGateway.registerHandler('search', async (payload) => {
    const appId = String(payload?.appId || '').trim();
    const query = String(payload?.query || '').trim();
    const limit = Number(payload?.limit || 20);
    return ToolGateway.search(appId, query, limit);
});

ToolGateway.registerHandler('resolve_file', async (payload) => {
    return ToolGateway.resolveFile(payload || {});
});

