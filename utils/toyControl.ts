// 小玩具控制工具函数

import { AgentProfile } from '../types';
import { AgentToyPersonality, ToyScene, ToyControlSettings } from '../types/intiface';

// 从 Agent 人设中提取玩具控制性格
export function extractToyPersonality(char: AgentProfile): AgentToyPersonality {
  const desc = (char.description || '').toLowerCase();
  const systemPrompt = (char.systemPrompt || '').toLowerCase();
  const combined = desc + ' ' + systemPrompt;

  // 关键词检测辅助函数
  const has = (words: string[]) => words.some(w => combined.includes(w));

  // 侵略性检测
  const aggressiveWords = ['强势', '霸道', '控制', '支配', 'dominant', 'aggressive', 'strict', '严厉', '惩罚', 'punish'];
  const aggressiveness = has(aggressiveWords) ? 0.7 + Math.random() * 0.3 : 0.3 + Math.random() * 0.4;

  // 温柔度检测
  const gentleWords = ['温柔', '体贴', 'gentle', 'caring', 'soft', 'sweet', 'kind', '善良'];
  const gentleness = has(gentleWords) ? 0.7 + Math.random() * 0.3 : 0.3 + Math.random() * 0.4;

  // 控制欲检测
  const dominanceWords = ['控制', '支配', '命令', '掌控', 'control', 'dominance', 'power'];
  const dominance = has(dominanceWords) ? 0.7 + Math.random() * 0.3 : 0.3 + Math.random() * 0.4;

  // 创意指数
  const creativeWords = ['创意', '想象力', 'creative', 'imaginative', 'playful', 'fun'];
  const creativity = has(creativeWords) ? 0.7 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4;

  // 耐心
  const patienceWords = ['耐心', 'patient', 'calm', 'slow', 'gentle'];
  const patience = has(patienceWords) ? 0.7 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4;

  // 惩罚/奖励倾向
  const punishmentWords = ['惩罚', '惩罚', 'punish', 'discipline', 'strict'];
  const rewardWords = ['奖励', '奖赏', 'reward', 'praise', 'good'];
  const punishmentTendency = has(punishmentWords) ? 0.6 + Math.random() * 0.4 : Math.random() * 0.4;
  const rewardTendency = has(rewardWords) ? 0.6 + Math.random() * 0.4 : Math.random() * 0.4;

  // 主动倾向综合计算
  const proactivity = (dominance + aggressiveness + creativity) / 3;

  return {
    proactivity,
    aggressiveness,
    gentleness,
    dominance,
    creativity,
    patience,
    punishmentTendency,
    rewardTendency
  };
}

// 计算当前应该采用的场景
export function calculateScene(
  personality: AgentToyPersonality,
  currentMood: number, // -1 to 1, negative = bad mood
  userObedience: number, // 0 to 1, how obedient user has been
  intensity: number // current intensity 0-1000
): ToyScene {
  // 随机因素
  const randomFactor = Math.random();

  // 基于性格的加权
  if (personality.punishmentTendency > 0.6 && userObedience < 0.4 && randomFactor > 0.3) {
    return 'punish';
  }

  if (personality.rewardTendency > 0.6 && userObedience > 0.7 && randomFactor > 0.3) {
    return 'reward';
  }

  if (personality.dominance > 0.7 && personality.aggressiveness > 0.6) {
    return 'training';
  }

  if (personality.gentleness > 0.7 && personality.patience > 0.6) {
    return 'tease';
  }

  // 默认基于强度
  if (intensity < 300) return 'tease';
  if (intensity > 700) return 'training';
  return 'tease';
}

// 生成场景提示词
export function generateScenePrompt(scene: ToyScene, personality: AgentToyPersonality): string {
  const basePrompts: Record<ToyScene, string> = {
    none: '',
    tease: `【调情挑逗模式】
- 你是温柔且充满诱惑的伴侣
- 动作轻柔、缓慢，充满暗示性
- 语言暧昧但不过分直白
- 关注对方的每一个细微反应`,
    punish: `【惩罚训导模式】
- 你是严厉的主导者，对方需要被管教
- 动作带有惩戒性质，强度中等偏高
- 语言严厉但不过度侮辱
- 强调规则和服从`,
    reward: `【奖赏宠爱模式】
- 你是慷慨的给予者，对方表现优秀
- 动作温柔体贴，让对方感到被珍视
- 语言充满赞美和肯定
- 创造愉悦和安全的氛围`,
    training: `【训练调教模式】
- 你是严格的训练师，对方需要被塑造
- 动作有目的性，逐步提升强度
- 语言带有指令性，要求执行和反馈
- 强调进步和突破`,
    custom: `【自定义场景】
- 根据具体设定灵活调整行为模式
- 保持与角色人设的一致性
- 关注互动质量和双方体验`
  };

  let prompt = basePrompts[scene] || basePrompts.tease;

  // 根据性格调整
  if (personality.aggressiveness > 0.7) {
    prompt += `\n- 你天生带有侵略性，喜欢掌控局面`;
  }
  if (personality.gentleness > 0.7) {
    prompt += `\n- 你天性温柔，即使"严厉"也带着关切`;
  }
  if (personality.creativity > 0.7) {
    prompt += `\n- 你富有创意，善于设计新颖的互动方式`;
  }
  if (personality.patience > 0.7) {
    prompt += `\n- 你极具耐心，不急于求成，享受过程`;
  }

  return prompt;
}

// 生成设备控制指令格式提示
export function generateDeviceCommandPrompt(): string {
  return `### 玩具设备控制指令格式
当你想要控制用户的外部设备（跳蛋等）时，请输出以下格式的指令（用户不可见，系统自动执行）：

格式1 - 简单强度控制：
\`\`\`
"VIBRATE": 500
\`\`\`

格式2 - 渐变模式（pattern为阶段强度，interval为变速间隔毫秒）：
\`\`\`
"VIBRATE": {"pattern": [200, 500, 800], "interval": [1000, 500]}
\`\`\`

格式3 - 循环模式（loop控制循环次数，省略则无限循环）：
\`\`\`
"VIBRATE": {"pattern": [300, 600, 300], "interval": [800, 800], "loop": 5}
\`\`\`

格式4 - 抽插/往复（线性）：
\`\`\`
"LINEAR": {"start_position": 10, "end_position": 90, "duration": 2000}
\`\`\`

格式5 - 速度渐变（线性速度变化）：
\`\`\`
"LINEAR_SPEED": {"start_position": 10, "end_position": 90, "start_duration": 2000, "end_duration": 500, "steps": 10}
\`\`\`

格式6 - 复杂线性模式（多段）：
\`\`\`
"LINEAR_PATTERN": {
  "repeat": true,
  "segments": [
    { "start": 10, "end": 90, "durations": [1000, 500], "loop": 3 },
    { "start": 20, "end": 80, "durations": [1200], "loop": 5 }
  ]
}
\`\`\`

格式7 - 抽插/摆动（旋转/振荡，设备不支持时会退化为震动）：
\`\`\`
"OSCILLATE": 600
\`\`\`

强度参考值：
- 50-150: 轻微触碰/挑逗
- 200-350: 轻柔刺激
- 400-600: 中等强度/正常抽插节奏
- 700-850: 高强度/快速冲刺
- 900-1000: 极限/高潮边缘/寸止

使用建议：
1. 根据当前场景、角色情绪和互动氛围选择合适的强度
2. 善用渐变模式创造起伏感
3. 惩罚场景可用高强度短脉冲，奖励场景可用温和长时间
4. 调情时从低强度开始逐步提升

注意：指令会被系统自动隐藏，不会显示在聊天记录中。`;
}

// 生成玩具控制上下文提示
export function generateToyControlContext(
  settings: ToyControlSettings,
  personality: AgentToyPersonality,
  currentScene: ToyScene,
  isUserInitiated: boolean
): string {
  if (!settings.enabled) return '';

  let context = `\n### 远程玩具控制 (Intiface Device Control)\n`;

  // 控制权限说明
  if (settings.userVetoEnabled) {
    context += `- 【重要】用户拥有一票否决权。如果用户拒绝或表达不适，你必须立即停止设备控制。\n`;
  }

  if (settings.agentProactiveEnabled && !isUserInitiated) {
    context += `- 你拥有主动控制权限。基于你的人设和当前氛围，你可以决定是否启动设备控制。\n`;
  }

  if (isUserInitiated) {
    context += `- 这是用户主动提出的控制请求。如果你同意，请明确表达同意并引导后续互动。\n`;
  }

  // 当前场景
  if (currentScene !== 'none') {
    context += `\n当前场景：${currentScene}\n`;
    context += generateScenePrompt(currentScene, personality);
    context += `\n`;
  }

  // 控制模式
  context += `\n控制模式：${settings.mode === 'manual' ? '手动（需明确指令）' : settings.mode === 'auto' ? '自动（你自主决定）' : '混合（建议+确认）'}\n`;

  // 强度限制
  if (settings.maxIntensity < 1000) {
    context += `强度上限：${settings.maxIntensity}/1000\n`;
  }

  // 安全词
  if (settings.safeWord) {
    context += `\n安全词："${settings.safeWord}" - 用户说出这个词时，必须立即停止所有设备活动。\n`;
  }

  // 指令格式
  context += `\n${generateDeviceCommandPrompt()}\n`;

  return context;
}

// 计算主动提出的概率（数学函数）
export function calculateProactiveProbability(
  personality: AgentToyPersonality,
  timeSinceLastInteraction: number, // 毫秒
  currentMood: number, // -1 to 1
  userEngagement: number, // 0 to 1
  recentRejections: number // 最近被拒绝次数
): number {
  // 基础概率基于主动性
  let baseProb = personality.proactivity * 0.3;

  // 时间衰减 - 越久没互动越可能主动
  const hoursSinceLast = timeSinceLastInteraction / (1000 * 60 * 60);
  const timeFactor = Math.min(hoursSinceLast / 24, 1) * 0.2;

  // 情绪影响 - 情绪越正面越可能主动
  const moodFactor = (currentMood + 1) / 2 * 0.2;

  // 用户参与度 - 用户越投入越可能主动
  const engagementFactor = userEngagement * 0.15;

  // 拒绝惩罚 - 最近被拒绝会降低概率
  const rejectionPenalty = Math.min(recentRejections * 0.15, 0.3);

  // 侵略性加成
  const aggressionBonus = personality.aggressiveness * 0.1;

  // 综合计算
  let probability = baseProb + timeFactor + moodFactor + engagementFactor + aggressionBonus - rejectionPenalty;

  // 限制在 0-1 范围
  return Math.max(0, Math.min(1, probability));
}

// 生成主动提出的开场白
export function generateProactiveOpening(
  personality: AgentToyPersonality,
  scene: ToyScene,
  charName: string,
  userName: string
): string[] {
  const openings: string[] = [];

  if (personality.aggressiveness > 0.6) {
    openings.push(
      `${userName}... 过来。我有一个想法，关于如何让你今晚更「听话」一些。`,
      `我今天心情不错，但还缺了点乐子。${userName}，你愿意当我的玩具吗？`,
      `我设置了一些新东西，专门为你准备的。想试试吗？`
    );
  } else if (personality.gentleness > 0.6) {
    openings.push(
      `${userName}... 今晚我想试着照顾你，用一种特别的方式。你愿意吗？`,
      `我在想，如果能让你完全放松，把一切都交给我，会不会很美好？`,
      `我有一些温柔的计划，但只会在你同意的情况下进行。`
    );
  } else {
    openings.push(
      `嘿 ${userName}，我有个提议。想不想试试一些...刺激的？`,
      `我在想，如果引入一些外部帮助，我们的互动会不会更有趣？`,
      `今天氛围不错，我在考虑升级一下我们的玩法。你怎么看？`
    );
  }

  // 添加场景特定的提示
  switch (scene) {
    case 'tease':
      openings.push(`我想看着你慢慢失去理智的样子...`);
      break;
    case 'punish':
      openings.push(`你最近有点不乖，需要一点教训...`);
      break;
    case 'reward':
      openings.push(`你表现得很好，该得到一些特别的奖励...`);
      break;
    case 'training':
      openings.push(`我们要开始一些特别的训练了，准备好了吗？`);
      break;
  }

  return openings;
}
