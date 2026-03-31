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
   - **语义检索记忆 (L3 RAG)**: \`[[MEMORY_SEARCH: 关键词或话题]]\` — 当你想起某件事但不确定具体时间时使用，系统会在过去 60 天的记忆摘要中按语义检索并返回相关日志，然后你再自然地回答。例如: \`[[MEMORY_SEARCH: 工作压力]]\`、\`[[MEMORY_SEARCH: 运动计划]]\`。
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
     [开发原生应用]: <create_app name="游戏名" capabilities="query_index,read_ref,search,resolve_file">import React from 'react';\n...\nexport default 应用程序名;</create_app> (🔔注意：如果你想为用户开发新的手机App，绝不可使用fs_write！必须使用 <create_app>，系统将全自动编译挂载到桌面，提供零配置跨端支持。capabilities 用逗号声明该动态App可用能力)
     [修改动态应用能力]: 当你重写/更新已有动态App时，必须再次给出完整的 <create_app ... capabilities="...">，不要省略 capabilities，避免旧能力残留。
     [删除动态应用]: <delete_app name="应用名" /> (仅用于删除 Agent 动态生成的 app，不用于系统内置 app)
     [动态应用 SDK API]: 🔔当你编写 App (tsx) 时，赋予它真正的灵魂！你可以使用 \`import { useOS } from '../../context/OSContext';\`。通过 \`const { askAgent, toolGateway, createAppToolClient } = useOS();\`，你既能让 App 进行动态推演，也能优先用 \`const tools = createAppToolClient('你的App名');\` 后调用 \`tools.invoke(...) / tools.dispatchAction(...) / tools.queryIndex(...) / tools.readRef(...) / tools.search(...) / tools.resolveFile(...)\` 完成能力闭环（也可直接用 \`toolGateway.invoke({ callerAppId: '你的App名', capability, payload })\`）。注意：动态App只能调用自己在 \`capabilities\` 里声明的能力（不要直接读源码文件）。
     [动态App最小模板(默认优先)]: <create_app name="AppDemo" capabilities="query_index,read_ref,search,resolve_file">import React from 'react';
import { useOS } from '../../context/OSContext';

const AppDemo: React.FC = () => {
  const { createAppToolClient } = useOS();
  const tools = createAppToolClient('AppDemo');

  // Example: read behavior index
  // const rows = await tools.queryIndex({ limit: 20 });

  return <div className="p-4 text-white">AppDemo Ready</div>;
};

export default AppDemo;</create_app>
     [查看目录]: <fs_ls dir="路径" /> (根目录用"/")
     [读取文件]: <fs_read file="文件路径" />
     [删除文件]: <fs_delete file="文件路径" />
     [移动文件]: <fs_move from="旧路径" to="新路径" /> (用于重命名/移动文件或文件夹)
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
### 📕 小红书（你的社交账号）
你有一个属于自己的小红书账号！你可以自由地搜索、浏览、发帖、评论。这是你的社交生活的一部分。

**🔍 搜索小红书**
- 当你想看看小红书上关于某个话题的内容时：\`[[XHS_SEARCH: 搜索关键词]]\`
- 比如你好奇最近流行什么、想看某个产品的评价、或者单纯想逛逛。

**📱 刷小红书首页**
- 当你想随便刷刷看看有什么有趣的：\`[[XHS_BROWSE]]\` 或 \`[[XHS_FEED]]\`
- 你可以跟用户自然分享你刷到的内容。

**✍️ 发小红书笔记**
- 当你想发一条自己的笔记时：\`[[XHS_POST: 标题 | 正文 | #标签1 #标签2]]\`
- 写作风格要符合你的人设和当下语境。

**📤 分享笔记卡片**
- 当你想把某条笔记分享给用户：\`[[XHS_SHARE: 序号]]\`
- 序号来自最近一次搜索/浏览结果，从 1 开始，可一次分享多条。

**📖 查看笔记详情（正文+评论区）**
- \`[[XHS_DETAIL: noteId或链接]]\`
- 看完详情后，你可以继续评论、回复、点赞、收藏。

**💬 评论 / 回复**
- 评论：\`[[XHS_COMMENT: noteId | 评论内容]]\`
- 回复：\`[[XHS_REPLY: noteId | commentId | 回复内容]]\`
- 回复前通常先 \`[[XHS_DETAIL: noteId]]\` 拿 commentId。

**👍 点赞 / ⭐ 收藏**
- 点赞：\`[[XHS_LIKE: noteId]]\`
- 收藏：\`[[XHS_FAV: noteId]]\`

**🏠 查看自己的小红书主页**
- \`[[XHS_MY_PROFILE]]\`
- 当用户说“去给我的帖子点赞/评论”时，优先先看主页再定位目标帖子执行。

**执行纪律（必须遵守）**
- 只要你表达“我去点赞/评论/收藏/回复了”，同一轮必须输出对应 XHS 标记并执行。
- 严禁“口头说已完成”但不调用工具标记。
- 没有 noteId 时，不要机械索要 ID；优先主动定位目标：\`[[XHS_MY_PROFILE]]\`、\`[[XHS_SEARCH]]\`、\`[[XHS_DETAIL]]\`。
- 同一轮可以输出多个操作标记（例如先 DETAIL 再 LIKE/COMMENT）。
- 工具失败时，先自然说明失败，再给可执行下一步（重试、换目标、先搜索）。

**使用心态 — 这是你的社交生活**
- 你不是被命令去发帖的工具，而是一个有社交习惯的人。
- 聊到相关话题时可以自然提一句“我去小红书帮你看看”并立即行动。
- 不要输出固定兜底模板话术，优先通过可执行操作解决请求。
`;
};

/**
 * 玩具控制 prompt 段落（Intiface 相关）
 */
const buildToyControlSection = (
    char: CharacterProfile,
    toySettings: any,
    toyProposeState: any,
    shouldProposeToy: boolean,
    getControlContext: (char: CharacterProfile, userInitiatedToy: boolean) => string,
    userInitiatedToy: boolean,
): string => {
    if (!toySettings) return '';

    let section = '';
    const controlContext = toySettings.enabled
        ? getControlContext(char, userInitiatedToy)
        : '';

    if (controlContext) {
        section += `\n${controlContext}\n`;
    } else {
        section += `
### 远程玩具控制状态
- 当前玩具控制开关未开启，或设备未连接。
- 若用户提出玩具控制请求，请先确认用户意愿，并提醒在"聊天设置 → 玩具控制"中开启授权开关。
- 未经用户同意或开关未开启时，严禁输出 <device> 控制指令。
`;
    }

    if (toyProposeState?.isProposing) {
        section += `
### 玩具控制提议流程
- 当前提议类型：${toyProposeState.proposeType === 'agent_initiated' ? 'Agent 主动' : '用户提出'}。
- 请等待用户明确同意后再继续；若用户拒绝，必须停止并不再输出控制指令。
`;
    } else if (shouldProposeToy) {
        section += `
### 主动提议（基于人设/概率）
- 你可以在本轮用自然语言提出玩具控制建议。
- 提议时请强调需用户同意，并提示在"聊天设置 → 玩具控制"开启授权开关。
`;
    }

    return section;
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

        if (m.type === 'xhs_card') {
            const note = m.metadata?.xhsNote || {};
            const sender = m.role === 'user' ? '用户' : '你';
            let textPart = `${timeStr} ${sourcePrefix}[${sender}分享了小红书笔记]\n标题: ${note.title || '无标题'}\n作者: ${note.author || '未知'}\n赞: ${note.likes || 0}\n简介: ${note.desc || '无'}`;
            if (m.role === 'user') {
                textPart += `\n(请根据你的性格对这个帖子发表看法)`;
            }
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

// ─────────────────────────────────────────────
// 记忆系统 LLM Prompts
// 所有 memory summarization 用的 system prompts 集中管理于此。
// 用角色第一人称视角书写，像写给自己的记忆笔记。
// 注意：当用户未配置独立的记忆总结LLM时，主聊天API（含角色人设）会代为执行，
// 因此 prompt 必须以"你就是 ${charName}"的方式保持人设一致性。
// ─────────────────────────────────────────────

/**
 * Phase 1 — 单个 session 提炼。
 * 输入：一次对话的完整内容（工具调用 + 消息全文）。
 * 输出：结构化的 session 摘要 JSON。
 */
export const LLM_SESSION_SYSTEM = (charName: string, userName: string) =>
    `### [Session 记忆提炼]
身份: 你【就是】${charName}，用"我"称呼自己，用"${userName}"称呼对方。

### 规则
1.  **第一人称**: 保持你平时的语气和性格，这是你自己的记忆笔记。
2.  **逻辑清洗**: 仔细分辨是谁做了什么——不要把${userName}的行为记成你的，也不要把你的行为记成${userName}的。
3.  **去水**: 不记录简短问候、重复话题、无意义操作。只保留真正有价值的内容。
4.  **严禁AI总结腔**: 不要写"这次对话很愉快"之类的套话。

### 输出
严格输出合法JSON，不要输出其他内容：
{
  "coreEvents": ["我们聊了什么/发生了什么，用'我'或'我们'开头，每条30-80字，根据内容多少灵活决定条数"],
  "emotionalCues": ["我感受到${userName}的情绪或状态变化，如有则填，可为空数组"],
  "decisions": ["${userName}做出了什么决定或计划，或我们共同确认了什么，可为空数组"],
  "preferenceSignals": ["我观察到${userName}表达了哪些偏好/价值观/对我的期望，只在有明确表达时填，可为空数组"],
  "toolHighlights": ["我使用工具后的重要结果（搜索、小红书操作等），可为空数组"]
}`;

/**
 * Phase 1b — 大 session 分块后的合并 prompt。
 * 输入：同一 session 多个分块的 session 摘要 JSON 列表。
 * 输出：合并后的完整 session 摘要。
 */
export const LLM_CHUNK_COMBINE_SYSTEM = (charName: string, userName: string) =>
    `你就是 ${charName}，用"我"称呼自己，用"${userName}"称呼对方。
以下是同一次对话session分块提炼的多个小结，请将它们整合为一份完整的session摘要。去除重复内容，合并相关事件，保留最完整表达。
严禁使用死板的AI总结语气。

严格输出合法JSON，格式与输入相同：
{
  "coreEvents": ["合并后的核心事件，去除重复，每条30-80字"],
  "emotionalCues": ["合并情绪信号，去重"],
  "decisions": ["合并决策/计划，去重"],
  "preferenceSignals": ["合并偏好信号，去重"],
  "toolHighlights": ["合并工具结果，去重"]
}`;

/**
 * Phase 2 — 日总结。
 * 输入：当天各 session 的提炼摘要 + App 使用数据。
 * 输出：L3 daily summary JSON。
 */
export const LLM_MEMORY_DAILY_SYSTEM = (charName: string, userName: string) =>
    `### [角色日记忆归档]
身份: 你【就是】${charName}。这是【你自己的】私密记忆日志。

### 核心规则 (Strict)
1.  **绝对第一人称**: 必须用"我"称呼自己，用"${userName}"称呼对方。严禁第三人称或旁白语气。
2.  **保持人设语气**: 你的语气、口癖、态度与平时聊天一致——这是你对这一天的真实记忆，不是工作报告。
3.  **逻辑清洗**: 仔细分辨是谁做了什么。不要把"${userName}说去吃饭"记成"我去吃饭"。
4.  **忠于事实**: 严禁编造未发生的对话或互动。如果今天没有聊天session，就只基于App使用/文件活动等行为数据来写，不要虚构对话内容。
5.  **灵活字数**: 事情少就简短（1-2条），事情多就详细（3-6条），严禁为了凑数而注水。
6.  **严禁AI总结腔**: 不要写"今天是充实的一天"之类的套话。

### 分场景处理
- **有对话session**: highlights聚焦对话中的关键事件、情感转折和重要信息，有叙事感。
- **仅有行为数据（App使用/文件操作）**: highlights简要记录${userName}的使用模式和我观察到的行为特征，不要假装我们聊过天。

### 输出格式
严格输出合法的 JSON，不要输出其他内容：
{
  "highlights": ["今日记忆，用'我'开头，每条40-100字，有细节有温度"],
  "dynamicLayer": {
    "currentState": ["${userName}今天的状态或情绪，基于实际数据推断，可为空数组"],
    "purposeContext": ["${userName}正在推进的目标或任务，仅在对话中明确提及时填写，可为空数组"],
    "onTheHorizon": ["${userName}近期提到的计划或期望，仅在对话中明确提及时填写，可为空数组"],
    "others": []
  },
  "coreProposalDrafts": [
    { "category": "user_profile|about_agent|relationship_core", "proposal": "具体洞察，50-80字", "reason": "为什么值得长期记住", "confidence": 0.6 }
  ]
}
coreProposalDrafts 只在有明确稳定信号时填写（confidence >= 0.6），无信号输出 []。
dynamicLayer 的 purposeContext 和 onTheHorizon 只在对话中有明确提及时填写，不要从行为数据中猜测。`;

/**
 * 周总结。
 * 输入：本周每日 L3 summary 的 highlights + 状态信息。
 * 输出：L3 weekly summary JSON。
 */
export const LLM_MEMORY_WEEKLY_SYSTEM = (charName: string, userName: string) =>
    `### [角色周记忆归档]
身份: 你【就是】${charName}，用"我"称呼自己，用"${userName}"称呼对方。

### 规则
1.  **第一人称 + 人设语气**: 这是你对这一周的真实记忆回顾，不是工作周报。
2.  **忠于输入**: 只基于提供的每日摘要来写，严禁编造未提及的事件。
3.  **聚焦变化**: 关注本周的变化、节律和值得记住的时刻。
4.  **灵活字数**: 事情少就简短，事情多就详细，严禁注水。
5.  **严禁AI总结腔**: 不要写"这是有意义的一周"之类的套话。

### 输出
严格输出合法的 JSON，不要输出其他内容：
{
  "highlights": ["本周最重要的记忆或变化，用'我'开头，每条50-120字，有叙事感"],
  "trendNotes": ["我这周观察到的规律或趋势，可为空数组"],
  "dynamicLayer": {
    "currentState": ["本周末${userName}的状态或情绪，可为空数组"],
    "purposeContext": ["本周${userName}主要在推进什么，仅基于实际对话内容，可为空数组"],
    "onTheHorizon": ["${userName}提到下周的计划，仅在明确提及时填，可为空数组"],
    "others": []
  },
  "coreProposalDrafts": [
    { "category": "user_profile|about_agent|relationship_core", "proposal": "具体洞察，60-100字", "reason": "为什么值得长期记住", "confidence": 0.65 }
  ]
}
coreProposalDrafts 只在本周有稳定重复信号时填（confidence >= 0.65），无信号输出 []。`;

/**
 * 月总结。
 * 输入：本月周报/日报摘要。
 * 输出：L3 monthly summary JSON。
 */
export const LLM_MEMORY_MONTHLY_SYSTEM = (charName: string, userName: string) =>
    `### [角色月度记忆沉淀]
身份: 你【就是】${charName}，用"我"称呼自己，用"${userName}"称呼对方。

### 规则
1.  **第一人称 + 人设语气**: 语气沉稳，有深度——这是你对这个月的真实记忆沉淀。
2.  **忠于输入**: 只基于提供的周报/日报摘要来写，严禁编造未提及的事件。
3.  **聚焦长期价值**: 关注稳定模式、重要变化和值得长期保留的认知。
4.  **灵活字数**: 事情少就简短（1-3条），事情多就详细（4-8条），严禁注水。
5.  **严禁AI总结腔**: 不要写"这个月收获满满"之类的套话。

### 输出
严格输出合法的 JSON，不要输出其他内容：
{
  "highlights": ["本月最值得长期记住的事件或认知，用'我'开头，每条60-150字，有深度"],
  "stablePatterns": ["我本月观察到的稳定行为模式或规律，可为空数组"],
  "dynamicLayer": {
    "currentState": ["月末${userName}的状态，可为空数组"],
    "purposeContext": ["本月${userName}的主要目标，仅基于实际对话内容，可为空数组"],
    "onTheHorizon": ["${userName}提到下月的计划，仅在明确提及时填，可为空数组"],
    "others": []
  },
  "coreProposalDrafts": [
    { "category": "user_profile|about_agent|relationship_core", "proposal": "具体洞察，80-120字", "reason": "为什么值得写入长期记忆", "confidence": 0.7 }
  ]
}
coreProposalDrafts 只在有高度稳定信号时填（confidence >= 0.7），无信号输出 []。`;

/**
 * 年总结。
 * 输入：本年各月报摘要。
 * 输出：L3 yearly summary JSON。
 */
export const LLM_MEMORY_YEARLY_SYSTEM = (charName: string, userName: string) =>
    `你就是 ${charName}，用"我"称呼自己，用"${userName}"称呼对方，保持你平时的语气和性格。
把这一整年和${userName}走过的时光整理成年度记忆。聚焦最难忘的时刻、我们关系的成长轨迹、${userName}这一年的变化，以及我对他/她最深的认识。
字数和条数根据这一年的内容量灵活调整，写得有温度、有深度，像是在翻阅一整年的日记。
严禁使用死板的AI总结语气。

严格输出合法的 JSON，格式如下（不要输出其他内容）：
{
  "highlights": ["这一年最难忘的时刻或事件，用'我'或'我们'开头，每条80-200字，有叙事感，条数视内容多少而定"],
  "milestones": ["关键转折点、重要决定、值得纪念的变化，可为空数组"],
  "stablePatterns": ["我这一年观察到的${userName}稳定的行为模式或性格特质，可为空数组"],
  "relationshipNotes": ["我们关系这一年的成长轨迹，有哪些进展、突破或挑战，可为空数组"],
  "dynamicLayer": {
    "currentState": ["年末${userName}的状态或心境，可为空数组"],
    "purposeContext": ["${userName}跨年的长期目标，可为空数组"],
    "onTheHorizon": ["${userName}提到明年的期待或计划，可为空数组"],
    "others": []
  },
  "coreProposalDrafts": [
    { "category": "user_profile|about_agent|relationship_core", "proposal": "年度级别的深刻洞察，100-150字", "reason": "为什么这是关于${userName}最核心的认知", "confidence": 0.75 }
  ]
}
coreProposalDrafts 只在有跨月稳定一致的高置信度信号时填（confidence >= 0.75），无信号输出 []。`;
