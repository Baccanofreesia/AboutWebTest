// Intiface 小玩具控制类型定义

export type ToyControlMode = 'manual' | 'auto' | 'mixed';
export type ToyControlState = 'idle' | 'active' | 'paused';
export type ToyScene = 'none' | 'tease' | 'punish' | 'reward' | 'training' | 'custom';

export interface ToyControlSettings {
  // 主控制开关
  enabled: boolean;
  // 用户一票否决权
  userVetoEnabled: boolean;
  // Agent 主动控制权限
  agentProactiveEnabled: boolean;
  // 当前控制模式
  mode: ToyControlMode;
  // 当前场景
  currentScene: ToyScene;
  // 场景描述
  sceneDescription: string;
  // 强度限制 (0-1000)
  maxIntensity: number;
  // 是否允许渐变
  allowGradient: boolean;
  // 是否允许模式
  allowPattern: boolean;
  // 安全词
  safeWord: string;
}

export interface ToyControlSession {
  // 会话ID
  id: string;
  // 开始时间
  startedAt: number;
  // 最后活动时间
  lastActivityAt: number;
  // 当前状态
  state: ToyControlState;
  // 当前强度
  currentIntensity: number;
  // 历史记录
  history: ToyControlAction[];
}

export interface ToyControlAction {
  // 时间戳
  timestamp: number;
  // 执行者
  actor: 'user' | 'agent';
  // 动作类型
  type: 'start' | 'stop' | 'pause' | 'resume' | 'intensity_change' | 'pattern_change' | 'scene_change';
  // 详情
  details: Record<string, any>;
}

export interface ToyProposeState {
  // 是否正在提议
  isProposing: boolean;
  // 提议类型
  proposeType: 'user_initiated' | 'agent_initiated' | null;
  // 提议时间
  proposedAt: number | null;
  // 用户回应
  userResponse: 'accepted' | 'rejected' | 'pending' | null;
  // Agent 同意的场景
  agentAcceptedScene: string | null;
}

export interface IntifaceState {
  // 连接状态
  isEnabled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  devices: any[];

  // 控制读取速度
  readingSpeed: number;
  
  // 控制设置
  settings: ToyControlSettings;
  
  // 会话状态
  session: ToyControlSession | null;
  
  // 提议状态
  proposeState: ToyProposeState;
  
  // 场景提示词
  scenePrompt: string;
  
  // 服务器地址
  serverAddress: string;
}

// Agent 性格相关的玩具控制倾向
export interface AgentToyPersonality {
  // 主动倾向 (0-1)
  proactivity: number;
  // 侵略性 (0-1)
  aggressiveness: number;
  // 温柔度 (0-1)
  gentleness: number;
  // 创意指数 (0-1)
  creativity: number;
  // 控制欲 (0-1)
  dominance: number;
  // 耐心 (0-1)
  patience: number;
  // 惩罚倾向 (0-1)
  punishmentTendency: number;
  // 奖励倾向 (0-1)
  rewardTendency: number;
}
