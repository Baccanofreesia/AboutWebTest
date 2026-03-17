import { EventBus } from './eventBus';
import { AppRegistry } from './appRegistry';
import { PerceptionConfig } from '../types';

interface PerceptionDataPoint {
    id: string;
    value: string;
    subtleValue: string;
    urgency: number;   // 0.0 - 1.0
    relevance: number; // 0.0 - 1.0 (contextual)
    contextualBonus: number;
    forceEligible?: boolean;
}

// 内存中追踪本次 Session 的提及历史，用于计算惩罚项
const mentionHistory: Record<string, { count: number, lastTime: number }> = {};

function getPeriod(hour: number): string {
    if (hour < 5) return '深夜';
    if (hour < 9) return '早晨';
    if (hour < 12) return '上午';
    if (hour < 14) return '中午';
    if (hour < 18) return '下午';
    if (hour < 22) return '晚上';
    return '深夜';
}

/**
 * 计算简单的关联度 (关键词匹配)
 */
function calculateRelevance(text: string, currentChatContext: string): number {
    if (!currentChatContext) return 0.2; // 默认基准分
    const keywords = text.toLowerCase().split(/[:\(\) \|]/);
    const chat = currentChatContext.toLowerCase();

    let matches = 0;
    keywords.forEach(kw => {
        if (kw.length > 1 && chat.includes(kw)) matches++;
    });

    return Math.min(0.2 + (matches * 0.3), 1.0);
}

function detectDirectIntent(currentChatContext: string) {
    const ctx = (currentChatContext || '').toLowerCase();
    return {
        askTime: /(几点|时间|几号|多晚|现在几点|what time|time now|current time)/.test(ctx),
        askBattery: /(电量|没电|充电|多少电|battery|low battery|charge)/.test(ctx),
        askApp: /(哪个app|什么app|在哪个界面|在哪个应用|在哪|which app|current app|screen)/.test(ctx),
        askAction: /(刚才|刚刚|最近.*(做了|干了|操作)|你做了什么|what did you do|recent action)/.test(ctx)
    };
}

function batteryState(level: number, threshold: number): string {
    if (level <= threshold) return '电量告急';
    if (level <= 30) return '电量偏低';
    if (level <= 70) return '电量正常';
    return '电量充足';
}

/**
 * 计算平滑得分 (Sigmoid 归一化)
 * 将 (BaseWeight - TotalPenalty) 映射到 0.0 - 1.0
 */
function sigmoidScore(baseWeight: number, penalty: number, threshold: number): number {
    // 阈值偏移：threshold 越高，x 需要越大才能达到高分
    // 将阈值从 [0,1] 映射到核心偏移量 [-5, 5]
    const x = baseWeight - penalty;
    const offset = (threshold - 0.5) * 10;
    return 1 / (1 + Math.exp(-(x * 5 - offset)));
}

/**
 * 计算惩罚后的得分 (升级版：支持存在与频率惩罚)
 */
function calculateTotalPenalty(id: string, config: PerceptionConfig): number {
    const history = mentionHistory[id];
    if (!history) return 0;

    const now = Date.now();
    const timeSinceLast = (now - history.lastTime) / 1000; // 秒

    // Frequency Penalty: 只要提过，5分钟内都有衰减惩罚
    const freqFactor = Math.max(0, 1 - (timeSinceLast / 300));
    const freqPenalty = (history.count * (config.frequencyPenalty || 0.5)) * freqFactor;

    // Presence Penalty: 只要在本 Session 提过就有基础压制
    const presPenalty = config.presencePenalty || 0.3;

    return freqPenalty + presPenalty;
}

export const ContextEnhancer = {

    /**
     * 记录一次成功的环境表达，用于后续惩罚
     */
    trackMention(id: string) {
        if (!mentionHistory[id]) {
            mentionHistory[id] = { count: 1, lastTime: Date.now() };
        } else {
            mentionHistory[id].count++;
            mentionHistory[id].lastTime = Date.now();
        }
    },

    trackMentionFromResponse(content: string) {
        const text = (content || '').toLowerCase();
        if (/(凌晨|深夜|早晨|上午|中午|下午|晚上|\b\d{1,2}:\d{2}\b|现在.*点)/.test(text)) this.trackMention('time');
        if (/(电量|没电|充电|低电|battery|\b\d{1,3}%\b)/.test(text)) this.trackMention('battery');
        if (/(当前.*app|当前.*应用|在.*界面|桌面|设置页|聊天页|gallery|settings|chat)/.test(text)) this.trackMention('app');
        if (/(刚才|刚刚|最近操作|你.*做了什么|recent action|eventbus)/.test(text)) this.trackMention('actions');
    },

    /**
     * 生成结构化的感知层 V2.2
     */
    async buildTieredPerception(
        activeApp: string | undefined,
        config: PerceptionConfig,
        currentChatContext: string = ''
    ) {
        const threshold = config.visibilityThreshold ?? 0.7;
        const internalization = config.internalizationBias ?? 0.8;
        const now = new Date();
        const hour = now.getHours();
        const mins = now.getMinutes().toString().padStart(2, '0');
        const timeStr = `${hour}:${mins}`;

        const dataPoints: PerceptionDataPoint[] = [];
        const intent = detectDirectIntent(currentChatContext);

        // 1. 时间维度 (W1: 0.6)
        const timeUrgency = (hour >= (config.lateNightHour || 23) || hour < 5) ? 0.9 : 0.2;
        dataPoints.push({
            id: 'time',
            value: `时间:${timeStr}(${getPeriod(hour)})`,
            subtleValue: `时间段:${getPeriod(hour)}`,
            urgency: timeUrgency,
            relevance: intent.askTime ? 1 : calculateRelevance(`时间 几点 晚 睡 熬夜 ${getPeriod(hour)}`, currentChatContext),
            contextualBonus: intent.askTime ? 0.25 : 0,
            forceEligible: intent.askTime
        });

        // 2. 电量维度 (W2: 0.8)
        let batteryLevel = 85;
        try {
            if ('getBattery' in navigator) {
                const b = await (navigator as any).getBattery();
                batteryLevel = Math.round(b.level * 100);
            }
        } catch { }

        const batteryUrgency = batteryLevel <= (config.batteryUrgencyThreshold || 15) ? 1.0 : 0.1;
        dataPoints.push({
            id: 'battery',
            value: `电量:${batteryLevel}%`,
            subtleValue: `电量状态:${batteryState(batteryLevel, config.batteryUrgencyThreshold || 15)}`,
            urgency: batteryUrgency,
            relevance: intent.askBattery ? 1 : calculateRelevance('电量 没电 充电 关机 手机', currentChatContext),
            contextualBonus: intent.askBattery ? 0.25 : 0,
            forceEligible: intent.askBattery || batteryLevel <= (config.batteryUrgencyThreshold || 15)
        });

        // 3. 应用维度 (W3: 0.4)
        const appName = activeApp
            ? AppRegistry.getDescription(activeApp).split('—')[0]?.trim() || activeApp
            : '桌面';
        dataPoints.push({
            id: 'app',
            value: `当前正在使用App:${appName}`,
            subtleValue: `当前场景:${appName}`,
            urgency: 0.1,
            relevance: intent.askApp ? 1 : calculateRelevance(appName, currentChatContext),
            contextualBonus: intent.askApp ? 0.2 : 0,
            forceEligible: intent.askApp
        });

        // 4. 行为维度 (W4: 0.5)
        const actions = EventBus.getSnapshot(3);
        dataPoints.push({
            id: 'actions',
            value: `近期用户行为:${actions}`,
            subtleValue: `近期操作线索:${actions}`,
            urgency: 0.2,
            relevance: intent.askAction ? 1 : calculateRelevance(actions, currentChatContext),
            contextualBonus: intent.askAction ? 0.2 : 0,
            forceEligible: intent.askAction
        });

        const subConscious: string[] = [];
        const eligibleForMention: string[] = [];

        dataPoints.forEach(p => {
            const baseWeight = p.urgency * 0.6 + p.relevance * 0.4 + p.contextualBonus;
            const penalty = calculateTotalPenalty(p.id, config);
            const calibratedThreshold = Math.min(0.9, 0.58 + internalization * 0.22);
            const finalScore = sigmoidScore(baseWeight - internalization * 0.35, penalty, threshold);

            if (p.forceEligible ? finalScore >= 0.42 : finalScore >= calibratedThreshold) {
                eligibleForMention.push(p.value);
            } else {
                subConscious.push(p.subtleValue);
            }
        });

        return { subConscious, eligibleForMention };
    },

    /**
     * 生成增强后的感知提示词快照 (Reflection v2.2)
     */
    async buildSnapshot(activeApp: string | undefined, config: PerceptionConfig, lastUserMsg: string = ''): Promise<string> {
        const { subConscious, eligibleForMention } = await this.buildTieredPerception(activeApp, config, lastUserMsg);
        const appList = AppRegistry.getAppListForPrompt();

        const parts: string[] = [
            `\n### [系统感知层 2.2 — 潜意识与关联反思]`,
            `【深度潜意识 (Subconscious Awareness/Always Known)】: ${subConscious.join(' | ') || '无'}`,
            `【建议提及区 (Eligible for Explicit Mention)】: ${eligibleForMention.join(' | ') || '无'}`,
            `[当前系统App目录] ${appList}`,
            `[EventBus 说明] 事件总线记录了用户最近的操作流水。格式为: [时间]App名:动作(详情)。`
        ];

        parts.push(`
⚠️ 行为指南与灵魂三问 (Personality Reflection):
1. 感知不等同于播报：你有完整的潜意识，但这不代表你需要逐一说出来。
2. 表达的必要性：仅当环境信息与当前对话极度相关（在建议提及区）、或者能体现你对用户的关怀时，才考虑通过直接或间接的方式表达。
3. 禁令松绑：你可以说出具体的数字（如电量、时间），但必须是在反思后的决策结果（例如用户问及，或者电量真正告急时）。
4. 反思决策流：
   - 真实感：作为你的这一人格，在这个瞬间，你会特意点出这个环境要素吗？
   - 价值感：说出这个数字/状态是否能帮到用户，还是仅仅在机械地读数？
   - 优雅度：能否用更自然、更像人类的语气把这种感知揉进对话里？（如："天已经这么晚了..." 代替 "现在是 02:00"）
5. 句式建议：避免使用过于死板的"监视型"句式（如"我注意到..."），尽量采用更有共情力、更像朋友聊天的切入点。`);

        return parts.join('\n');
    },

    /**
     * 兼容性保留
     */
    build(activeApp?: string): string {
        return `[系统环境] 用户当前在:${activeApp || '桌面'}`;
    },

    /**
     * 生成包含 App 目录的完整感官块 (兼容旧调用)
     */
    buildFullPerceptionBlock(activeApp?: string): string {
        const appList = AppRegistry.getAppListForPrompt();
        return `\n\n### [系统感知层] 用户当前在:${activeApp || '桌面'}\n[已安装App] ${appList}`;
    }
};
