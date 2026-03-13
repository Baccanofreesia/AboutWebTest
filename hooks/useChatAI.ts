import { useState } from 'react';
import { CharacterProfile, UserProfile, Message, StickerUsageRecord } from '../types';
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { ChatParser } from '../utils/chatParser';
import { StickerParser, StickerItem, StickerSet } from '../utils/stickerParser';
import { ContextEnhancer } from '../utils/contextEnhancer';
import { fsBridge } from '../utils/fsBridge';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';
import { voiceStopIntent } from '../utils/voiceIntent';
import { resolveApiEndpoint } from '../utils/apiResolver';
import { AgentSoulData, UserProfileData, buildAgentSoulMarkdown, buildUserMarkdownFromProfile, parseAgentSoulMarkdown, parseUserProfileMarkdown } from '../utils/profileFiles';

interface UseChatAIProps {
    char: CharacterProfile | undefined;
    userProfile: UserProfile;
    apiConfig: any;
    emojis: { name: string, url: string }[];
    activeApp?: string;
    perceptionConfig: any; // PerceptionConfig
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    setMessages: (msgs: Message[]) => void;
    updateAgent: (updates: Partial<CharacterProfile>) => Promise<void>;
    updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
    translationConfig?: { enabled: boolean; sourceLang: string; targetLang: string };
    xhsEnabled?: boolean;
    xhsMcpConfig?: { enabled: boolean; serverUrl: string };
    sessionVoiceActive?: boolean;
    setVoiceEnergy: React.Dispatch<React.SetStateAction<number>>;
}

export const useChatAI = ({
    char,
    userProfile,
    apiConfig,
    emojis,
    activeApp,
    perceptionConfig,
    addToast,
    setMessages,
    updateAgent,
    updateUserProfile,
    translationConfig,
    xhsEnabled,
    xhsMcpConfig,
    sessionVoiceActive,
    setVoiceEnergy
}: UseChatAIProps) => {
    const [isTyping, setIsTyping] = useState(false);
    const [recallStatus, setRecallStatus] = useState('');
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };

    const syncAgentSoulFile = async (updates: Partial<AgentSoulData>) => {
        if (!apiConfig?.nativeWorkspacePath || !char) return;
        const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
        const root = apiConfig.nativeWorkspacePath;
        let base: AgentSoulData = {
            name: char.name || 'Agent',
            nickname: char.nickname,
            avatar: char.avatar,
            persona: char.description
        };
        try {
            const content = await fsBridge.readFile(root, 'Agent_Soul.md', allowGlobal);
            const parsed = parseAgentSoulMarkdown(content);
            if (parsed) base = { ...base, ...parsed };
        } catch { }
        const next: AgentSoulData = { ...base, ...updates, name: (updates.name || base.name || 'Agent') };
        try {
            await fsBridge.writeFile(root, 'Agent_Soul.md', buildAgentSoulMarkdown(next), allowGlobal);
        } catch { }
    };

    const syncUserProfileFile = async (updates: Partial<UserProfileData>) => {
        if (!apiConfig?.nativeWorkspacePath) return;
        const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
        const root = apiConfig.nativeWorkspacePath;
        let base: UserProfileData = {
            name: userProfile.name || 'User',
            nickname: userProfile.nickname,
            avatar: userProfile.avatar,
            bio: userProfile.bio
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

    const getDetailedLogsForMonth = (year: string, month: string) => {
        if (!char?.memories) return null;
        const target = `${year}-${month.padStart(2, '0')}`;
        const logs = char.memories.filter(m => m.date.includes(target) || m.date.includes(`${year}年${parseInt(month)}月`));
        if (logs.length === 0) return null;
        return logs.map(m => `[${m.date}] (${m.mood || 'normal'}): ${m.summary}`).join('\n');
    };

    const getTimeGapHint = (lastMsg: Message | undefined, currentTimestamp: number): string => {
        if (!lastMsg) return '';
        const diffMs = currentTimestamp - lastMsg.timestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const currentHour = new Date(currentTimestamp).getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;
        if (diffMins < 10) return '';
        if (diffMins < 60) return `[系统提示: 距离上一条消息: ${diffMins} 分钟。短暂的停顿。]`;
        if (diffHours < 6) return isNight ? `[系统提示: 距离上一条消息: ${diffHours} 小时。现在深夜/清晨。沉默正常。]` : `[系统提示: 距离上一条消息: ${diffHours} 小时。用户离开。]`;
        if (diffHours < 24) return `[系统提示: 距离上一条消息: ${diffHours} 小时。间隔长。]`;
        const days = Math.floor(diffHours / 24);
        return `[系统提示: 距离上一条消息: ${days} 天。消失很久。]`;
    };
    function extractDeltaText(line: string): string {
        if (!line.startsWith('data: ')) return '';
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return '';
        try {
            const data = JSON.parse(raw);
            // OpenAI 格式: choices[0].delta.content
            if (data.choices?.[0]?.delta?.content) {
                return data.choices[0].delta.content;
            }
            // Anthropic 格式: type=content_block_delta, delta.type=text_delta
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                return data.delta.text || '';
            }
            // Anthropic 格式（部分实现）: delta.text 直接在顶层
            if (data.delta?.text) {
                return data.delta.text;
            }
        } catch (_) { }
        return '';
    }

    const triggerAI = async (currentMsgs: Message[], voiceActiveOverride?: boolean, proactiveVoiceAllowed?: boolean) => {
        if (isTyping || !char || !apiConfig.baseUrl) return;
        setIsTyping(true);
        setRecallStatus('');

        try {
            const resolved = resolveApiEndpoint(apiConfig);
            const baseUrl = resolved.chatUrl.replace(/\/chat\/completions$/, '');
            const headers = resolved.headers;

            const userDisplayName = userProfile.nickname || userProfile.name;
            const agentDisplayName = char.nickname || char.name;
            let baseSystemPrompt = ContextBuilder.buildCoreContext(char, userProfile);
            const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
            const workspaceRootPath = apiConfig?.nativeWorkspacePath || '';
            if (workspaceRootPath) {
                try {
                    const agentsGuide = await fsBridge.readFile(workspaceRootPath, 'AGENTS.md', allowGlobal);
                    if (agentsGuide && agentsGuide.trim()) {
                        baseSystemPrompt = `### Workspace Instructions (AGENTS.md)\n${agentsGuide.trim()}\n\n${baseSystemPrompt}`;
                    }
                } catch { }
            }

            // == 连续语音模式与主动语音指令注入 ==
            const lastUserMsg = currentMsgs.filter(m => m.role === 'user').pop();
            const lastUserText = lastUserMsg?.type === 'voice'
                ? (lastUserMsg.metadata?.transcription || '')
                : (lastUserMsg?.content || '');
            const stopIntentDetected = !!lastUserText && voiceStopIntent.test(String(lastUserText));
            const isVoiceCurrentlyActive = (voiceActiveOverride !== undefined ? voiceActiveOverride : sessionVoiceActive) && !stopIntentDetected;
            if (isVoiceCurrentlyActive && char.chatVoiceEnabled) {
                baseSystemPrompt += `\n### 连续语音对话模式 (Continuous Voice Mode Active)\n   - **要求**: 你的回复**必须全程使用** \`<语音>文本</语音>\` 标签包裹所有自然语言文本内容。每一对标签会生成一个独立的语音气泡。即使有多个气泡，也请确保每个气泡的文本都在标签内。**非自然内容（URL/文件或动作标签/表情包指令）如需发送，请与语音分离输出，不要放在 <语音> 内**。
   - **退出提示**: 除非用户明确要求停止（如“发文字”），否则请坚持全程语音。\n`;
            } else {
                // Defensive: If the last user message was voice but session mode is off, or user explicitly said stop, explicitly tell AI not to use voice tags.
                if (lastUserMsg?.type === 'voice' || stopIntentDetected) {
                    baseSystemPrompt += `\n**注意**: 用户当前倾向于使用文本交流，请【严禁】输出 \`<语音>\` 标签。保持纯文本回复。\n`;
                }

                if (proactiveVoiceAllowed && char.chatVoiceEnabled && !stopIntentDetected) {
                    baseSystemPrompt += `\n### 主动启发语音 (Proactive Voice Initiative)\n1. **特殊权限**: 你现在拥有发出语音的“体力”。\n2. **触发策略**: 你可以**挑选**并尝试在回复中主动包含 \`<语音>文本</语音>\`。推荐在表达剧烈情感（委屈、狂喜、生气）、低声分享秘密或想要对用户撒娇时使用。\n3. **注意**: 这是一个高成本动作，如果当前对话气氛平淡，请继续使用普通文字。\n`;
                }
            }

            let stickerSets: StickerSet[] = [];
            let stickerIndex = '';
            let stickerRelevantNames: string[] = [];
            const stickerUrlNameMap = new Map<string, string>();
            const stickerNameItemMap = new Map<string, StickerItem>();

            if (workspaceRootPath) {
                try {
                    stickerSets = await StickerParser.loadAllStickers(workspaceRootPath);
                    const usageMap = await DB.getStickerUsageMap();
                    stickerIndex = StickerParser.buildStickerIndex(stickerSets, 4, 12);

                    const stickerQueryText = currentMsgs
                        .slice(-6)
                        .map(m => {
                            if (m.type === 'emoji') return String(m.metadata?.stickerName || '').trim();
                            if (typeof m.content === 'string') return m.content;
                            return '';
                        })
                        .join(' ');

                    const relevant = StickerParser.searchRelevantStickersWithCategory(stickerSets, stickerQueryText, 15, undefined, usageMap);
                    stickerRelevantNames = Array.from(new Set(relevant.map(r => r.name))).slice(0, 15);

                    for (const set of stickerSets) {
                        for (const item of set.items) {
                            if (item.url) stickerUrlNameMap.set(item.url, item.name);
                            if (item.name && !stickerNameItemMap.has(item.name)) {
                                stickerNameItemMap.set(item.name, item);
                            }
                        }
                    }
                } catch (e) {
                    stickerSets = [];
                }
            }

            for (const e of emojis) {
                if (!e?.name || !e?.url) continue;
                if (!stickerUrlNameMap.has(e.url)) stickerUrlNameMap.set(e.url, e.name);
                if (!stickerNameItemMap.has(e.name)) {
                    stickerNameItemMap.set(e.name, { name: e.name, url: e.url, category: '自定义' });
                }
            }
            baseSystemPrompt += `### 聊天 App 行为规范 (Chat App Rules)\n            **注意，你正在手机聊天，无论之前是什么模式，当前，你得知道你已经处于线上聊天状态了，请不要输出你的行为**\n1. **沉浸感**: 保持角色扮演与人设一致（以 \`Agent_Soul.md\` 为唯一准则）。使用适合即时通讯(IM)的口语化短句，像真人聊天一样自然。\n2. **行为模式**: 不要总是围绕 User 转。分享你自己的生活、想法或随意的观察，允许适度的主观表达与情绪起伏，但必须与 \`Agent_Soul.md\` 的性格设定一致。\n3. **多消息合并与回复策略 (Multi-Message Strategy - Integration vs. Splitting)**:
   - **智能整合 (Integration)**：当用户连续发送多条**强关联**的消息时（如对同一事物的分次描述），必须进行“脱水”处理。识别核心焦点，**只针对最新或最核心的内容进行回复**。忽略过时的状态信息（如“我准备发了” -> “发了”，只需回复后者）。
   - **智能拆分 (Splitting)**：当多条消息话题**跳跃或非强关联**时（如问了两个不同领域的独立问题），必须分段回复。
   - **分段输出 (Bubble Splitting)**：必须使用**实际的换行符**（回车）来分隔不同的逻辑段落。每一对连续的换行符会将内容拆分为独立的消息气泡。不要直接输出 "\\n" 字符串。
4. **格式禁忌与表情规范 (Formatting & Emojis)**:
   - 【严禁】在输出中包含时间戳、名字前缀或"[角色名]:"。
   - **【严禁】模仿历史记录中的系统日志格式（如"[你 发送了...]"）。**
   - **【严禁】输出模拟思考/耗时标记**（如 \`[1s]\`、\`[2.5s]\`、\`（思考）\`）或任何舞台指示。
   - **原生 Emoji 使用**: 鼓励在回复中自然地嵌入 Unicode Emoji（如 ✨, 💖, 😅, 🪴, ☕）作为语气的点缀或“微表情”。
   - **表情克制与多样性**: 保持表情使用克制（建议每 3-5 条消息中出现 1-2 个表情），严禁堆砌。根据对话的**细腻情感波动**（如尴尬、期待、治愈、忧郁）挑选最契合的表情，严禁机械重复。
   - **表情包使用**: 允许使用表情包，使用 \`[[SEND_EMOJI: 名称]]\` 或 \`[[SEND_EMOJI_FROM: 分类|关键词]]\`，并遵守表情包规则（见下方）。
5. **昵称/实名规则**:
   - 用户实名=${userProfile.name}，聊天昵称=${userDisplayName}
   - 你的实名=${char.name}，聊天昵称=${agentDisplayName}
   - 默认用聊天昵称，除非用户明确要求使用实名。
6. **环境感知**:
   - 留意 [系统提示] 中的时间跨度。如果用户消失了很久，请根据你们的关系做出反应。
   - 如果用户发送了图片或视频，请对媒体内容进行评论。
7. **相册优先原则**:
   - 涉及头像更换/发图时，优先使用相册现有图片；参数可直接给“文件名”，系统会在相册中检索。
   - 仅当你明确需要新增素材且确认有价值时，才使用联网下载入库动作。
   - **相册 vs 工作区**: 相册=图片/视频库（只放媒体），使用 \`[[ACTION:SEND_GALLERY_IMAGE]]\` / \`[[ACTION:GALLERY_SCAN]]\` / \`[[ACTION:SAVE_IMAGE_FROM_URL]]\` 等；工作区=文件系统（文档/代码/压缩包/表格等），使用 \`[[ACTION:SEND_FILE]]\` 或 <fs_*> 操作。不要把相册路径当工作区路径。
8. **可用动作**:
   - 回戳用户: \`[[ACTION:POKE]]\`
   - 转账: \`[[ACTION:TRANSFER:100]]\`
   - 调取记忆: \`[[RECALL: YYYY-MM]]\`
   - **添加纪念日**: \`[[ACTION:ADD_EVENT | 标题(Title) | YYYY-MM-DD]]\`。
   - **定时发送消息**: \`[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]\`
   - **改昵称**: \`[[ACTION:CHANGE_NICKNAME|agent|新昵称]]\` 或 \`[[ACTION:CHANGE_NICKNAME|user|新昵称]]\`
   - **从相册换头像**: \`[[ACTION:CHANGE_AVATAR_FROM_GALLERY|agent|/路径.jpg或文件名]]\` 或 user
   - **设置情侣头像**: \`[[ACTION:CHANGE_COUPLE_AVATAR_FROM_GALLERY|/用户图或文件名|/Agent图或文件名]]\`
   - **查看相册摘要**: \`[[ACTION:GALLERY_SCAN]]\`
   - **发送相册图**: \`[[ACTION:SEND_GALLERY_IMAGE|/路径.jpg或文件名|可选文案]]\`
   - **发送工作区文件**: \`[[ACTION:SEND_FILE|/工作区相对路径|可选文案]]\`
   - **删除相册图**: \`[[ACTION:DELETE_GALLERY_IMAGE|/路径.jpg或文件名]]\`
   - **移动相册图**: \`[[ACTION:MOVE_GALLERY_IMAGE|/路径.jpg或文件名|目标相册名或root]]\`
   - **下载网络图到相册**: \`[[ACTION:SAVE_IMAGE_FROM_URL|URL|文件名.jpg|30字内详情]]\`\n   - **文件系统操作 (ReAct 自驱探测)**:\n     当你需要访问电脑文件或修改内容时，直接在回复中附带以下XML标签，系统会自动拦截并执行，结果将在下一轮消息中返回给你:\n     [写入文件]: <fs_write target="文件路径">内容...</fs_write> (用于读写普通文本文件或配置)
     [开发原生应用]: <create_app name="游戏名">import React from 'react';\n...\nexport default 应用程序名;</create_app> (🔔注意：如果你想为用户开发新的手机App，绝不可使用fs_write！必须使用 <create_app>，系统将全自动编译挂载到桌面，提供零配置跨端支持)
     [动态应用 SDK API]: 🔔当你编写 App (tsx) 时，赋予它真正的灵魂！你可以使用 \`import { useOS } from '../../context/OSContext';\`。通过调用 \`const { askAgent } = useOS();\`，你可以让 App 的UI进行动态推演！比如：\`const res = await askAgent("给用户随机抽一张塔罗牌并解释"); setCardText(res);\`。无需再用 DB.saveMessage 发送假消息，这才是 Native In-App AI！
     [查看目录]: <fs_ls dir="路径" /> (根目录用"/")
     [读取文件]: <fs_read file="文件路径" />
     [删除文件]: <fs_delete file="文件路径" />
     [执行文件]: <fs_execute file="文件路径" /> (支持执行 python/node 脚本，或直接运行 .bat / .exe，结果通过 STDOUT 呈现)
    (注意：由于安全限制，仅当用户开启全局权限后，你才能跳出Workspace访问/执行其他系统文件)\n       -# 【核心警告】：一旦使用了 <create_app> 或 <fs_write>，请务必只输出一次，绝不在正常的聊天回复中重复输出 App 代码！只有当用户明确要求【更新/重写/开发】App 时才能触发。\n`;
            baseSystemPrompt += `\n### 表情包使用准则 (Sticker Rules)\n- 你现在是一个真实的人类角色，发送表情包本质是为了辅助表达情绪，请让它显得自然且克制。\n- **频率控制**: 严禁每轮都用。保持自然的节奏（建议每 3-5 条消息中出现 1 次表情包）。\n- **位置限制**: 表情包必须出现在**整轮回复的中间段落**。它应该作为情绪的过渡点或强调点。\n- **禁止收尾**: 【绝对禁止】在整轮回复的最后一句话后面添加表情包。表情包之后必须跟随至少一句话来完成表达。\n- **结构规范**: 开头回应文字 -> (可选) 1个表情包 -> 结尾补充/收尾文字。\n- 当用户发送表情包时，系统会在历史中标注名称/分类，请结合名称理解情绪与语境并给予回应。\n- 发送指令：\`[[SEND_EMOJI: 表情名称]]\` 或 \`[[SEND_EMOJI_FROM: 分类|关键词]]\`。\n`;

            if (stickerIndex || stickerRelevantNames.length > 0) {
                const relevantLine = stickerRelevantNames.length > 0 ? stickerRelevantNames.join('、') : '（无）';
                baseSystemPrompt += `\n### 表情包系统索引 (Sticker Inventory)\n- 系统已从工作区 \`stickers/\` 目录扫描表情包。\n- 分类摘要（抽样）:\n${stickerIndex || '（未发现可用分类）'}\n- 与当前对话相关的候选（最多15个）：${relevantLine}\n`;
            }

            const bilingualActive = translationConfig?.enabled && translationConfig.sourceLang && translationConfig.targetLang;
            if (bilingualActive) {
                baseSystemPrompt += `\n8. **双语输出规则（必须严格遵守）**:
你的每句话都必须使用以下 XML 标签格式输出双语内容：
<翻译>
<原文>${translationConfig.sourceLang}内容</原文>
<译文>${translationConfig.targetLang}内容</译文>
</翻译>

规则：
- 每句话单独包裹一个 <翻译> 标签
- 多句话就输出多个 <翻译> 标签，一句一个
- <翻译> 标签外不要写任何文字
- 表情包命令 [[SEND_EMOJI: ...]] / [[SEND_EMOJI_FROM: 分类|关键词]] 放在所有 <翻译> 标签外面`;
            }
            if (xhsEnabled) {
                baseSystemPrompt += `\n9. **小红书模式**:
- 可以结合聊天中的小红书卡片内容，给出分析、总结和建议。
- 需要主动操作时，使用以下命令：
  - 搜索：\`[[XHS_SEARCH: 关键词]]\`
  - 浏览/推荐流：\`[[XHS_FEED]]\` 或 \`[[XHS_BROWSE]]\`
  - 查看详情：\`[[XHS_DETAIL: noteId或链接]]\`
  - 评论：\`[[XHS_COMMENT: noteId或链接 | 评论内容]]\`
  - 发帖：\`[[XHS_POST: 标题 | 正文 | 标签1,标签2]]\``;
            }

            if (char.chatVoiceEnabled) {
                baseSystemPrompt += `\n10. **🎤 语音消息功能**:
用户开启了语音消息功能。
**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
用 \`<语音>要说的话</语音>\` 标签来发送语音。标签里的内容会被转成真正的语音条显示给用户。
- \`<语音>\` 里只写会被朗读的自然语言，不要包含括号动作、舞台指示、URL、文件/动作标签、分享链接或表情包指令（如 \`[[SEND_EMOJI]]\`）。
- 每条消息最多一个 \`<语音>\` 标签。
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换。比较适合发语音的场景：撒娇、吐槽、懒得打字、语气重的时候。
- **【重要】语音和文字不要互为复读机！** 如果同时发文字和语音，文字和语音请表达【不同】的内容。你不会打完字又发一条语音把同句话再说一遍的。`;
            } else {
                baseSystemPrompt += `\n10. **🎤 语音消息功能**:
[系统提示: 语音消息功能当前未开启。严禁使用 <语音>...</语音> 标签。所有回复必须是纯文字消息。]`;
            }

            const previousMsg = currentMsgs.length > 1 ? currentMsgs[currentMsgs.length - 2] : null;
            if (previousMsg && previousMsg.metadata?.source === 'date') {
                baseSystemPrompt += `\n\n[System Note: You just finished a face-to-face meeting. You are now back on the phone. Switch back to texting style.]`;
            }

            const relationEvents = await DB.getRelationEvents(8).catch(() => []);
            if (relationEvents.length > 0) {
                const relationBlock = relationEvents
                    .map(e => `- [${formatDate(e.timestamp)}] ${e.summary}`)
                    .join('\n');
                baseSystemPrompt += `\n### 关系事件日志 (Recent Relation Events)\n${relationBlock}\n`;
            }

            const limit = char.contextLimit || 500;
            const historySlice = currentMsgs.slice(-limit);

            let timeGapHint = "";
            if (historySlice.length >= 2) {
                const lastMsg = currentMsgs[currentMsgs.length - 2];
                const currentMsg = currentMsgs[currentMsgs.length - 1];
                if (lastMsg && currentMsg) timeGapHint = getTimeGapHint(lastMsg, currentMsg.timestamp);
            }



            const buildHistory = (msgs: Message[], forceTextOnly: boolean = false) => msgs.map((m, index) => {
                let content: any = m.content;
                const timeStr = `[${formatDate(m.timestamp)}]`;

                if (m.type === 'image') {
                    const fileName = (m.metadata?.fileName || '').toString().trim();
                    const galleryPath = (m.metadata?.galleryPath || '').toString().trim();
                    const imageDetail = (m.metadata?.imageDetail || '').toString().trim();
                    let textPart = `${timeStr} [User sent an image${fileName ? ` | file=${fileName}` : ''}${galleryPath ? ` | path=${galleryPath}` : ''}${imageDetail ? ` | detail=${imageDetail}` : ''}]`;
                    if (index === msgs.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                    if (forceTextOnly) return { role: m.role, content: textPart };
                    return { role: m.role, content: [{ type: "text", text: textPart }, { type: "image_url", image_url: { url: m.content } }] };
                }
                if (m.type === 'video') {
                    const fileName = (m.metadata?.fileName || '').toString().trim();
                    const galleryPath = (m.metadata?.galleryPath || '').toString().trim();
                    const videoDetail = (m.metadata?.videoDetail || m.metadata?.imageDetail || '').toString().trim();
                    const maxAllowedFrames = apiConfig?.videoUnderstanding?.maxFrames || 12;
                    const frames = Array.isArray(m.metadata?.videoFrames) ? m.metadata.videoFrames.filter((x: any) => typeof x === 'string' && !!x).slice(0, maxAllowedFrames) : [];
                    const frame = (m.metadata?.videoFrame || '').toString().trim();
                    let textPart = `${timeStr} [${m.role === 'user' ? 'User' : 'Assistant'} sent a video${fileName ? ` | file=${fileName}` : ''}${galleryPath ? ` | path=${galleryPath}` : ''}${videoDetail ? ` | detail=${videoDetail}` : ''}]`;
                    if (index === msgs.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                    if (forceTextOnly) return { role: m.role, content: textPart };
                    if (frames.length > 0) return { role: m.role, content: [{ type: "text", text: textPart }, ...frames.map((f: string) => ({ type: "image_url", image_url: { url: f } }))] };
                    if (frame) return { role: m.role, content: [{ type: "text", text: textPart }, { type: "image_url", image_url: { url: frame } }] };
                    return { role: m.role, content: textPart };
                }
                if (m.type === 'voice') {
                    const duration = Number(m.metadata?.duration || 0);
                    const transcription = (m.metadata?.transcription || '').toString().trim();
                    const sender = m.role === 'user' ? '用户' : '你';
                    let textPart = transcription
                        ? `${timeStr} [${sender}发送了语音消息 ${duration}秒]: ${transcription}`
                        : `${timeStr} [${sender}发送了语音消息 ${duration}秒, 无法转写]`;
                    if (index === msgs.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                    return { role: m.role, content: textPart };
                }
                if (m.type === 'file') {
                    const fileName = (m.metadata?.fileName || '').toString().trim();
                    const fileType = (m.metadata?.mimeType || m.metadata?.fileType || '').toString().trim();
                    const filePath = (m.metadata?.workspacePath || '').toString().trim();
                    const fileSize = Number(m.metadata?.size || 0);
                    const preview = (m.metadata?.previewText || '').toString().trim();
                    const previewPart = preview ? `\n[文件内容预览]\n${preview.slice(0, 1200)}` : '';
                    const sender = m.role === 'user' ? 'User' : 'Assistant';
                    let textPart = `${timeStr} [${sender} sent a file${fileName ? ` | name=${fileName}` : ''}${fileType ? ` | type=${fileType}` : ''}${filePath ? ` | path=${filePath}` : ''}${fileSize > 0 ? ` | size=${fileSize}` : ''}]${previewPart}`;
                    if (index === msgs.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                    return { role: m.role, content: textPart };
                }
                if (typeof content === 'string' && content.toLowerCase().includes('%%bilingual%%')) {
                    content = content.substring(0, content.toLowerCase().indexOf('%%bilingual%%')).trim();
                }
                if (typeof content === 'string' && content.includes('<翻译>')) {
                    content = content.replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1').trim();
                }
                if (index === msgs.length - 1 && timeGapHint && m.role === 'user') content = `${content}\n\n${timeGapHint}`;

                if (m.type === 'interaction') content = `${timeStr} [系统: 用户戳了你一下]`;
                else if (m.type === 'transfer') content = `${timeStr} [系统: 用户转账 ${m.metadata?.amount}]`;
                else if (m.type === 'emoji') {
                    const metaName = (m.metadata?.stickerName || '').toString().trim();
                    const mapName = stickerUrlNameMap.get(m.content) || '';
                    const emojiName = emojis.find(e => e.url === m.content)?.name || '';
                    const stickerName = metaName || mapName || emojiName || 'Image/Sticker';
                    const category = stickerNameItemMap.get(stickerName)?.category || '';
                    const catPart = category ? ` | category=${category}` : '';
                    content = `${timeStr} [${m.role === 'user' ? '用户' : '你'} 发送了表情包: ${stickerName}${catPart}]`;
                } else content = `${timeStr} ${content}`;
                return { role: m.role, content };
            });

            // == 感知层注入 (Perception Layer Injection V2) ==
            const lastMsg = currentMsgs.length > 0 ? currentMsgs[currentMsgs.length - 1] : null;
            const lastContent = lastMsg && typeof lastMsg.content === 'string' ? lastMsg.content : '';

            const perceptionBlock = await ContextEnhancer.buildSnapshot(activeApp, perceptionConfig, lastContent);
            baseSystemPrompt += perceptionBlock;

            let apiMessages = [{ role: 'system', content: baseSystemPrompt }, ...buildHistory(historySlice)];
            if (bilingualActive) {
                apiMessages.push({ role: 'system', content: `[Reminder: 每句话必须用 <翻译><原文>...</原文><译文>...</译文></翻译> 标签包裹，一句一个标签，绝对不能省略。]` } as any);
            }

            // == 1. Fetch LLM API with SSE (Real-time Fake Stream logic) ==
            let requestBody: any = { model: apiConfig.model, messages: apiMessages, temperature: 0.85, stream: true };
            if (resolved.transformBody) requestBody = resolved.transformBody(requestBody);
            let response = await fetch(resolved.chatUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);
            if (!response.body) throw new Error("ReadableStream not supported in fetch response.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let aiContent = '';

            try {
                // Loop: Read stream chunks => fast TTFT, UI continues to show "isTyping"
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    for (const line of chunk.split('\n')) {
                        if (line.trim() === 'data: [DONE]') break;
                        const delta = extractDeltaText(line);
                        if (delta) aiContent += delta;
                    }
                }
                //     const { done, value } = await reader.read();
                //     if (done) break;
                //     const chunk = decoder.decode(value, { stream: true });
                //     const lines = chunk.split('\n');
                //     for (const line of lines) {
                //         if (line.trim() === 'data: [DONE]') break;
                //         if (line.startsWith('data: ')) {
                //             try {
                //                 const data = JSON.parse(line.slice(6));
                //                 if (data.choices?.[0]?.delta?.content) {
                //                     aiContent += data.choices[0].delta.content;
                //                 }
                //             } catch (e) { }
                //         }
                //     }
                // }
            } finally {
                reader.releaseLock();
            }

            // Clean artifacts
            aiContent = aiContent.replace(/\[\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}.*?\]/g, '');
            aiContent = aiContent.replace(/^[\w\u4e00-\u9fa5]+:\s*/, '');
            aiContent = aiContent.replace(/\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*(.*?)\]/g, '[[SEND_EMOJI: $1]]');

            // == 2. RECALL Logic ==
            const recallMatch = aiContent.match(/\[\[RECALL:\s*(\d{4})[-/年](\d{1,2})\]\]/);
            if (recallMatch) {
                const year = recallMatch[1];
                const month = recallMatch[2];
                setRecallStatus(`正在调阅 ${year}年${month}月 的档案...`);
                const detailedLogs = getDetailedLogsForMonth(year, month);
                if (detailedLogs) {
                    const injectionMessage = {
                        role: 'system',
                        content: `[系统: 已成功调取 ${year}-${month} 的日志]\n${detailedLogs}\n[系统: 现在结合这些细节回答。]`
                    };
                    apiMessages = [...apiMessages, { role: 'assistant', content: aiContent }, injectionMessage];
                    let recallBody: any = { model: apiConfig.model, messages: apiMessages, temperature: 0.8, stream: true };
                    if (resolved.transformBody) recallBody = resolved.transformBody(recallBody);
                    let recallRes = await fetch(resolved.chatUrl, {
                        method: 'POST', headers,
                        body: JSON.stringify(recallBody)
                    });

                    if (recallRes.ok && recallRes.body) {
                        const rReader = recallRes.body.getReader();
                        let recallContent = '';
                        while (true) {
                            const { done, value } = await rReader.read();
                            if (done) break;
                            const chunk = decoder.decode(value, { stream: true });
                            for (const line of chunk.split('\n')) {
                                if (line.trim() === 'data: [DONE]') break;
                                const delta = extractDeltaText(line);
                                if (delta) recallContent += delta;
                            }
                        }
                        rReader.releaseLock();
                        // const rReader = recallRes.body.getReader();
                        // let recallContent = '';
                        // while (true) {
                        //     const { done, value } = await rReader.read();
                        //     if (done) break;
                        //     const chunk = decoder.decode(value, { stream: true });
                        //     for (const line of chunk.split('\n')) {
                        //         if (line.trim() === 'data: [DONE]') break;
                        //         if (line.startsWith('data: ')) {
                        //             try {
                        //                 const data = JSON.parse(line.slice(6));
                        //                 if (data.choices?.[0]?.delta?.content) recallContent += data.choices[0].delta.content;
                        //             } catch (e) { }
                        //         }
                        //     }
                        // }
                        // rReader.releaseLock();
                        if (recallContent) {
                            aiContent = recallContent.replace(/\[\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}.*?\]/g, '').replace(/^[\w\u4e00-\u9fa5]+:\s*/, '').replace(/\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*(.*?)\]/g, '[[SEND_EMOJI: $1]]');
                        }
                        addToast(`已调用 ${year}-${month} 记忆`, 'info');
                    }
                }
            }

            const relationActions: { type: any; summary: string }[] = [];

            const nicknameRegex = /\[\[ACTION:CHANGE_NICKNAME\s*[|｜]\s*([\s\S]*?)\s*[|｜]\s*([\s\S]*?)\]\]/gi;
            let nicknameMatch;
            while ((nicknameMatch = nicknameRegex.exec(aiContent)) !== null) {
                const rawTarget = nicknameMatch[1].trim().toLowerCase();
                const target = ['agent', 'assistant', 'nova', 'ai'].includes(rawTarget) ? 'agent' : 'user';
                const nextNick = nicknameMatch[2].replace(/[`"'“”‘’]/g, '').trim().slice(0, 20);
                if (!nextNick) continue;
                if (target === 'agent') {
                    await updateAgent({ nickname: nextNick });
                    await syncAgentSoulFile({ nickname: nextNick });
                    relationActions.push({ type: 'agent_nickname_changed', summary: `Agent 聊天昵称更新为「${nextNick}」` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: ${char.name} 的聊天昵称更新为「${nextNick}」]` });
                } else if (target === 'user') {
                    await updateUserProfile({ nickname: nextNick });
                    await syncUserProfileFile({ nickname: nextNick });
                    relationActions.push({ type: 'user_nickname_changed', summary: `用户聊天昵称更新为「${nextNick}」` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 你的聊天昵称更新为「${nextNick}」]` });
                }
            }
            aiContent = aiContent.replace(nicknameRegex, '').trim();

            let galleryEntriesCache: { name: string; path: string }[] | null = null;
            const listGalleryEntries = async (): Promise<{ name: string; path: string }[]> => {
                if (!apiConfig?.galleryWorkspacePath) throw new Error('未配置相册路径');
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                if (galleryEntriesCache) return galleryEntriesCache;
                const rootItems = await fsBridge.readDir(apiConfig.galleryWorkspacePath, '/', allowGlobal);
                const rootFiles = rootItems
                    .filter(i => i.type === 'file' && /\.(jpe?g|png|webp|gif|bmp)$/i.test(i.name))
                    .map(i => ({ name: i.name, path: `/${i.name}` }));
                const folders = rootItems.filter(i => i.type === 'folder');
                const nested = await Promise.all(folders.map(async f => {
                    const dirPath = `/${f.name}/`;
                    const items = await fsBridge.readDir(apiConfig.galleryWorkspacePath, dirPath, allowGlobal);
                    return items
                        .filter(i => i.type === 'file' && /\.(jpe?g|png|webp|gif|bmp)$/i.test(i.name))
                        .map(i => ({ name: i.name, path: `${dirPath}${i.name}` }));
                }));
                galleryEntriesCache = [...rootFiles, ...nested.flat()];
                return galleryEntriesCache;
            };

            const resolveGalleryPath = async (input: string): Promise<string> => {
                const token = String(input || '')
                    .replace(/[`"'“”‘’]/g, '')
                    .replace(/[，。！？；：,!?;:\)\]\}]+$/g, '')
                    .trim();
                if (!token) throw new Error('图片参数为空');
                const normalized = token.replace(/\\/g, '/');
                const entries = await listGalleryEntries();
                if (normalized.startsWith('/')) {
                    const direct = entries.find(e => e.path.toLowerCase() === normalized.toLowerCase());
                    if (direct) return direct.path;
                }
                const fileName = normalized.split('/').pop() || normalized;
                const found = entries.find(e => e.name.trim().toLowerCase() === fileName.trim().toLowerCase());
                if (found) return found.path;
                const fuzzy = entries.find(e => e.name.trim().toLowerCase().includes(fileName.trim().toLowerCase()));
                if (fuzzy) return fuzzy.path;
                throw new Error(`相册中未找到图片: ${token}`);
            };

            const loadGalleryDataUrl = async (galleryPath: string): Promise<string> => {
                if (!apiConfig?.galleryWorkspacePath) throw new Error('未配置相册路径');
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                const relPath = galleryPath.replace(/^\/+/, '');
                const base64 = await fsBridge.readFileBase64(apiConfig.galleryWorkspacePath, relPath, allowGlobal);
                const ext = galleryPath.toLowerCase().split('.').pop() || 'jpg';
                const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                return `data:${mime};base64,${base64}`;
            };

            const resolveGalleryData = async (token: string): Promise<{ resolvedPath: string; dataUrl: string }> => {
                const resolvedPath = await resolveGalleryPath(token);
                const dataUrl = await loadGalleryDataUrl(resolvedPath);
                return { resolvedPath, dataUrl };
            };

            const avatarRegex = /\[\[ACTION:CHANGE_AVATAR_FROM_GALLERY\|(\s*agent|\s*user)\|([\s\S]*?)\]\]/gi;
            let avatarMatch;
            while ((avatarMatch = avatarRegex.exec(aiContent)) !== null) {
                const target = avatarMatch[1].trim().toLowerCase();
                const galleryPath = avatarMatch[2].trim();
                if (!galleryPath) continue;
                try {
                    const { resolvedPath, dataUrl } = await resolveGalleryData(galleryPath);
                    if (target === 'agent') {
                        await updateAgent({ avatar: resolvedPath, displayAvatar: dataUrl });
                        await syncAgentSoulFile({ avatar: resolvedPath });
                        relationActions.push({ type: 'agent_avatar_changed', summary: `Agent 从相册更换头像: ${resolvedPath}` });
                    } else if (target === 'user') {
                        await updateUserProfile({ avatar: resolvedPath, displayAvatar: dataUrl });
                        await syncUserProfileFile({ avatar: resolvedPath });
                        relationActions.push({ type: 'user_avatar_changed', summary: `用户从相册更换头像: ${resolvedPath}` });
                    }
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已从相册完成头像更新]` });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 头像更换失败 ${galleryPath}: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(avatarRegex, '').trim();

            const coupleRegex = /\[\[ACTION:CHANGE_COUPLE_AVATAR_FROM_GALLERY\|([\s\S]*?)\|([\s\S]*?)\]\]/gi;
            let coupleMatch;
            while ((coupleMatch = coupleRegex.exec(aiContent)) !== null) {
                const userPath = coupleMatch[1].trim();
                const agentPath = coupleMatch[2].trim();
                if (!userPath || !agentPath) continue;
                try {
                    const [userResolved, agentResolved] = await Promise.all([
                        resolveGalleryData(userPath),
                        resolveGalleryData(agentPath)
                    ]);
                    await updateUserProfile({ avatar: userResolved.resolvedPath, displayAvatar: userResolved.dataUrl });
                    await updateAgent({ avatar: agentResolved.resolvedPath, displayAvatar: agentResolved.dataUrl });
                    await syncUserProfileFile({ avatar: userResolved.resolvedPath });
                    await syncAgentSoulFile({ avatar: agentResolved.resolvedPath });
                    relationActions.push({ type: 'couple_avatar_set', summary: `设置情侣头像 user=${userResolved.resolvedPath}, agent=${agentResolved.resolvedPath}` });
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已设置情侣头像]` });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 情侣头像设置失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(coupleRegex, '').trim();

            for (const event of relationActions) {
                await DB.saveRelationEvent({ type: event.type, actor: 'agent', summary: event.summary });
            }

            const xhsAvailable = !!(xhsEnabled && xhsMcpConfig?.enabled && xhsMcpConfig?.serverUrl);
            const xhsServerUrl = xhsMcpConfig?.serverUrl || '';

            const xhsSearchRegex = /\[\[XHS_SEARCH:\s*([\s\S]*?)\]\]/gi;
            let xhsSearchMatch;
            while ((xhsSearchMatch = xhsSearchRegex.exec(aiContent)) !== null) {
                const keyword = xhsSearchMatch[1].trim();
                if (!keyword) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法搜索「${keyword}」]` });
                    continue;
                }
                try {
                    const result = await XhsMcpClient.search(xhsServerUrl, keyword);
                    const notes = extractNotesFromMcpData(result.data).map(normalizeNote).filter(n => n.noteId).slice(0, 3);
                    if (notes.length === 0) {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书搜索「${keyword}」暂无结果]` });
                    } else {
                        for (const note of notes) {
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书笔记', metadata: { xhsNote: note } });
                        }
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 已返回 ${notes.length} 条小红书搜索结果]` });
                    }
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书搜索失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsSearchRegex, '').trim();

            const xhsFeedRegex = /\[\[XHS_(?:FEED|BROWSE)(?::[^\]]*)?\]\]/gi;
            if (xhsFeedRegex.test(aiContent)) {
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法获取推荐流]` });
                } else {
                    try {
                        const result = await XhsMcpClient.getRecommend(xhsServerUrl);
                        const notes = extractNotesFromMcpData(result.data).map(normalizeNote).filter(n => n.noteId).slice(0, 3);
                        if (notes.length === 0) {
                            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书推荐流暂无可展示内容]` });
                        } else {
                            for (const note of notes) {
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书推荐', metadata: { xhsNote: note } });
                            }
                        }
                    } catch (e: any) {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 获取小红书推荐失败: ${e?.message || '未知错误'}]` });
                    }
                }
                aiContent = aiContent.replace(xhsFeedRegex, '').trim();
            }

            const xhsDetailRegex = /\[\[XHS_DETAIL:\s*([\s\S]*?)\]\]/gi;
            let xhsDetailMatch;
            while ((xhsDetailMatch = xhsDetailRegex.exec(aiContent)) !== null) {
                const token = xhsDetailMatch[1].trim();
                if (!token) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法查看详情]` });
                    continue;
                }
                try {
                    const noteUrl = /^https?:\/\//i.test(token) ? token : `https://www.xiaohongshu.com/explore/${token}`;
                    const result = await XhsMcpClient.getNoteDetail(xhsServerUrl, noteUrl);
                    if (result.success && result.data) {
                        const note = normalizeNote(result.data);
                        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'xhs_card', content: note.title || '小红书详情', metadata: { xhsNote: note } });
                    } else {
                        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书详情获取失败]` });
                    }
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书详情失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsDetailRegex, '').trim();

            const xhsCommentRegex = /\[\[XHS_COMMENT:\s*([\s\S]*?)\|([\s\S]*?)\]\]/gi;
            let xhsCommentMatch;
            while ((xhsCommentMatch = xhsCommentRegex.exec(aiContent)) !== null) {
                const noteToken = xhsCommentMatch[1].trim();
                const content = xhsCommentMatch[2].trim();
                if (!noteToken || !content) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法评论]` });
                    continue;
                }
                try {
                    const noteUrl = /^https?:\/\//i.test(noteToken) ? noteToken : `https://www.xiaohongshu.com/explore/${noteToken}`;
                    const result = await XhsMcpClient.comment(xhsServerUrl, noteUrl, content);
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: result.success ? `[系统: 小红书评论已发送]` : `[系统: 小红书评论失败: ${result.error || '未知错误'}]`
                    });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书评论失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsCommentRegex, '').trim();

            const xhsPostRegex = /\[\[XHS_POST:\s*([\s\S]*?)\|([\s\S]*?)\|?([\s\S]*?)\]\]/gi;
            let xhsPostMatch;
            while ((xhsPostMatch = xhsPostRegex.exec(aiContent)) !== null) {
                const title = xhsPostMatch[1].trim();
                const content = xhsPostMatch[2].trim();
                const tagsRaw = (xhsPostMatch[3] || '').trim();
                const tags = tagsRaw ? tagsRaw.split(/[，,]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean) : [];
                if (!title || !content) continue;
                if (!xhsAvailable) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书 MCP 未启用，无法发帖]` });
                    continue;
                }
                try {
                    const result = await XhsMcpClient.publishNote(xhsServerUrl, { title, content, tags });
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: result.success ? `[系统: 小红书笔记发布成功]` : `[系统: 小红书发帖失败: ${result.error || '未知错误'}]`
                    });
                } catch (e: any) {
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: 小红书发帖失败: ${e?.message || '未知错误'}]` });
                }
            }
            aiContent = aiContent.replace(xhsPostRegex, '').trim();

            const parseResult = await ChatParser.parseAndExecuteActions(aiContent, char, addToast, apiConfig);

            // == Phase 2.4: Voice Energy Deduction ==
            const originalWasVoice = /<[语語]音>([\s\S]*?)<\/[语語]音>/i.test(aiContent);
            if (originalWasVoice && !isVoiceCurrentlyActive && proactiveVoiceAllowed) {
                setVoiceEnergy(prev => Math.max(0, prev - 60));
            }

            aiContent = ChatParser.sanitize(parseResult.content);
            const hasToolResult = parseResult.hasToolResult;

            const resolveStickerByName = (name: string): StickerItem | null => {
                const trimmed = String(name || '').trim();
                if (!trimmed) return null;
                const mapped = stickerNameItemMap.get(trimmed);
                if (mapped) return mapped;
                const found = emojis.find(e => e.name === trimmed);
                if (found?.url) return { name: found.name, url: found.url, category: '自定义' };
                return null;
            };

            const emojiFromRegex = /\[\[SEND_EMOJI_FROM:\s*([^|\]]+)\|([^\]]+)\]\]/gi;
            if (emojiFromRegex.test(aiContent)) {
                aiContent = aiContent.replace(emojiFromRegex, (_, rawCategory, rawKeyword) => {
                    const preferCategory = String(rawCategory || '').trim();
                    const keyword = String(rawKeyword || '').trim();
                    if (!keyword) return '';
                    const found = StickerParser.searchRelevantStickersWithCategory(
                        stickerSets,
                        keyword,
                        1,
                        preferCategory || undefined
                    )[0];
                    if (found?.name) {
                        if (!stickerNameItemMap.has(found.name)) stickerNameItemMap.set(found.name, found);
                        return `[[SEND_EMOJI: ${found.name}]]`;
                    }
                    return '';
                }).trim();
            }

            // Fix: If a tool result was generated (like a voice message saved to DB), 
            // but there's no text content to stream, we must update UI here.
            if (hasToolResult && !aiContent) {
                setMessages(await DB.getMessagesByCharId(char.id));
            }

            ContextEnhancer.trackMentionFromResponse(aiContent);

            if (aiContent) {
                let msgsToUpdate = [];
                const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

                if (hasTranslationTags) {
                    const bilingualEmojis: string[] = [];
                    let bEm;
                    const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                    while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                        const name = bEm[1].trim();
                        if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
                    }
                    aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();

                    const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
                    let lastIndex = 0;
                    let tagMatch;
                    while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                        const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                        if (textBefore && ChatParser.hasDisplayContent(textBefore)) {
                            const chunks = ChatParser.chunkText(ChatParser.sanitize(textBefore));
                            for (const chunk of chunks) {
                                if (!chunk) continue;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk });
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        }

                        const originalText = ChatParser.sanitize(tagMatch[1].trim());
                        const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                        if (originalText || translatedText) {
                            const biContent = originalText && translatedText ? `${originalText}\n%%BILINGUAL%%\n${translatedText}` : (originalText || translatedText);
                            await new Promise(r => setTimeout(r, Math.min(Math.max(biContent.length * 30, 400), 2000)));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: biContent });
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        }

                        lastIndex = tagMatch.index + tagMatch[0].length;
                    }

                    const textAfter = aiContent.slice(lastIndex).trim();
                    if (textAfter) {
                        const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                        if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                            const chunks = ChatParser.chunkText(cleaned);
                            for (const chunk of chunks) {
                                if (!chunk) continue;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk });
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        }
                    }

                    for (const emojiName of bilingualEmojis) {
                        const foundEmoji = resolveStickerByName(emojiName);
                        if (foundEmoji?.url) {
                            await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                            await DB.saveMessage({
                                charId: char.id,
                                role: 'assistant',
                                type: 'emoji',
                                content: foundEmoji.url,
                                metadata: {
                                    stickerName: foundEmoji.name,
                                    stickerCategory: foundEmoji.category
                                } as any
                            });
                            await DB.saveRelationEvent({
                                type: 'agent_sticker_send',
                                actor: 'agent',
                                summary: `Agent 发送了表情包: ${foundEmoji.name}`,
                                payload: {
                                    stickerName: foundEmoji.name,
                                    stickerUrl: foundEmoji.url,
                                    category: foundEmoji.category
                                }
                            });
                            await DB.recordStickerUsage(foundEmoji.name);
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        }
                    }
                } else {
                    const parts = ChatParser.splitResponse(aiContent);
                    for (const part of parts) {
                        if (part.type === 'emoji') {
                            const foundEmoji = resolveStickerByName(part.content);
                            if (foundEmoji?.url) {
                                await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                                await DB.saveMessage({
                                    charId: char.id,
                                    role: 'assistant',
                                    type: 'emoji',
                                    content: foundEmoji.url,
                                    metadata: {
                                        stickerName: foundEmoji.name,
                                        stickerCategory: foundEmoji.category
                                    } as any
                                });
                                await DB.saveRelationEvent({
                                    type: 'agent_sticker_send',
                                    actor: 'agent',
                                    summary: `Agent 发送了表情包: ${foundEmoji.name}`,
                                    payload: {
                                        stickerName: foundEmoji.name,
                                        stickerUrl: foundEmoji.url,
                                        category: foundEmoji.category
                                    }
                                });
                                await DB.recordStickerUsage(foundEmoji.name);
                                msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                setMessages(msgsToUpdate);
                            }
                        } else if (part.type === 'silent') {
                            // Non-natural language (URLs, tags) - Save as text but skip TTS
                            await new Promise(r => setTimeout(r, 600));
                            await DB.saveMessage({
                                charId: char.id,
                                role: 'assistant',
                                type: 'text',
                                content: part.content
                            });
                            msgsToUpdate = await DB.getMessagesByCharId(char.id);
                            setMessages(msgsToUpdate);
                        } else {
                            const rawBlocks = part.content.split(/^\s*---\s*$/m).filter(b => b.trim());
                            const allChunks: string[] = [];
                            for (const block of rawBlocks) {
                                allChunks.push(...ChatParser.chunkText(block.trim()));
                            }
                            if (allChunks.length === 0 && part.content.trim()) allChunks.push(part.content.trim());

                            for (const chunk of allChunks) {
                                let delay = 0;
                                if (char.replySplitInterval && char.replySplitInterval > 50) {
                                    delay = char.replySplitInterval;
                                } else {
                                    delay = Math.min(Math.max(chunk.length * 45, 800), 4000);
                                }
                                await new Promise(r => setTimeout(r, delay));

                                // == Phase 2.6: Agent Citation/Reply Parsing ==
                                let finalChunk = chunk;

                                if (ChatParser.hasDisplayContent(finalChunk)) {
                                    const cleanChunk = ChatParser.sanitize(finalChunk);
                                    if (cleanChunk) {
                                        const isVoiceActive = voiceActiveOverride !== undefined ? voiceActiveOverride : sessionVoiceActive;
                                        let savedAsVoice = false;
                                        if (isVoiceActive && char.chatVoiceEnabled) {
                                            savedAsVoice = await ChatParser.synthesizeAndSaveVoice(cleanChunk, char, apiConfig);
                                        }

                                        if (!savedAsVoice) {
                                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: cleanChunk });
                                        }

                                        msgsToUpdate = await DB.getMessagesByCharId(char.id);
                                        setMessages(msgsToUpdate);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Multi-Prompt concurrency handling (Serial Queue simulation)
            const latestMsgs = await DB.getMessagesByCharId(char.id);
            const latestUserMsgs = latestMsgs.filter(m => m.role === 'user');
            const currentUserMsgs = currentMsgs.filter(m => m.role === 'user');

            if (hasToolResult || latestUserMsgs.length > currentUserMsgs.length) {
                setTimeout(() => triggerAI(latestMsgs), 500);
            }

        } catch (e: any) {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[连接中断: ${e.message}]` });
            setMessages(await DB.getMessagesByCharId(char.id));
        } finally {
            setIsTyping(false);
            setRecallStatus('');
        }
    };

    return {
        isTyping,
        recallStatus,
        lastTokenUsage,
        setLastTokenUsage,
        triggerAI
    };
};
