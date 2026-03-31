import { DB } from './db';
import { fsBridge } from './fsBridge';
import { EventBus, AppEvent } from './eventBus';
import { BehaviorDayIndex, UsageAction, UsageEvent } from '../types';

type FlushReason = 'timer' | 'count' | 'max_wait' | 'manual' | 'visibility';

export interface UsageTrackerConfig {
    rootPath?: string;
    allowGlobal?: boolean;
    flushIntervalMs?: number;
    flushMaxEvents?: number;
    forceFlushMaxWaitMs?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 3000;
const DEFAULT_FLUSH_MAX_EVENTS = 12;
const DEFAULT_FORCE_FLUSH_MAX_WAIT_MS = 10000;
const HOT_RETENTION_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');

const toDayKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Flat layout: memory/indexes/behavior/YYYY-MM-DD.events.jsonl
// (no nested year/month subfolders — simpler to scan, matches GPT design spec)

const createEventId = (ts: number) => {
    const d = new Date(ts);
    const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 8);
    return `uev-${stamp}-${rand}`;
};

const normalizeAction = (raw: string): UsageAction => {
    const t = String(raw || '').toLowerCase();
    if (/open|进入|打开/.test(t)) return 'app_open';
    if (/close|退出|关闭/.test(t)) return 'app_close';
    if (/switch|切换/.test(t)) return 'app_switch';
    if (/write|保存|创建|新增|上传|发帖|发布|记录/.test(t)) return 'write';
    if (/update|修改|编辑/.test(t)) return 'update';
    if (/delete|移除|删除/.test(t)) return 'delete';
    if (/complete|完成|打卡/.test(t)) return 'complete';
    if (/send|发送/.test(t)) return 'send';
    if (/search|搜索|检索/.test(t)) return 'search';
    if (/view|浏览|查看|打开详情|获取/.test(t)) return 'view';
    return 'custom';
};

const scoreImportance = (input: { action: UsageAction; importance?: number }): number => {
    if (typeof input.importance === 'number') {
        return Math.max(0, Math.min(1, input.importance));
    }
    if (input.action === 'write' || input.action === 'delete' || input.action === 'complete') return 0.9;
    if (input.action === 'send' || input.action === 'search' || input.action === 'update') return 0.7;
    if (input.action === 'app_open' || input.action === 'app_close') return 0.3;
    return 0.5;
};

class UsageTrackerImpl {
    private config: Required<Pick<UsageTrackerConfig, 'flushIntervalMs' | 'flushMaxEvents' | 'forceFlushMaxWaitMs'>> & Pick<UsageTrackerConfig, 'rootPath' | 'allowGlobal'> = {
        rootPath: '',
        allowGlobal: false,
        flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
        flushMaxEvents: DEFAULT_FLUSH_MAX_EVENTS,
        forceFlushMaxWaitMs: DEFAULT_FORCE_FLUSH_MAX_WAIT_MS,
    };
    private queue: UsageEvent[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private forceFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushLock: Promise<void> = Promise.resolve();
    private unsubscribeEventBus: (() => void) | null = null;
    private activeAppState: { appId: string; openedAt: number } | null = null;
    private started = false;
    private visibilityHandler: (() => void) | null = null;
    private beforeUnloadHandler: (() => void) | null = null;

    configure(next: UsageTrackerConfig) {
        this.config = {
            rootPath: next.rootPath ?? this.config.rootPath,
            allowGlobal: typeof next.allowGlobal === 'boolean' ? next.allowGlobal : this.config.allowGlobal,
            flushIntervalMs: Math.max(1000, next.flushIntervalMs ?? this.config.flushIntervalMs),
            flushMaxEvents: Math.max(5, next.flushMaxEvents ?? this.config.flushMaxEvents),
            forceFlushMaxWaitMs: Math.max(3000, next.forceFlushMaxWaitMs ?? this.config.forceFlushMaxWaitMs),
        };
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.unsubscribeEventBus = EventBus.subscribe((event) => {
            this.recordFromEventBus(event);
        });
        this.visibilityHandler = () => {
            if (document.hidden) {
                this.flushNow('visibility');
            }
        };
        this.beforeUnloadHandler = () => {
            this.flushNow('visibility');
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    stop() {
        this.started = false;
        if (this.unsubscribeEventBus) {
            this.unsubscribeEventBus();
            this.unsubscribeEventBus = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.forceFlushTimer) {
            clearTimeout(this.forceFlushTimer);
            this.forceFlushTimer = null;
        }
        this.flushNow('manual');
    }

    transitionApp(nextAppId: string, ts: number = Date.now()) {
        const nextId = String(nextAppId || '').trim();
        if (!nextId) return;
        if (!this.activeAppState) {
            this.activeAppState = { appId: nextId, openedAt: ts };
            this.record({
                appId: nextId,
                action: 'app_open',
                ts,
                detail: `进入 ${nextId}`,
                source: 'system',
                importance: 0.4,
            });
            return;
        }

        const prev = this.activeAppState;
        if (prev.appId === nextId) return;

        const dwellMs = Math.max(0, ts - prev.openedAt);
        this.record({
            appId: prev.appId,
            action: 'app_close',
            ts,
            detail: `离开 ${prev.appId}`,
            dwellMs,
            source: 'system',
            importance: 0.45,
        });
        this.record({
            appId: prev.appId,
            action: 'app_switch',
            ts,
            detail: `${prev.appId} -> ${nextId}`,
            source: 'system',
            importance: 0.4,
        });
        this.activeAppState = { appId: nextId, openedAt: ts };
        this.record({
            appId: nextId,
            action: 'app_open',
            ts,
            detail: `进入 ${nextId}`,
            source: 'system',
            importance: 0.4,
        });
    }

    closeActiveApp(reason = 'close_app', ts: number = Date.now()) {
        if (!this.activeAppState) return;
        const prev = this.activeAppState;
        const dwellMs = Math.max(0, ts - prev.openedAt);
        this.record({
            appId: prev.appId,
            action: 'app_close',
            ts,
            detail: `${reason}:${prev.appId}`,
            dwellMs,
            source: 'system',
            importance: 0.45,
        });
        this.activeAppState = null;
    }

    recordCustomEvent(input: {
        appId: string;
        action: UsageAction;
        detail?: string;
        refType?: string;
        refId?: string;
        importance?: number;
        source?: UsageEvent['source'];
        ts?: number;
        dwellMs?: number;
    }) {
        this.record({
            appId: input.appId,
            action: input.action,
            detail: input.detail,
            refType: input.refType,
            refId: input.refId,
            importance: input.importance,
            source: input.source || 'user',
            ts: input.ts ?? Date.now(),
            dwellMs: input.dwellMs,
        });
    }

    flushNow(reason: FlushReason = 'manual') {
        const snapshot = this.queue.splice(0, this.queue.length);
        if (snapshot.length === 0) return;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.forceFlushTimer) {
            clearTimeout(this.forceFlushTimer);
            this.forceFlushTimer = null;
        }
        this.flushLock = this.flushLock
            .then(() => this.flushBatch(snapshot, reason))
            .catch(() => { });
    }

    private recordFromEventBus(event: AppEvent) {
        const action = normalizeAction(event.action);
        // Skip chat message send events — these are already captured in L2 raw/clean.
        // Behavior index should only track user actions that DON'T trigger LLM
        // (e.g., app navigation, gallery browse, settings change).
        if (action === 'send' && (event.app === 'Chat' || event.app === 'chat')) return;

        this.record({
            appId: event.app || 'unknown',
            action,
            ts: event.timestamp || Date.now(),
            detail: `${event.action}${event.detail ? `(${event.detail})` : ''}`.slice(0, 64),
            refType: event.refType,
            refId: event.refId,
            importance: event.importance,
            source: event.source || 'event_bus',
        });
    }

    private record(input: {
        appId: string;
        action: UsageAction;
        ts: number;
        detail?: string;
        refType?: string;
        refId?: string;
        dwellMs?: number;
        importance?: number;
        source?: UsageEvent['source'];
    }) {
        const event: UsageEvent = {
            id: createEventId(input.ts),
            ts: input.ts,
            isoTime: new Date(input.ts).toISOString(),
            dayKey: toDayKey(input.ts),
            appId: String(input.appId || 'unknown').slice(0, 40),
            action: input.action,
            detail: input.detail ? String(input.detail).slice(0, 80) : undefined,
            refType: input.refType ? String(input.refType).slice(0, 40) : undefined,
            refId: input.refId ? String(input.refId).slice(0, 80) : undefined,
            dwellMs: typeof input.dwellMs === 'number' ? Math.max(0, Math.round(input.dwellMs)) : undefined,
            importance: scoreImportance({ action: input.action, importance: input.importance }),
            source: input.source || 'user',
        };

        void DB.saveUsageEvent(event).catch(() => { });
        this.queue.push(event);
        this.ensureFlushTimers();

        if (this.queue.length >= this.config.flushMaxEvents) {
            this.flushNow('count');
        }
    }

    private ensureFlushTimers() {
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                this.flushNow('timer');
            }, this.config.flushIntervalMs);
        }
        if (!this.forceFlushTimer) {
            this.forceFlushTimer = setTimeout(() => {
                this.forceFlushTimer = null;
                this.flushNow('max_wait');
            }, this.config.forceFlushMaxWaitMs);
        }
    }

    private async flushBatch(events: UsageEvent[], _reason: FlushReason) {
        const rootPath = this.config.rootPath?.trim();
        if (!rootPath) return;
        const allowGlobal = !!this.config.allowGlobal;

        await fsBridge.createFolder(rootPath, 'memory/indexes/behavior', allowGlobal).catch(() => { });

        const grouped = new Map<string, UsageEvent[]>();
        for (const ev of events) {
            const arr = grouped.get(ev.dayKey) || [];
            arr.push(ev);
            grouped.set(ev.dayKey, arr);
        }

        for (const [dayKey, dayEvents] of grouped.entries()) {
            dayEvents.sort((a, b) => a.ts - b.ts);
            const eventsPath = `memory/indexes/behavior/${dayKey}.events.jsonl`;
            const indexPath  = `memory/indexes/behavior/${dayKey}.index.json`;

            const appendLines = dayEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
            let existing = '';
            try {
                existing = await fsBridge.readFile(rootPath, eventsPath, allowGlobal);
            } catch {
                existing = '';
            }
            await fsBridge.writeFile(rootPath, eventsPath, `${existing}${appendLines}`, allowGlobal);

            const index = await this.readDayIndex(rootPath, indexPath, allowGlobal, dayKey);
            this.applyEventsToIndex(index, dayEvents);
            await fsBridge.writeFile(rootPath, indexPath, JSON.stringify(index, null, 2), allowGlobal);
        }

        const cutoff = Date.now() - HOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        void DB.deleteUsageEventsBefore(cutoff).catch(() => { });
    }

    private async readDayIndex(
        rootPath: string,
        indexPath: string,
        allowGlobal: boolean,
        dayKey: string,
    ): Promise<BehaviorDayIndex> {
        // Try reading the existing index file first
        try {
            const raw = await fsBridge.readFile(rootPath, indexPath, allowGlobal);
            const parsed = JSON.parse(raw) as BehaviorDayIndex;
            if (parsed && parsed.dayKey === dayKey) return parsed;
        } catch {
            // Index file missing/corrupt — try rebuilding from events.jsonl
        }

        // Fallback: rebuild index from all events in events.jsonl
        // This prevents data loss when index read fails (e.g., first flush after refresh)
        const fresh: BehaviorDayIndex = {
            version: 1,
            dayKey,
            updatedAt: Date.now(),
            totalEvents: 0,
            appOpenCount: {},
            totalDwellMsByApp: {},
            actionCountByApp: {},
            highValueRefs: [],
        };
        try {
            const eventsPath = `memory/indexes/behavior/${dayKey}.events.jsonl`;
            const eventsRaw = await fsBridge.readFile(rootPath, eventsPath, allowGlobal);
            const lines = eventsRaw.split('\n').filter(l => l.trim());
            const pastEvents: UsageEvent[] = [];
            for (const line of lines) {
                try { pastEvents.push(JSON.parse(line) as UsageEvent); } catch { /* skip */ }
            }
            if (pastEvents.length > 0) {
                this.applyEventsToIndex(fresh, pastEvents);
            }
        } catch {
            // No events file either — truly fresh day
        }
        return fresh;
    }

    private applyEventsToIndex(index: BehaviorDayIndex, events: UsageEvent[]) {
        for (const ev of events) {
            index.totalEvents += 1;
            if (!index.actionCountByApp[ev.appId]) index.actionCountByApp[ev.appId] = {};
            index.actionCountByApp[ev.appId][ev.action] =
                (index.actionCountByApp[ev.appId][ev.action] || 0) + 1;

            if (ev.action === 'app_open') {
                index.appOpenCount[ev.appId] = (index.appOpenCount[ev.appId] || 0) + 1;
            }
            if (typeof ev.dwellMs === 'number') {
                index.totalDwellMsByApp[ev.appId] =
                    (index.totalDwellMsByApp[ev.appId] || 0) + Math.max(0, ev.dwellMs);
            }

            if (ev.refType && ev.refId && (ev.importance || 0) >= 0.7) {
                const existing = index.highValueRefs.find(
                    x => x.appId === ev.appId && x.refType === ev.refType && x.refId === ev.refId,
                );
                if (existing) {
                    existing.lastTs = Math.max(existing.lastTs, ev.ts);
                    existing.score = Math.max(existing.score, ev.importance || 0.7);
                } else {
                    index.highValueRefs.push({
                        appId: ev.appId,
                        refType: ev.refType,
                        refId: ev.refId,
                        lastTs: ev.ts,
                        score: ev.importance || 0.7,
                    });
                }
            }
        }
        index.updatedAt = Date.now();
        index.highValueRefs.sort((a, b) => b.lastTs - a.lastTs);
        if (index.highValueRefs.length > 100) {
            index.highValueRefs = index.highValueRefs.slice(0, 100);
        }
    }
}

export const usageTracker = new UsageTrackerImpl();
