/**
 * EventBus — 轻量级全局行为感知引擎
 * 
 * 纯内存环形缓冲区，最多保留 50 条事件。
 * App 通过 EventBus.emit() 上报用户行为，
 * ContextEnhancer 在 LLM 调用前读取最近事件注入 Prompt。
 */

export interface AppEvent {
    time: string;       // "20:52"
    app: string;        // "DailyWhisper"
    action: string;     // "生成私语"
    detail?: string;    // 可选的简短描述 (≤ 30 chars)
    timestamp: number;  // Date.now()
}

const MAX_EVENTS = 50;
const events: AppEvent[] = [];

function formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export const EventBus = {

    /**
     * 上报一条用户行为事件
     */
    emit(app: string, action: string, detail?: string): void {
        const event: AppEvent = {
            time: formatTime(new Date()),
            app,
            action,
            detail: detail ? detail.slice(0, 30) : undefined,
            timestamp: Date.now(),
        };
        events.push(event);
        if (events.length > MAX_EVENTS) {
            events.shift(); // 环形覆盖
        }
    },

    /**
     * 获取最近 n 条事件
     */
    getRecent(n: number = 5): AppEvent[] {
        return events.slice(-n);
    },

    /**
     * 获取最近 5 分钟内的事件（用于 Prompt 注入）
     */
    getRecentMinutes(minutes: number = 5): AppEvent[] {
        const cutoff = Date.now() - minutes * 60 * 1000;
        return events.filter(e => e.timestamp >= cutoff);
    },

    /**
     * 压缩为极简文本快照（≤ 30 Token），用于注入 System Prompt
     */
    getSnapshot(maxItems: number = 3): string {
        const recent = this.getRecent(maxItems);
        if (recent.length === 0) return '无近期操作';
        return recent.map(e => {
            const base = `[${e.time}]${e.app}:${e.action}`;
            return e.detail ? `${base}(${e.detail})` : base;
        }).join(', ');
    },

    /**
     * 获取全部事件（调试/导出用）
     */
    getAll(): AppEvent[] {
        return [...events];
    },

    /**
     * 清空全部事件
     */
    clear(): void {
        events.length = 0;
    }
};
