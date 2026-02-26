
import { CharacterProfile, UserProfile } from '../types';

/**
 * Memory Central
 * 负责统一构建所有 App 共用的基础角色上下文 (System Prompt)。
 * 包含：身份设定、用户画像、世界观、核心记忆、详细记忆、以及角色内心看法。
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

        // 1. 核心身份 (Identity)
        context += `### 你的身份 (Character)\n`;
        context += `- 名字: ${char.name}\n`;
        // Change: Explicitly label description as User Note to avoid literal interpretation
        context += `- 用户备注/爱称 (User Note/Nickname): ${char.description || '无'}\n`;
        context += `  (注意: 这个备注是用户对你的称呼或印象，可能包含比喻。如果备注内容（如“快乐小狗”）与你的核心设定冲突，请以核心设定为准，不要真的扮演成动物，除非核心设定里写了你是动物。)\n`;
        context += `- 核心性格/指令:\n${char.systemPrompt || '你是一个温柔、拟人化的AI伴侣。'}\n\n`;

        // 2. 世界观 (Worldview) - New Centralized Logic
        if (char.worldview && char.worldview.trim()) {
            context += `### 世界观与设定 (World Settings)\n${char.worldview}\n\n`;
        }

        // 3. 用户画像 (User Profile)
        context += `### 互动对象 (User)\n`;
        context += `- 名字: ${user.name}\n`;
        context += `- 设定/备注: ${user.bio || '无'}\n\n`;

        // 4. [NEW] 印象档案 (Private Impression)
        // 这是角色对用户的私密看法，只有角色知道
        if (char.impression) {
            const imp = char.impression;
            context += `### [私密档案: 我眼中的${user.name}] (Private Impression)\n`;
            context += `(注意：以下内容是你内心对TA的真实看法，不要直接告诉用户，但要基于这些看法来决定你的态度。)\n`;
            context += `- 核心评价: ${imp.personality_core.summary}\n`;
            context += `- 互动模式: ${imp.personality_core.interaction_style}\n`;
            context += `- 我观察到的特质: ${imp.personality_core.observed_traits.join(', ')}\n`;
            context += `- TA的喜好: ${imp.value_map.likes.join(', ')}\n`;
            context += `- 情绪雷区: ${imp.emotion_schema.triggers.negative.join(', ')}\n`;
            context += `- 舒适区: ${imp.emotion_schema.comfort_zone}\n`;
            context += `- 最近观察到的变化: ${imp.observed_changes ? imp.observed_changes.join('; ') : '无'}\n\n`;
        }

        // 5. 记忆库 (Memory Bank)
        context += `### 记忆系统 (Memory Bank)\n`;
        let memoryContent = "";

        // 5a. 长期核心记忆 (Refined Memories)
        if (char.refinedMemories && Object.keys(char.refinedMemories).length > 0) {
            memoryContent += `**长期核心记忆 (Key Memories)**:\n`;
            Object.entries(char.refinedMemories).sort().forEach(([date, summary]) => { 
                memoryContent += `- [${date}]: ${summary}\n`; 
            });
        }

        // 5b. 激活的详细记忆 (Active Detailed Logs)
        if (includeDetailedMemories && char.activeMemoryMonths && char.activeMemoryMonths.length > 0 && char.memories) {
            let details = "";
            char.activeMemoryMonths.forEach(monthKey => {
                // monthKey format: YYYY-MM
                const logs = char.memories.filter(m => m.date.startsWith(monthKey) || m.date.startsWith(monthKey.replace('-', '年')));
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