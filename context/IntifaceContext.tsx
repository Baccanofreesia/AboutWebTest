import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { ButtplugClient, ButtplugBrowserWebsocketClientConnector, DeviceOutput } from 'buttplug';
import {
  ToyControlSettings,
  ToyControlSession,
  ToyControlAction,
  ToyProposeState,
  ToyScene,
  AgentToyPersonality,
  IntifaceState
} from '../types/intiface';
import { AgentProfile } from '../types';
import {
  extractToyPersonality,
  calculateScene,
  generateScenePrompt,
  generateToyControlContext,
  calculateProactiveProbability,
  generateProactiveOpening
} from '../utils/toyControl';

interface IntifaceContextType extends IntifaceState {
  // 连接控制
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  scan: () => Promise<void>;
  stopAll: () => Promise<void>;
  vibrate: (deviceIndex: number, speed: number) => Promise<void>;
  linear: (deviceIndex: number, position: number, duration: number) => Promise<void>;
  processMessage: (text: string, isNewMessage?: boolean) => void;

  // 设置控制
  setIsEnabled: (enabled: boolean) => void;
  setServerAddress: (addr: string) => void;
  setReadingSpeed: (speed: number) => void;

  // 玩具控制设置
  updateControlSettings: (settings: Partial<ToyControlSettings>) => void;
  resetControlSettings: () => void;

  // 提议流程
  userInitiatePropose: (requestedScene?: ToyScene) => boolean;
  agentInitiatePropose: (char: AgentProfile) => boolean;
  respondToPropose: (accept: boolean) => void;
  cancelPropose: () => void;

  // 场景控制
  setScene: (scene: ToyScene, description?: string) => void;
  getScenePrompt: () => string;
  getControlContext: (char: AgentProfile, isUserInitiated: boolean) => string;

  // 会话控制
  startSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  endSession: () => void;
  recordAction: (action: Omit<ToyControlAction, 'timestamp'>) => void;

  // 设备执行
  executeCommand: (type: 'vibrate' | 'oscillate' | 'linear', params: any) => Promise<void>;
  executePattern: (pattern: number[], intervals: number[], loop?: number) => Promise<void>;

  // 数学函数
  calculateProactiveChance: (char: AgentProfile, timeSinceLastInteraction: number) => number;
  shouldAgentPropose: (char: AgentProfile, timeSinceLastInteraction: number) => boolean;
}

const defaultSettings: ToyControlSettings = {
  enabled: false,
  userVetoEnabled: true,
  agentProactiveEnabled: true,
  mode: 'mixed',
  currentScene: 'none',
  sceneDescription: '',
  maxIntensity: 1000,
  allowGradient: true,
  allowPattern: true,
  safeWord: '停止'
};

const defaultProposeState: ToyProposeState = {
  isProposing: false,
  proposeType: null,
  proposedAt: null,
  userResponse: null,
  agentAcceptedScene: null
};

const IntifaceContext = createContext<IntifaceContextType | undefined>(undefined);

export const useIntiface = () => {
  const context = useContext(IntifaceContext);
  if (!context) {
    throw new Error('useIntiface must be used within an IntifaceProvider');
  }
  return context;
};

export const IntifaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 基础状态
  const [isEnabled, setIsEnabled] = useState(() => {
    return localStorage.getItem('intiface_enabled') === 'true';
  });
  const [serverAddress, setServerAddress] = useState(() => {
    return localStorage.getItem('intiface_address') || 'ws://127.0.0.1:12345';
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [readingSpeed, setReadingSpeed] = useState(20);

  // 控制设置
  const [controlSettings, setControlSettings] = useState<ToyControlSettings>(() => {
    const saved = localStorage.getItem('toy_control_settings');
    if (!saved) return defaultSettings;
    const parsed = { ...defaultSettings, ...JSON.parse(saved) };
    parsed.userVetoEnabled = true;
    if (typeof parsed.maxIntensity === 'number' && parsed.maxIntensity <= 100) {
      parsed.maxIntensity = Math.min(1000, Math.max(0, parsed.maxIntensity * 10));
    } else if (typeof parsed.maxIntensity === 'number') {
      parsed.maxIntensity = Math.min(1000, Math.max(0, parsed.maxIntensity));
    }
    return parsed;
  });

  // 提议状态
  const [proposeState, setProposeState] = useState<ToyProposeState>(defaultProposeState);

  // 会话状态
  const [session, setSession] = useState<ToyControlSession | null>(null);

  // Refs
  const clientRef = useRef<ButtplugClient | null>(null);
  const commandQueue = useRef<any[]>([]);
  const isProcessingQueue = useRef(false);
  const lastExecTime = useRef(0);
  const lastCommandIndex = useRef(0);
  const executedCommands = useRef<Set<string>>(new Set());
  const personalityCache = useRef<Map<string, AgentToyPersonality>>(new Map());

  // 持久化设置
  useEffect(() => {
    localStorage.setItem('intiface_enabled', String(isEnabled));
    if (!isEnabled && isConnected) {
      disconnect();
    }
  }, [isEnabled, isConnected]);

  useEffect(() => {
    localStorage.setItem('intiface_address', serverAddress);
  }, [serverAddress]);

  useEffect(() => {
    localStorage.setItem('toy_control_settings', JSON.stringify(controlSettings));
  }, [controlSettings]);

  // 初始化客户端
  useEffect(() => {
    clientRef.current = new ButtplugClient("AetherOS Client");
    
    clientRef.current.addListener('deviceadded', (device) => {
      console.log('Device added:', device);
      updateDevices();
    });

    clientRef.current.addListener('deviceremoved', (device) => {
      console.log('Device removed:', device);
      updateDevices();
    });

    clientRef.current.addListener('disconnect', () => {
      console.log('Client disconnected');
      setIsConnected(false);
      setDevices([]);
    });

    return () => {
      if (clientRef.current && clientRef.current.connected) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  const updateDevices = () => {
    if (clientRef.current) {
      setDevices(Array.from(clientRef.current.devices.values()));
    }
  };

  // 连接控制
  const connect = async (url: string) => {
    if (!clientRef.current) return;
    
    setIsConnecting(true);
    setError(null);
    try {
      const connector = new ButtplugBrowserWebsocketClientConnector(url);
      await clientRef.current.connect(connector);
      setIsConnected(true);
      await clientRef.current.startScanning();
    } catch (err: any) {
      console.error('Connection failed:', err);
      let msg = err.message || '连接失败';
      
      if (err.type === 'error' && err.target instanceof WebSocket) {
          const port = url.split(':').pop()?.replace(/\D/g,'') || '12345';
          msg = `无法连接到服务器 (${url})。\n请检查：\n1. Intiface Central 是否正在运行？\n2. Server Websocket Port 是否为 ${port}？`;
          
          if (window.location.protocol === 'https:' && url.startsWith('ws:')) {
              msg += '\n注意：HTTPS 网页无法直接连接非加密 WS 服务，请尝试使用 wss:// 或本地代理。';
          }
      }
      setError(msg);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (clientRef.current && clientRef.current.connected) {
      await clientRef.current.stopScanning();
      await clientRef.current.disconnect();
      setIsConnected(false);
      setDevices([]);
    }
  };

  const scan = async () => {
    if (clientRef.current && clientRef.current.connected) {
      await clientRef.current.startScanning();
    }
  };

  const stopAll = async () => {
    if (clientRef.current) {
        for (const device of devices) {
            try {
                await device.stop();
            } catch (err) {
                console.error(`Failed to stop device ${device.name}:`, err);
            }
        }
    }
  };

  const vibrate = async (deviceIndex: number, speed: number) => {
    const device = devices[deviceIndex];
    if (device) {
      try {
        await device.runOutput(DeviceOutput.Vibrate.percent(speed));
      } catch (e) {
        console.error('Vibrate failed:', e);
      }
    }
  };

  const linear = async (deviceIndex: number, position: number, duration: number) => {
    const device = devices[deviceIndex];
    if (device) {
      try {
        await device.runOutput(DeviceOutput.PositionWithDuration.percent(position, duration));
      } catch (e) {
        console.error('Linear failed:', e);
      }
    }
  };

  // 设备执行命令
  const executeCommand = async (type: 'vibrate' | 'oscillate' | 'linear', params: any) => {
    if (!isConnected || devices.length === 0) return;

    try {
      switch (type) {
        case 'vibrate':
          for (const device of devices) {
            const intensity = Math.min(controlSettings.maxIntensity, Math.max(0, params.intensity || 500));
            await device.runOutput(DeviceOutput.Vibrate.percent(intensity / 1000));
          }
          break;
        case 'oscillate':
          // 振荡模式（如果设备支持）
          for (const device of devices) {
            const speed = Math.min(controlSettings.maxIntensity, Math.max(0, params.speed || 500));
            // 使用振动模拟振荡
            await device.runOutput(DeviceOutput.Vibrate.percent(speed / 1000));
          }
          break;
        case 'linear':
          for (const device of devices) {
            const position = Math.min(100, Math.max(0, params.position || 50));
            const duration = params.duration || 1000;
            await device.runOutput(DeviceOutput.PositionWithDuration.percent(position, duration));
          }
          break;
      }

      // 记录操作
      if (session) {
        recordAction({
          actor: 'agent',
          type: 'intensity_change',
          details: { command: type, params }
        });
      }
    } catch (e) {
      console.error('Execute command failed:', e);
    }
  };

  // 执行模式
  const executePattern = async (pattern: number[], intervals: number[] | number, loop?: number) => {
    if (!isConnected || devices.length === 0) return;

    try {
      const iterations = Math.min(loop || 1, 30);
      const intervalArr = Array.isArray(intervals) ? intervals : [intervals];
      for (let l = 0; l < iterations; l++) {
        for (let i = 0; i < pattern.length; i++) {
          const intensity = Math.min(controlSettings.maxIntensity, Math.max(0, pattern[i]));
          const interval = intervalArr[i % intervalArr.length] || 1000;

          for (const device of devices) {
            await device.runOutput(DeviceOutput.Vibrate.percent(intensity / 1000));
          }

          await new Promise(r => setTimeout(r, interval));
        }
      }
    } catch (e) {
      console.error('Execute pattern failed:', e);
    }
  };

  const normalizeIntensity = (value: number) => {
    const clamped = Math.min(1000, Math.max(0, value));
    return Math.min(controlSettings.maxIntensity, clamped);
  };

  const executeLinearMove = async (start: number, end: number, duration: number) => {
    if (!isConnected || devices.length === 0) return;
    const safeStart = Math.min(100, Math.max(0, start));
    const safeEnd = Math.min(100, Math.max(0, end));
    const safeDuration = Math.max(100, duration || 800);

    for (const device of devices) {
      await device.runOutput(DeviceOutput.PositionWithDuration.percent(safeStart, 200));
    }
    await new Promise(r => setTimeout(r, 220));
    for (const device of devices) {
      await device.runOutput(DeviceOutput.PositionWithDuration.percent(safeEnd, safeDuration));
    }
    await new Promise(r => setTimeout(r, safeDuration));
  };

  const executeLinearSpeed = async (start: number, end: number, startDuration: number, endDuration: number, steps: number) => {
    const safeSteps = Math.max(1, Math.min(steps || 6, 30));
    for (let i = 0; i < safeSteps; i++) {
      const t = safeSteps === 1 ? 1 : i / (safeSteps - 1);
      const duration = Math.round(startDuration + (endDuration - startDuration) * t);
      const from = i % 2 === 0 ? start : end;
      const to = i % 2 === 0 ? end : start;
      await executeLinearMove(from, to, duration);
    }
  };

  const executeLinearPattern = async (segments: any[], repeat?: boolean) => {
    const safeSegments = Array.isArray(segments) ? segments : [];
    const maxLoops = repeat ? 20 : 1;
    for (let loopIndex = 0; loopIndex < maxLoops; loopIndex++) {
      for (const segment of safeSegments) {
        const start = Number(segment?.start ?? segment?.start_position ?? 0);
        const end = Number(segment?.end ?? segment?.end_position ?? 100);
        const durations = Array.isArray(segment?.durations) ? segment.durations : [segment?.duration || 1000];
        const loops = Math.min(Number(segment?.loop || 1), 30);
        for (let l = 0; l < loops; l++) {
          for (let i = 0; i < durations.length; i++) {
            const from = i % 2 === 0 ? start : end;
            const to = i % 2 === 0 ? end : start;
            await executeLinearMove(from, to, Number(durations[i] || 1000));
          }
        }
      }
    }
  };

  const extractDeviceBlocks = (text: string) => {
    const blocks: string[] = [];
    const regex = /<device>([\s\S]*?)<\/device>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) blocks.push(match[1]);
    }
    if (blocks.length === 0) blocks.push(text);
    return blocks;
  };

  const readValueText = (source: string, start: number) => {
    let i = start;
    while (i < source.length && /\s/.test(source[i])) i++;
    const first = source[i];
    if (!first) return { valueText: '', end: i };
    if (first === '{' || first === '[') {
      const stack = [first];
      let inString = false;
      let escaped = false;
      i++;
      while (i < source.length && stack.length) {
        const ch = source[i];
        if (inString) {
          if (!escaped && ch === '"') inString = false;
          escaped = !escaped && ch === '\\';
          i++;
          continue;
        }
        if (ch === '"') {
          inString = true;
          i++;
          continue;
        }
        if (ch === '{' || ch === '[') stack.push(ch);
        if (ch === '}' || ch === ']') stack.pop();
        i++;
      }
      return { valueText: source.slice(start, i).trim(), end: i };
    }
    if (first === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      return { valueText: source.slice(start, i).trim(), end: i };
    }
    const numMatch = source.slice(i).match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      const valueText = numMatch[0];
      return { valueText, end: i + valueText.length };
    }
    const until = source.slice(i).match(/^[^,\r\n]+/);
    const valueText = until ? until[0] : '';
    return { valueText: valueText.trim(), end: i + valueText.length };
  };

  const parseCommandsFromBlock = (block: string) => {
    const commands: { type: string; value: any; startIndex: number; raw: string }[] = [];
    const regex = /"(VIBRATE|OSCILLATE|LINEAR|LINEAR_SPEED|LINEAR_PATTERN)"\s*:\s*/gi;
    let match;
    while ((match = regex.exec(block)) !== null) {
      const type = match[1].toUpperCase();
      const valueStart = regex.lastIndex;
      const { valueText, end } = readValueText(block, valueStart);
      if (!valueText) continue;
      regex.lastIndex = end;
      let value: any = valueText;
      const cleaned = valueText.replace(/;$/, '').trim();
      try {
        if (cleaned.startsWith('{') || cleaned.startsWith('[') || cleaned.startsWith('"')) {
          value = JSON.parse(cleaned);
        } else if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
          value = Number(cleaned);
        }
      } catch {
        value = cleaned;
      }
      commands.push({ type, value, startIndex: match.index, raw: cleaned });
    }
    return commands;
  };

  const enqueueCommand = useCallback((command: any) => {
    commandQueue.current.push(command);
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;
    try {
      while (commandQueue.current.length > 0) {
        const command = commandQueue.current.shift();
        if (!command) continue;
        if (!isEnabled || !controlSettings.enabled || !isConnected || devices.length === 0) continue;
        if (!session || session.state !== 'active') continue;
        if (command.delayMs) await new Promise(r => setTimeout(r, command.delayMs));

        if (command.type === 'VIBRATE') {
          const payload = command.value;
          if (typeof payload === 'number') {
            await executeCommand('vibrate', { intensity: normalizeIntensity(payload) });
          } else if (Array.isArray(payload)) {
            const avg = payload.reduce((a, b) => a + Number(b || 0), 0) / Math.max(1, payload.length);
            await executeCommand('vibrate', { intensity: normalizeIntensity(avg) });
          } else if (payload?.pattern && controlSettings.allowPattern) {
            const pattern = payload.pattern.map((v: any) => Array.isArray(v) ? v.reduce((a: number, b: number) => a + b, 0) / Math.max(1, v.length) : Number(v || 0));
            const intervals = payload.interval ?? payload.intervals ?? 1000;
            const loop = payload.loop;
            await executePattern(pattern.map(normalizeIntensity), intervals, loop);
          }
        }

        if (command.type === 'OSCILLATE') {
          const payload = command.value;
          if (typeof payload === 'number') {
            await executeCommand('oscillate', { speed: normalizeIntensity(payload) });
          } else if (payload?.pattern && controlSettings.allowPattern) {
            const pattern = payload.pattern.map((v: any) => Number(v || 0));
            const intervals = payload.interval ?? payload.intervals ?? 1000;
            const loop = payload.loop;
            await executePattern(pattern.map(normalizeIntensity), intervals, loop);
          }
        }

        if (command.type === 'LINEAR') {
          const payload = command.value || {};
          await executeLinearMove(
            Number(payload.start_position ?? payload.start ?? 0),
            Number(payload.end_position ?? payload.end ?? 100),
            Number(payload.duration ?? 1000)
          );
        }

        if (command.type === 'LINEAR_SPEED' && controlSettings.allowGradient) {
          const payload = command.value || {};
          await executeLinearSpeed(
            Number(payload.start_position ?? 0),
            Number(payload.end_position ?? 100),
            Number(payload.start_duration ?? 2000),
            Number(payload.end_duration ?? 800),
            Number(payload.steps ?? 6)
          );
        }

        if (command.type === 'LINEAR_PATTERN' && controlSettings.allowPattern) {
          const payload = command.value || {};
          await executeLinearPattern(payload.segments || [], payload.repeat);
        }
      }
    } finally {
      isProcessingQueue.current = false;
    }
  }, [controlSettings, devices.length, executeCommand, executeLinearMove, executeLinearPattern, executeLinearSpeed, executePattern, isConnected, isEnabled, normalizeIntensity, session]);

  // 设置控制
  const updateControlSettings = useCallback((settings: Partial<ToyControlSettings>) => {
    setControlSettings(prev => {
      const next = { ...prev, ...settings };
      next.userVetoEnabled = true;
      if (typeof settings.maxIntensity === 'number') {
        next.maxIntensity = Math.min(1000, Math.max(0, settings.maxIntensity));
      }
      return next;
    });
  }, []);

  const resetControlSettings = useCallback(() => {
    setControlSettings(defaultSettings);
  }, []);

  // 会话控制
  const startSession = useCallback(() => {
    const newSession: ToyControlSession = {
      id: `session_${Date.now()}`,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      state: 'active',
      currentIntensity: 0,
      history: []
    };
    setSession(newSession);
  }, []);

  // 提议流程 - 用户主动提起
  const userInitiatePropose = useCallback((requestedScene?: ToyScene): boolean => {
    if (proposeState.isProposing) return false;

    setProposeState({
      isProposing: true,
      proposeType: 'user_initiated',
      proposedAt: Date.now(),
      userResponse: 'pending',
      agentAcceptedScene: requestedScene || null
    });

    return true;
  }, [proposeState.isProposing]);

  // Agent 主动提议
  const agentInitiatePropose = useCallback((char: AgentProfile): boolean => {
    if (!controlSettings.agentProactiveEnabled) return false;
    if (proposeState.isProposing) return false;

    // 获取或计算性格
    let personality = personalityCache.current.get(char.id);
    if (!personality) {
      personality = extractToyPersonality(char);
      personalityCache.current.set(char.id, personality);
    }

    setProposeState({
      isProposing: true,
      proposeType: 'agent_initiated',
      proposedAt: Date.now(),
      userResponse: 'pending',
      agentAcceptedScene: null
    });

    return true;
  }, [controlSettings.agentProactiveEnabled, proposeState.isProposing]);

  // 回应提议
  const respondToPropose = useCallback((accept: boolean) => {
    setProposeState(prev => ({
      ...prev,
      isProposing: false,
      userResponse: accept ? 'accepted' : 'rejected'
    }));

    if (accept) {
      // 开始会话
      updateControlSettings({ enabled: true });
      startSession();
    } else {
      stopAll();
      if (controlSettings.userVetoEnabled) {
        updateControlSettings({ enabled: false });
      }
    }
  }, [controlSettings.userVetoEnabled, startSession, stopAll, updateControlSettings]);

  // 取消提议
  const cancelPropose = useCallback(() => {
    setProposeState(defaultProposeState);
  }, []);

  // 场景设置
  const setScene = useCallback((scene: ToyScene, description?: string) => {
    updateControlSettings({
      currentScene: scene,
      sceneDescription: description || ''
    });

    // 记录场景变更
    if (session) {
      recordAction({
        actor: 'agent',
        type: 'scene_change',
        details: { scene, description }
      });
    }
  }, [updateControlSettings, session]);

  // 获取场景提示词
  const getScenePrompt = useCallback((): string => {
    // 这里需要从外部传入 personality，暂时返回空字符串
    // 实际使用时应该通过 char 参数获取
    return '';
  }, []);

  // 获取控制上下文
  const getControlContext = useCallback((char: AgentProfile, isUserInitiated: boolean): string => {
    const personality = extractToyPersonality(char);
    return generateToyControlContext(controlSettings, personality, controlSettings.currentScene, isUserInitiated);
  }, [controlSettings]);

  const pauseSession = useCallback(() => {
    if (session) {
      setSession({ ...session, state: 'paused' });
      // 停止所有设备
      stopAll();
    }
  }, [session, stopAll]);

  const resumeSession = useCallback(() => {
    if (session) {
      setSession({ ...session, state: 'active', lastActivityAt: Date.now() });
    }
  }, [session]);

  const endSession = useCallback(() => {
    if (session) {
      // 停止所有设备
      stopAll();
      // 记录结束
      recordAction({
        actor: 'user',
        type: 'stop',
        details: { reason: 'session_end' }
      });
    }
    setSession(null);
    setScene('none');
  }, [session, stopAll, setScene]);

  // 自动会话规则：启用且已连接时自动开始，关闭/断开时自动结束
  useEffect(() => {
    if (!isEnabled || !isConnected || !controlSettings.enabled) {
      if (session) endSession();
      return;
    }
    if (!session) startSession();
  }, [controlSettings.enabled, endSession, isConnected, isEnabled, session, startSession]);

  // 记录操作
  const recordAction = useCallback((action: Omit<ToyControlAction, 'timestamp'>) => {
    if (session) {
      const fullAction: ToyControlAction = {
        ...action,
        timestamp: Date.now()
      };
      setSession({
        ...session,
        history: [...session.history, fullAction],
        lastActivityAt: Date.now()
      });
    }
  }, [session]);

  // 数学函数计算
  const calculateProactiveChance = useCallback((char: AgentProfile, timeSinceLastInteraction: number): number => {
    const personality = extractToyPersonality(char);

    // 模拟一些环境变量
    const currentMood = Math.random() * 2 - 1; // -1 to 1
    const userEngagement = 0.5 + Math.random() * 0.5; // 0.5 to 1
    const recentRejections = 0; // 可从历史记录计算

    return calculateProactiveProbability(
      personality,
      timeSinceLastInteraction,
      currentMood,
      userEngagement,
      recentRejections
    );
  }, []);

  const shouldAgentPropose = useCallback((char: AgentProfile, timeSinceLastInteraction: number): boolean => {
    const chance = calculateProactiveChance(char, timeSinceLastInteraction);
    return Math.random() < chance;
  }, [calculateProactiveChance]);

  // 命令处理（简化版）
  const processMessage = useCallback((text: string, isNewMessage: boolean = false) => {
    if (!isEnabled || !isConnected || devices.length === 0) return;
    if (!controlSettings.enabled) return;
    if (!session || session.state !== 'active') return;

    if (isNewMessage) {
      executedCommands.current.clear();
      commandQueue.current = [];
      lastCommandIndex.current = 0;
      lastExecTime.current = Date.now();
    }

    const blocks = extractDeviceBlocks(text);
    const commands = blocks.flatMap(block => parseCommandsFromBlock(block));

    for (const cmd of commands) {
      const signature = `${cmd.type}:${cmd.startIndex}:${cmd.raw}`;
      if (executedCommands.current.has(signature)) continue;
      executedCommands.current.add(signature);

      const indexDelta = Math.max(0, cmd.startIndex - lastCommandIndex.current);
      const delayMs = Math.min(8000, Math.round((indexDelta / Math.max(1, readingSpeed)) * 1000));
      lastCommandIndex.current = cmd.startIndex;

      enqueueCommand({
        type: cmd.type,
        value: cmd.value,
        delayMs
      });
    }

    processQueue();
  }, [controlSettings.enabled, devices.length, enqueueCommand, extractDeviceBlocks, isConnected, isEnabled, parseCommandsFromBlock, processQueue, readingSpeed, session, session?.state]);

  const value: IntifaceContextType = {
    // 基础状态
    isConnected,
    isConnecting,
    error,
    devices,
    settings: controlSettings,
    session,
    proposeState,
    scenePrompt: getScenePrompt(),
    serverAddress,
    isEnabled,
    readingSpeed,

    // 连接控制
    connect,
    disconnect,
    scan,
    stopAll,
    vibrate,
    linear,
    processMessage,

    // 设置控制
    setIsEnabled,
    setServerAddress,
    setReadingSpeed,

    // 玩具控制设置
    updateControlSettings,
    resetControlSettings,

    // 提议流程
    userInitiatePropose,
    agentInitiatePropose,
    respondToPropose,
    cancelPropose,

    // 场景控制
    setScene,
    getScenePrompt,
    getControlContext,

    // 会话控制
    startSession,
    pauseSession,
    resumeSession,
    endSession,
    recordAction,

    // 设备执行
    executeCommand,
    executePattern,

    // 数学函数
    calculateProactiveChance,
    shouldAgentPropose
  };

  return (
    <IntifaceContext.Provider value={value}>
      {children}
    </IntifaceContext.Provider>
  );
};
