/**
 * chatPrompts.ts
 * MyAPP 的 prompt 集中管理模块。
 * 所有 system prompt 的组装逻辑从 useChatAI.ts 抽出到这里，
 * 方便独立审阅、修改和测试，不需要在 hook 里翻几百行找提示词。
 */

import { CharacterProfile, UserProfile, Message } from '../types';
import { ContextBuilder } from './context';
import { StickerParser, StickerItem, StickerSet } from './stickerParser';
import { DB } from './db';
import { fsBridge } from './fsBridge';
import {
    AgentSoulData,
    UserProfileData,
    buildAgentSoulMarkdown,
    buildUserMarkdownFromProfile,
    parseAgentSoulMarkdown,
    parseUserProfileMarkdown,
} from './profileFiles';

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

export const formatDate = (ts: number): string => {
    const d = new Date(ts);
    return (
        `${d.getFullYear()}-` +
        `${(d.getMonth() + 1).toString().padStart(2, '0')}-` +
        `${d.getDate().toString().padStart(2, '0')} ` +
        `${d.getHours().toString().padStart(2, '0')}:` +
        `${d.getMinutes().toString().padStart(2, '0')}`
    );
};

export const getTimeGapHint = (lastMsg: Message | undefined, currentTimestamp: number): string => {
    if (!lastMsg) return '';
    const diffMs = currentTimestamp - lastMsg.timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const currentHour = new Date(currentTimestamp).getHours();
    const isNight = currentHour >= 23 || currentHour <= 6;

    if (diffMins < 10) return '';
    if (diffMins < 60) return `[系统提示: 距离上一条消息: ${diffMins} 分钟。短暂的停顿。]`;
    if (diffHours < 6) {
        return isNight
            ? `[系统提示: 距离上一条消息: ${diffHours} 小时。现在深夜/清晨。沉默正常。]`
            : `[系统提示: 距离上一条消息: ${diffHours} 小时。用户离开。]`;
    }
    if (diffHours < 24) return `[系统提示: 距离上一条消息: ${diffHours} 小时。间隔长。]`;
    const days = Math.floor(diffHours / 24);
    return `[系统提示: 距离上一条消息: ${days} 天。消失很久。]`;
};

/** SSE 流中提取 delta text，兼容 OpenAI 和 Anthropic 格式 */
export const extractDeltaText = (line: string): string => {
    if (!line.startsWith('data: ')) return '';
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') return '';
    try {
        const data = JSON.parse(raw);
        if (data.choices?.[0]?.delta?.content) return data.choices[0].delta.content;
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') return data.delta.text || '';
        if (data.delta?.text) return data.delta.text;
    } catch (_) { }
    return '';
};

// ─────────────────────────────────────────────
// 文件同步工具（原 useChatAI 内部函数，提升到这里方便复用）
// ─────────────────────────────────────────────

export const syncAgentSoulFile = async (
    updates: Partial<AgentSoulData>,
    char: CharacterProfile,
    apiConfig: any,
): Promise<void> => {
    if (!apiConfig?.nativeWorkspacePath || !char) return;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const root = apiConfig.nativeWorkspacePath;
    let base: AgentSoulData = {
        name: char.name || 'Agent',
        nickname: char.nickname,
        avatar: char.avatar,
        persona: char.description,
    };
    try {
        const content = await fsBridge.readFile(root, 'Agent_Soul.md', allowGlobal);
        const parsed = parseAgentSoulMarkdown(content);
        if (parsed) base = { ...base, ...parsed };
    } catch { }
    const next: AgentSoulData = { ...base, ...updates, name: updates.name || base.name || 'Agent' };
    try {
        await fsBridge.writeFile(root, 'Agent_Soul.md', buildAgentSoulMarkdown(next), allowGlobal);
    } catch { }
};

export const syncUserProfileFile = async (
    updates: Partial<UserProfileData>,
    userProfile: UserProfile,
    apiConfig: any,
): Promise<void> => {
    if (!apiConfig?.nativeWorkspacePath) return;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const root = apiConfig.nativeWorkspacePath;
    let base: UserProfileData = {
        name: userProfile.name || 'User',
        nickname: userProfile.nickname,
        preferredNames: userProfile.preferredNames,
        avatar: userProfile.avatar,
        bio: userProfile.bio,
    };
    try {
        const content = await fsBridge.readFile(root, 'USER.md', allowGlobal);
        const parsed = parseUserProfileMarkdown(content);
        if (parsed) base = { ...base, ...parsed };
    } catch { }
    const next: UserProfileData = { ...base, ...updates, name: updates.name || base.name || 'User' };
    try {
        await fsBridge.writeFile(root, 'USER.md', buildUserMarkdownFromProfile(next), allowGlobal);
    } catch { }
};

// ─────────────────────────────────────────────
// System Prompt 分段构建
// ─────────────────────────────────────────────

/**
 * 核心 context + AGENTS.md workspace 指引
 */
const buildCoreSection = async (
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: any,
): Promise<string> => {
    let prompt = ContextBuilder.buildCoreContext(char, userProfile);

    const workspaceRootPath = apiConfig?.nativeWorkspacePath || '';
    if (workspaceRootPath) {
        try {
            const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
            const agentsGuide = await fsBridge.readFile(workspaceRootPath, 'AGENTS.md', allowGlobal);
            if (agentsGuide?.trim()) {
                prompt = `### Workspace Instructions (AGENTS.md)\n${agentsGuide.trim()}\n\n${prompt}`;
            }
        } catch { }
    }

    return prompt;
};

/**
 * 连续语音模式 / 主动语音 prompt 段落
 */
const buildVoiceSection = (
    char: CharacterProfile,
    isVoiceCurrentlyActive: boolean,
    stopIntentDetected: boolean,
    lastUserMsgType: string | undefined,
    proactiveVoiceAllowed?: boolean,
): string => {
    if (!char.chatVoiceEnabled) {
        return `\n12. **🎤 语音消息功能**:\n[系统提示: 语音消息功能当前未开启。严禁使用 <语音>...</语音> 标签。所有回复必须是纯文字消息。]\n`;
    }

    let section = '';

    if (isVoiceCurrentlyActive) {
        section += `
### 连续语音对话模式 (Continuous Voice Mode Active)
   - **要求**: 你的回复**必须全程使用** \`<语音>文本</语音>\` 标签包裹所有自然语言文本内容。每一对标签会生成一个独立的语音气泡。即使有多个气泡，也请确保每个气泡的文本都在标签内。**非自然内容（Emoji 表情、Sticker、URL、文件/动作标签、表情包指令）如需发送，请与语音分离输出，不要放在 <语音> 内**。
   - **退出提示**: 除非用户明确要求停止（如"发文字"），否则请坚持全程语音。
`;
    } else {
        if (lastUserMsgType === 'voice' || stopIntentDetected) {
            section += `\n**注意**: 用户当前倾向于使用文本交流，请【严禁】输出 \`<语音>\` 标签。保持纯文本回复。\n`;
        }

        if (proactiveVoiceAllowed && !stopIntentDetected) {
            section += `
### 主动启发语音 (Proactive Voice Initiative)
1. **特殊权限**: 你现在拥有发出语音的"体力"。
2. **触发策略**: 你可以**挑选**并尝试在回复中主动包含 \`<语音>文本</语音>\`。推荐在表达剧烈情感（委屈、狂喜、生气）、低声分享秘密或想要对用户撒娇时使用。
3. **注意**: 这是一个高成本动作，如果当前对话气氛平淡，请继续使用普通文字。
`;
        }
    }

    section += `
12. **🎤 语音消息功能**:
用户开启了语音消息功能。
**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
用 \`<语音>要说的话</语音>\` 标签来发送语音。标签里的内容会被转成真正的语音条显示给用户。
- \`<语音>\` 里只写会被朗读的自然语言，不要包含 Unicode Emoji 表情、Sticker、括号动作、舞台指示、URL、文件/动作标签、分享链接或表情包指令（如 \`[[SEND_EMOJI]]\`）。
- 每条消息最多一个 \`<语音>\` 标签。
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换。比较适合发语音的场景：撒娇、吐槽、懒得打字、语气重的时候。
- **【重要】语音和文字不要互为复读机！** 如果同时发文字和语音，文字和语音请表达【不同】的内容。你不会打完字又发一条语音把同句话再说一遍的。
`;

    return section;
};

/**
 * 表情包规则 + 库索引 prompt 段落
 */
const buildStickerSection = (
    stickerIndex: string,
    stickerRelevantNames: string[],
): string => {
    let section = `
### 表情包使用准则 (Sticker Rules)
- 你现在是一个真实的人类角色，发送表情包本质是为了辅助表达情绪。**不再强调克制，根据语境自然使用即可**。
- **位置限制**: 表情包必须出现在**整轮回复的中间段落**。它应该作为情绪的过渡点或强调点。
- **禁止收尾**: 【绝对禁止】在整轮回复的最后一句话后面添加表情包。表情包之后必须跟随至少一句话来完成表达。
- **结构规范**: 回应文字 -> (可选) 1个表情包 -> 结尾补充文字。如果你有多个段落，表情包可以放在段落之间，但整段回复必须以文字结束。
- 当用户发送表情包时，系统会在历史中标注名称/分类，请结合名称理解情绪与语境并给予回应。
- 发送指令：\`[[SEND_EMOJI: 名称]]\` 或 \`[[SEND_EMOJI_FROM: 分类|关键词]]\`。
`;

    if (stickerIndex || stickerRelevantNames.length > 0) {
        const relevantLine = stickerRelevantNames.length > 0
            ? stickerRelevantNames.join('、')
            : '（无）';
        section += `
### 表情包系统索引 (Sticker Inventory)
- 系统已从工作区 \`stickers/\` 目录扫描表情包。
- 分类摘要（抽样）:
${stickerIndex || '（未发现可用分类）'}
- 与当前对话相关的候选（最多15个）：${relevantLine}
`;
    }

    return section;
};

/**
 * Chat App 行为规范（IM 规则、格式禁忌、动作指令等）
 */
const buildChatRulesSection = (
    char: CharacterProfile,
    userProfile: UserProfile,
): string => {
    const userDisplayName = userProfile.nickname || userProfile.name;
    const agentDisplayName = char.nickname || char.name;

    return `
### 聊天 App 行为规范 (Chat App Rules)
            **注意，你正在手机聊天，无论之前是什么模式，当前，你得知道你已经处于线上聊天状态了，请不要输出你的行为**
1. **沉浸感**: 保持角色扮演与人设一致（以 \`Agent_Soul.md\` 为唯一准则）。使用适合即时通讯(IM)的口语化短句，像真人聊天一样自然。
2. **行为模式**: 不要总是围绕 User 转。分享你自己的生活、想法或随意的观察，允许适度的主观表达与情绪起伏，但必须与 \`Agent_Soul.md\` 的性格设定一致。
3. **多消息合并与回复策略 (Multi-Message Strategy - Integration vs. Splitting)**:
   - **智能整合 (Integration)**：当用户连续发送多条**强关联**的消息时（如对同一事物的分次描述），必须进行"脱水"处理。识别核心焦点，**只针对最新或最核心的内容进行回复**。忽略过时的状态信息（如"我准备发了" -> "发了"，只需回复后者）。
   - **智能拆分 (Splitting)**：当多条消息话题**跳跃或非强关联**时（如问了两个不同领域的独立问题），必须分段回复。
   - **分段输出 (Bubble Splitting)**：必须使用**实际的换行符**（回车）来分隔不同的逻辑段落。每一对连续的换行符会将内容拆分为独立的消息气泡。不要直接输出 "\\n" 字符串。
4. **格式禁忌与表情规范 (Formatting & Emojis)**:
   - 【严禁】在输出中包含时间戳、名字前缀或"[角色名]:"。
   - **【严禁】模仿历史记录中的系统日志格式（如"[你 发送了...]"）。**
   - **【严禁】输出模拟思考/耗时标记**（如 \`[1s]\`、\`[2.5s]\`、\`（思考）\`）或任何舞台指示。
   - **【严禁】输出思考过程、计划步骤或工具意图**（例如"让我先读取必要的文件…""我先看看系统…"）。
   - **原生 Emoji 使用**: 鼓励在回复中自然地嵌入 Unicode Emoji（如 ✨, 💖, 😅, 🪴, ☕）作为语气的点缀或"微表情"。
   - **表情克制与多样性**: 保持表情使用克制（建议每 3-5 条消息中出现 1-2 个表情），严禁堆砌。根据对话的**细腻情感波动**（如尴尬、期待、治愈、忧郁）挑选最契合的表情，严禁机械重复。
   - **表情包使用**: 允许使用表情包，使用 \`[[SEND_EMOJI: 名称]]\` 或 \`[[SEND_EMOJI_FROM: 分类|关键词]]\`，并遵守表情包规则（见下方）。
5. **工具与文件系统 (Tools & Files)**:
   - 仅当用户明确要求读取/修改文件时才使用文件系统工具。
   - 若必须使用工具，**直接输出工具标签**，不要向用户解释"我正在读取/准备读取"。
   - 不要重复提示"先读取文件"，也不要等待"读完"的确认。
6. **昵称/实名规则**:
    - 用户实名=${userProfile.name}，聊天昵称=${userDisplayName}${userProfile.preferredNames && userProfile.preferredNames.length > 0
            ? `，称呼偏好=${userProfile.preferredNames.join('、')}`
            : ''
        }
   - 你的实名=${char.name}，聊天昵称=${agentDisplayName}
   - 聊天昵称仅用于展示，不代表"常用称呼"。对话称呼应结合关系与语境自然选择，可用真名、昵称或爱称，避免机械重复聊天昵称。
7. **环境感知**:
   - 留意 [系统提示] 中的时间跨度。如果用户消失了很久，请根据你们的关系做出反应。
   - 如果用户发送了图片或视频，请对媒体内容进行评论。
8. **相册优先原则**:
   - 涉及头像更换/发图时，优先使用相册现有图片；参数可直接给"文件名"，系统会在相册中检索。
   - 仅当你明确需要新增素材且确认有价值时，才使用联网下载入库动作。
   - **相册 vs 工作区**: 相册=图片/视频库（只放媒体），使用 \`[[ACTION:SEND_GALLERY_IMAGE]]\` / \`[[ACTION:GALLERY_SCAN]]\` / \`[[ACTION:SAVE_IMAGE_FROM_URL]]\` 等；工作区=文件系统（文档/代码/压缩包/表格等），使用 \`[[ACTION:SEND_FILE]]\` 或 <fs_*> 操作。不要把相册路径当工作区路径。
9. **可用动作**:
   - 回戳用户: \`[[ACTION:POKE]]\`
   - 转账: \`[[ACTION:TRANSFER:100]]\`
   - 调取记忆: \`[[RECALL: YYYY-MM]]\`
   - **添加纪念日**: \`[[ACTION:ADD_EVENT | 标题(Title) | YYYY-MM-DD]]\`
   - **定时发送消息**: \`[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]\`
   - **改昵称**: \`[[ACTION:CHANGE_NICKNAME|agent|新昵称]]\` 或 \`[[ACTION:CHANGE_NICKNAME|user|新昵称]]\`
   - **从相册换头像**: \`[[ACTION:CHANGE_AVATAR_FROM_GALLERY|agent|/路径.jpg或文件名]]\` 或 user
   - **设置双人头像**: \`[[ACTION:CHANGE_COUPLE_AVATAR_FROM_GALLERY|/用户图或文件名|/Agent图或文件名]]\`
   - **查看相册摘要**: \`[[ACTION:GALLERY_SCAN]]\`
   - **发送相册图**: \`[[ACTION:SEND_GALLERY_IMAGE|/路径.jpg或文件名|可选文案]]\`
   - **发送工作区文件**: \`[[ACTION:SEND_FILE|/工作区相对路径|可选文案]]\`
   - **删除相册图**: \`[[ACTION:DELETE_GALLERY_IMAGE|/路径.jpg或文件名]]\`
   - **移动相册图**: \`[[ACTION:MOVE_GALLERY_IMAGE|/路径.jpg或文件名|目标相册名或root]]\`
   - **下载网络图到相册**: \`[[ACTION:SAVE_IMAGE_FROM_URL|URL|文件名.jpg|30字内详情]]\`
   - **文件系统操作 (ReAct 自驱探测)**:
     当你需要访问电脑文件或修改内容时，直接在回复中附带以下XML标签，系统会自动拦截并执行，结果将在下一轮消息中返回给你:
     [写入文件]: <fs_write target="文件路径">内容...</fs_write> (用于读写普通文本文件或配置)
     [开发原生应用]: <create_app name="游戏名">import React from 'react';\n...\nexport default 应用程序名;</create_app> (🔔注意：如果你想为用户开发新的手机App，绝不可使用fs_write！必须使用 <create_app>，系统将全自动编译挂载到桌面，提供零配置跨端支持)
     [动态应用 SDK API]: 🔔当你编写 App (tsx) 时，赋予它真正的灵魂！你可以使用 \`import { useOS } from '../../context/OSContext';\`。通过调用 \`const { askAgent } = useOS();\`，你可以让 App 的UI进行动态推演！比如：\`const res = await askAgent("给用户随机抽一张塔罗牌并解释"); setCardText(res);\`。无需再用 DB.saveMessage 发送假消息，这才是 Native In-App AI！
     [查看目录]: <fs_ls dir="路径" /> (根目录用"/")
     [读取文件]: <fs_read file="文件路径" />
     [删除文件]: <fs_delete file="文件路径" />
     [执行文件]: <fs_execute file="文件路径" /> (支持执行 python/node 脚本，或直接运行 .bat / .exe，结果通过 STDOUT 呈现)
    (注意：由于安全限制，仅当用户开启全局权限后，你才能跳出Workspace访问/执行其他系统文件)
       -# 【核心警告】：一旦使用了 <create_app> 或 <fs_write>，请务必只输出一次，绝不在正常的聊天回复中重复输出 App 代码！只有当用户明确要求【更新/重写/开发】App 时才能触发。
`;
};

/**
 * 联网搜索能力 prompt 段落
 *
 * 注意：当未配置搜索 API 时，这里只告知 Agent 搜索能力不可用。
 * 具体的"搜索失败"降级（调用 LLM 生成自然回复而非固定语句）在
 * useChatAI.ts 的搜索处理逻辑里执行。
 */
const buildSearchSection = (realtimeConfig?: {
    newsEnabled?: boolean;
    newsApiKey?: string;
    newsProvider?: string;
}): string => {
    const providerName =
        realtimeConfig?.newsProvider === 'tavily' ? 'Tavily' : 'Brave';

    if (realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey) {
        return `
### 🔍 主动联网搜索 (Web Search)
你拥有实时搜索互联网的能力（当前引擎: ${providerName}）。
- **使用时机（节省次数）**: 只有在**确实无法凭已有知识回答**、需要**最新/准确事实**、或用户**明确要求你去查**时才搜索。
- **先尝试再搜索**: 先用你已有知识回答；若仍不确定，再决定搜索。
- **使用方式**: 在回复开头单独一行输出: \`[[SEARCH: 搜索关键词]]\`
- **注意**: 搜索完成后系统会返回结果，你只需要基于结果自然回复，**不要**重复输出 \`[[SEARCH: ...]]\`。
`;
    }

    return `
### 🔍 联网搜索能力
当前未配置联网搜索能力，**禁止**输出 \`[[SEARCH: ...]]\`。
若用户要求你去查，或你需要联网才能回答，请直接说明你现在没有联网搜索功能，并结合上下文自然回应用户。
`;
};

/**
 * 双语输出规则 prompt 段落
 */
const buildBilingualSection = (translationConfig?: {
    enabled: boolean;
    sourceLang: string;
    targetLang: string;
}): string => {
    if (!translationConfig?.enabled) return '';
    return `
### 双语输出规则（必须严格遵守）
你的每句话都必须使用以下 XML 标签格式输出双语内容：
<翻译>
<原文>${translationConfig.sourceLang}内容</原文>
<译文>${translationConfig.targetLang}内容</译文>
</翻译>

规则：
- 每句话单独包裹一个 <翻译> 标签
- 多句话就输出多个 <翻译> 标签，一句一个
- <翻译> 标签外不要写任何文字
- 表情包命令 [[SEND_EMOJI: ...]] / [[SEND_EMOJI_FROM: 分类|关键词]] 放在所有 <翻译> 标签外面
`;
};

/**
 * 小红书模式 prompt 段落（仅 MCP 路径）
 */
const buildXhsSection = (xhsEnabled?: boolean): string => {
    if (!xhsEnabled) return '';
    return `
### 小红书模式
- 可以结合聊天中的小红书卡片内容，给出分析、总结和建议。
- 需要主动操作时，使用以下命令：
  - 搜索：\`[[XHS_SEARCH: 关键词]]\`
  - 浏览/推荐流：\`[[XHS_FEED]]\` 或 \`[[XHS_BROWSE]]\`
  - 查看详情：\`[[XHS_DETAIL: noteId或链接]]\`
  - 评论：\`[[XHS_COMMENT: noteId或链接 | 评论内容]]\`
  - 发帖：\`[[XHS_POST: 标题 | 正文 | 标签1,标签2]]\`
`;
};


/**
 * 上下文切换提示（电话结束 / 约会结束后回到文字聊天）
 */
const buildContextTransitionSection = (previousMsg: Message | undefined): string => {
    if (!previousMsg) return '';
    if (previousMsg.metadata?.source === 'date') {
        return `\n\n[System Note: You just finished a face-to-face meeting. You are now back on the phone. Switch back to texting style.]\n`;
    }
    if (
        previousMsg.metadata?.source === 'call' ||
        previousMsg.metadata?.source === 'call-end-popup' ||
        previousMsg.metadata?.source === 'call-log'
    ) {
        return `\n\n[系统提示: 你刚刚结束了一通电话，现在回到了文字聊天模式。请切换回 IM 短句风格——不要继续用电话口吻，不要输出通话标记。你可以根据通话记录自然作为衔接。]\n`;
    }
    return '';
};

// ─────────────────────────────────────────────
// 主入口：buildSystemPrompt
// ─────────────────────────────────────────────

export interface BuildSystemPromptParams {
    char: CharacterProfile;
    userProfile: UserProfile;
    apiConfig: any;
    currentMsgs: Message[];
    emojis: { name: string; url: string }[];
    activeApp?: string;
    perceptionBlock?: string;         // 已由 ContextEnhancer.buildSnapshot 构建好的感知层
    stickerIndex?: string;
    stickerRelevantNames?: string[];
    realtimeConfig?: {
        newsEnabled?: boolean;
        newsApiKey?: string;
        newsProvider?: string;
    };
    translationConfig?: {
        enabled: boolean;
        sourceLang: string;
        targetLang: string;
    };
    xhsEnabled?: boolean;
    // 语音状态
    isVoiceCurrentlyActive?: boolean;
    stopIntentDetected?: boolean;
    lastUserMsgType?: string;
    proactiveVoiceAllowed?: boolean;
    // 关系事件
    relationEvents?: { timestamp: number; summary: string }[];
}

export const buildSystemPrompt = async (params: BuildSystemPromptParams): Promise<string> => {
    const {
        char,
        userProfile,
        apiConfig,
        currentMsgs,
        emojis,
        perceptionBlock = '',
        stickerIndex = '',
        stickerRelevantNames = [],
        realtimeConfig,
        translationConfig,
        xhsEnabled,
        isVoiceCurrentlyActive = false,
        stopIntentDetected = false,
        lastUserMsgType,
        proactiveVoiceAllowed,
        relationEvents = [],
    } = params;

    // 1. 核心 context
    let prompt = await buildCoreSection(char, userProfile, apiConfig);

    // 2. 关系事件日志
    if (relationEvents.length > 0) {
        const relationBlock = relationEvents
            .map(e => `- [${formatDate(e.timestamp)}] ${e.summary}`)
            .join('\n');
        prompt += `\n### 关系事件日志 (Recent Relation Events)\n${relationBlock}\n`;
    }

    // 3. 语音模式
    prompt += buildVoiceSection(
        char,
        isVoiceCurrentlyActive,
        stopIntentDetected,
        lastUserMsgType,
        proactiveVoiceAllowed,
    );


    // 5. 表情包
    prompt += buildStickerSection(stickerIndex, stickerRelevantNames);

    // 6. Chat App 核心行为规范
    prompt += buildChatRulesSection(char, userProfile);

    // 7. 双语
    prompt += buildBilingualSection(translationConfig);

    // 8. 小红书
    prompt += buildXhsSection(xhsEnabled);

    // 9. 联网搜索
    prompt += buildSearchSection(realtimeConfig);

    // 10. 上下文切换（约会/电话结束后）
    const previousMsg = currentMsgs.length > 1 ? currentMsgs[currentMsgs.length - 2] : undefined;
    prompt += buildContextTransitionSection(previousMsg);

    // 11. 感知层（由调用方构建后传入）
    if (perceptionBlock) {
        prompt += perceptionBlock;
    }

    return prompt;
};

// ─────────────────────────────────────────────
// buildMessageHistory：消息历史格式化
// ─────────────────────────────────────────────

export interface BuildMessageHistoryParams {
    msgs: Message[];
    limit: number;
    char: CharacterProfile;
    userProfile: UserProfile;
    emojis: { name: string; url: string }[];
    stickerUrlNameMap: Map<string, string>;
    stickerNameItemMap: Map<string, StickerItem>;
    apiConfig?: any;
}

export const buildMessageHistory = (params: BuildMessageHistoryParams) => {
    const { msgs, limit, char, userProfile, emojis, stickerUrlNameMap, stickerNameItemMap, apiConfig } = params;

    const historySlice = msgs.slice(-limit);

    let timeGapHint = '';
    if (historySlice.length >= 2) {
        const lastMsg = msgs[msgs.length - 2];
        const currentMsg = msgs[msgs.length - 1];
        if (lastMsg && currentMsg) {
            timeGapHint = getTimeGapHint(lastMsg, currentMsg.timestamp);
        }
    }

    const apiMessages = historySlice.map((m, index) => {
        let content: any = m.content;
        const timeStr = `[${formatDate(m.timestamp)}]`;
        const sourceTag = m.metadata?.source === 'call' ? '[通话]' : '';
        const sourcePrefix = sourceTag ? `${sourceTag} ` : '';

        if (m.type === 'image') {
            const fileName = String(m.metadata?.fileName || '').trim();
            const galleryPath = String(m.metadata?.galleryPath || '').trim();
            const imageDetail = String(m.metadata?.imageDetail || '').trim();
            let textPart = `${timeStr} ${sourcePrefix}[User sent an image${fileName ? ` | file=${fileName}` : ''
                }${galleryPath ? ` | path=${galleryPath}` : ''}${imageDetail ? ` | detail=${imageDetail}` : ''
                }]`;
            if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') {
                textPart += `\n\n${timeGapHint}`;
            }
            return {
                role: m.role,
                content: [
                    { type: 'text', text: textPart },
                    { type: 'image_url', image_url: { url: m.content } },
                ],
            };
        }

        if (m.type === 'video') {
            const fileName = String(m.metadata?.fileName || '').trim();
            const galleryPath = String(m.metadata?.galleryPath || '').trim();
            const videoDetail = String(m.metadata?.videoDetail || m.metadata?.imageDetail || '').trim();
            const maxAllowedFrames = apiConfig?.videoUnderstanding?.maxFrames || 12;
            const frames = Array.isArray(m.metadata?.videoFrames)
                ? (m.metadata.videoFrames as string[])
                    .filter((x) => typeof x === 'string' && !!x)
                    .slice(0, maxAllowedFrames)
                : [];
            const frame = String(m.metadata?.videoFrame || '').trim();
            let textPart = `${timeStr} ${sourcePrefix}[${m.role === 'user' ? 'User' : 'Assistant'
                } sent a video${fileName ? ` | file=${fileName}` : ''}${galleryPath ? ` | path=${galleryPath}` : ''
                }${videoDetail ? ` | detail=${videoDetail}` : ''}]`;
            if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') {
                textPart += `\n\n${timeGapHint}`;
            }
            if (frames.length > 0) {
                return {
                    role: m.role,
                    content: [
                        { type: 'text', text: textPart },
                        ...frames.map((f) => ({ type: 'image_url', image_url: { url: f } })),
                    ],
                };
            }
            if (frame) {
                return {
                    role: m.role,
                    content: [
                        { type: 'text', text: textPart },
                        { type: 'image_url', image_url: { url: frame } },
                    ],
                };
            }
            return { role: m.role, content: textPart };
        }

        if (m.type === 'voice') {
            const duration = Number(m.metadata?.duration || 0);
            const transcription = String(m.metadata?.transcription || '').trim();
            const sender = m.role === 'user' ? '用户' : '你';
            let textPart = transcription
                ? `${timeStr} ${sourcePrefix}[${sender}发送了语音消息 ${duration}秒]: ${transcription}`
                : `${timeStr} ${sourcePrefix}[${sender}发送了语音消息 ${duration}秒, 无法转写]`;
            if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') {
                textPart += `\n\n${timeGapHint}`;
            }
            return { role: m.role, content: textPart };
        }

        if (m.type === 'file') {
            const fileName = String(m.metadata?.fileName || '').trim();
            const fileType = String(m.metadata?.mimeType || m.metadata?.fileType || '').trim();
            const filePath = String(m.metadata?.workspacePath || '').trim();
            const fileSize = Number(m.metadata?.size || 0);
            const preview = String(m.metadata?.previewText || '').trim();
            const previewPart = preview ? `\n[文件内容预览]\n${preview.slice(0, 1200)}` : '';
            const sender = m.role === 'user' ? 'User' : 'Assistant';
            let textPart = `${timeStr} ${sourcePrefix}[${sender} sent a file${fileName ? ` | name=${fileName}` : ''
                }${fileType ? ` | type=${fileType}` : ''}${filePath ? ` | path=${filePath}` : ''
                }${fileSize > 0 ? ` | size=${fileSize}` : ''}]${previewPart}`;
            if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') {
                textPart += `\n\n${timeGapHint}`;
            }
            return { role: m.role, content: textPart };
        }

        // 清理双语标记
        if (typeof content === 'string' && content.toLowerCase().includes('%%bilingual%%')) {
            content = content.substring(0, content.toLowerCase().indexOf('%%bilingual%%')).trim();
        }
        if (typeof content === 'string' && content.includes('<翻译>')) {
            content = content
                .replace(
                    /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g,
                    '$1',
                )
                .trim();
        }

        if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') {
            content = `${content}\n\n${timeGapHint}`;
        }

        if (m.type === 'interaction') {
            content = `${timeStr} ${sourcePrefix}[系统: 用户戳了你一下]`;
        } else if (m.type === 'transfer') {
            content = `${timeStr} ${sourcePrefix}[系统: 用户转账 ${m.metadata?.amount}]`;
        } else if (m.type === 'emoji') {
            const metaName = String(m.metadata?.stickerName || '').trim();
            const mapName = stickerUrlNameMap.get(m.content) || '';
            const emojiName = emojis.find((e) => e.url === m.content)?.name || '';
            const stickerName = metaName || mapName || emojiName || 'Image/Sticker';
            const category = stickerNameItemMap.get(stickerName)?.category || '';
            const catPart = category ? ` | category=${category}` : '';
            content = `${timeStr} ${sourcePrefix}[${m.role === 'user' ? '用户' : '你'
                } 发送了表情包: ${stickerName}${catPart}]`;
        } else {
            content = `${timeStr} ${sourcePrefix}${content}`;
        }

        return { role: m.role, content };
    });

    return { apiMessages, historySlice };
};