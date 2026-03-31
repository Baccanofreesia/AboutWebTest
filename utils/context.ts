
import { CharacterProfile, UserProfile } from '../types';

/**
 * Memory Central — NovaClaw L1-L4 RAG Context Builder
 *
 * Assembles the system prompt from:
 *   L4: Static Profile (SOUL.md / Impression)
 *   L3b: Core Proposals (approved → merged into identity)
 *   L3a: Dynamic Memories (current state, near-term context)
 *   L2: Refined Monthly Core (key memory summaries)
 *   L1: Recent N messages (handled externally by Chat.tsx)
 */
export const ContextBuilder = {

    /**
     * 构建核心人设上下文
     * @param char 角色档案
     * @param user 用户档案
     * @param includeDetailedMemories 是否包含激活月份的详细 Log (默认 true)
     * @returns 标准化的 Markdown 格式 System Prompt
     */
    buildCoreContext: (char: CharacterProfile, user: UserProfile, includeDetailedMemories: boolean = true): string => {
        let context = `[System: Roleplay Configuration]\n\n`;

        // ─── L4: Core Identity ───
        context += `### 你的身份 (Character)\n`;
        context += `- 名字: ${char.name}\n`;
        context += `- 聊天显示昵称: ${char.nickname || char.name}\n`;
        context += `- 用户备注/爱称 (User Note/Nickname): ${char.description || '无'}\n`;
        context += `  (注意: 这个备注是用户对你的称呼或印象，可能包含比喻。如果备注内容（如"快乐小狗"）与你的核心设定冲突，请以核心设定为准，不要真的扮演成动物，除非核心设定里写了你是动物。)\n`;
        context += `- 核心性格/指令:\n${char.systemPrompt || '你是一个温柔、拟人化的AI伴侣。'}\n\n`;

        // ─── L4: User Profile ───
        context += `### 互动对象 (User)\n`;
        context += `- 名字: ${user.name}\n`;
        context += `- 聊天显示昵称: ${user.nickname || user.name}\n`;
        if (Array.isArray(user.preferredNames) && user.preferredNames.length > 0) {
            context += `- 称呼偏好 (Preferred Names): ${user.preferredNames.join(', ')}\n`;
        }
        context += `- 设定/备注: ${user.bio || '无'}\n\n`;

        context += `### 身份与称呼原则 (Critical)\n`;
        context += `- 真实身份名字与聊天显示昵称是两层信息，不可混淆。\n`;
        context += `- 聊天显示昵称仅用于UI展示，不代表对话中必须一直用该称呼。\n`;
        context += `- 对话称呼需结合关系与语境自然选择，可用真名、昵称或爱称。\n`;
        context += `- 系统记录、严肃说明、关系日志中保留真实名字用于稳定识别。\n\n`;

        // ─── L4: Impression (Private Psychological Profile) ───
        if (char.impression) {
            const imp = char.impression;
            context += `### [私密档案: 我眼中的${user.name}] (L4 Impression)\n`;
            context += `(注意：以下内容是你内心对TA的真实看法，不要直接告诉用户，但要基于这些看法来决定你的态度。)\n`;
            context += `- 核心评价: ${imp.personality_core.summary}\n`;
            context += `- 互动模式: ${imp.personality_core.interaction_style}\n`;
            context += `- 我观察到的特质: ${imp.personality_core.observed_traits.join(', ')}\n`;
            context += `- TA的喜好: ${imp.value_map.likes.join(', ')}\n`;
            context += `- 情绪雷区: ${imp.emotion_schema.triggers.negative.join(', ')}\n`;
            context += `- 舒适区: ${imp.emotion_schema.comfort_zone}\n`;
            context += `- 最近观察到的变化: ${imp.observed_changes ? imp.observed_changes.join('; ') : '无'}\n\n`;
        }

        // ─── L3a: Dynamic Memories (Current State / Near-term Context) ───
        if (char.dynamicMemories && char.dynamicMemories.length > 0) {
            context += `### 近期动态 (L3a Dynamic Layer)\n`;
            const categories = {
                current_state: '📍 当前状态',
                purpose_context: '🎯 阶段目标',
                on_the_horizon: '🔮 近期规划',
                others: '📎 其他备注',
            };
            for (const [cat, label] of Object.entries(categories)) {
                const items = char.dynamicMemories.filter(m => m.category === cat);
                if (items.length > 0) {
                    context += `**${label}**:\n`;
                    items.forEach(m => context += `- ${m.content}\n`);
                }
            }
            context += `\n`;
        }

        // ─── L3b: Core Proposals (Approved ones merged into context) ───
        if (char.coreProposals) {
            const approved = char.coreProposals.filter(p => p.status === 'approved');
            if (approved.length > 0) {
                context += `### 已确认的核心认知 (L3b Approved Core)\n`;
                approved.forEach(p => {
                    context += `- [${p.category}]: ${p.proposal}\n`;
                });
                context += `\n`;
            }
        }

        // ─── L3 Recent Summaries (daily/weekly/monthly blurb) ───
        if (char.l3SummaryBlurb) {
            context += char.l3SummaryBlurb + '\n\n';
        }

        // ─── L4 Active Observations (profiles/ buffer, pending promotion) ───
        if (char.profilesBlurb) {
            context += char.profilesBlurb + '\n\n';
        }

        // ─── L2: Refined Monthly Core Memory Bank ───
        context += `### 记忆系统 (L2 Memory Bank)\n`;
        let memoryContent = "";

        if (char.refinedMemories && Object.keys(char.refinedMemories).length > 0) {
            memoryContent += `**长期核心记忆 (Key Memories)**:\n`;
            Object.entries(char.refinedMemories).sort().forEach(([date, summary]) => {
                memoryContent += `- [${date}]: ${summary}\n`;
            });
        }

        // Activated detailed logs (supplementary)
        if (includeDetailedMemories && char.activeMemoryMonths && char.activeMemoryMonths.length > 0 && char.memories) {
            let details = "";
            char.activeMemoryMonths.forEach(monthKey => {
                const logs = char.memories.filter(m =>
                    m.date.startsWith(monthKey) || m.date.startsWith(monthKey.replace('-', '年'))
                );
                if (logs.length > 0) {
                    details += `\n> 详细回忆 [${monthKey}]:\n`;
                    logs.forEach(m => {
                        details += `  - ${m.date} (${m.mood || 'rec'}): ${m.summary}\n`;
                    });
                }
            });
            if (details) {
                memoryContent += `\n**当前激活的详细回忆 (Active Recall)**:${details}`;
            }
        }

        if (!memoryContent) {
            memoryContent = "(暂无特定记忆，请基于当前对话互动)";
        }
        context += `${memoryContent}\n\n`;

        return context;
    }
};
