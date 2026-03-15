/**
 * minimaxWsTts.ts
 * MiniMax WebSocket 流式 TTS 服务
 * 专为电话通话场景设计：低延迟、可打断、边合成边播放
 *
 * 协议流程：
 * 1. wss://api.minimaxi.com/ws/v1/t2a_v2?authorization=Bearer {key}
 * 2. 收到 connected_success → 发送 task_start
 * 3. 收到 task_started → 可发送 task_continue（文本片段）
 * 4. 收到 task_continued → data.audio (hex) 边收边播
 * 5. 发送 task_finish → 等所有音频播完
 * 6. WebSocket 自动关闭
 *
 * 打断逻辑：
 * - 调用 interrupt() → 立刻停止当前 Audio，关闭 WS 连接
 * - 新一轮对话重新建连
 */

import { AgentProfile, APIConfig } from '../types';
import { resolveMiniMaxApiKey } from './minimaxApiKey';
import { buildTtsExtras, buildVoiceSettings, insertSpeechBreaks } from './ttsService';

const WS_ENDPOINT = 'wss://api.minimaxi.com/ws/v1/t2a_v2';
const DEFAULT_MODEL = 'speech-2.8-turbo';

const getWsOrigin = () => {
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    return origin.startsWith('https') ? origin.replace(/^https/, 'wss') : origin.replace(/^http/, 'ws');
};

const buildWsUrl = (apiKey: string) => {
    const token = encodeURIComponent(`Bearer ${apiKey}`);
    const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;
    if (isDev) {
        const origin = getWsOrigin();
        if (origin) {
            return `${origin}/api/minimax/ws?authorization=${token}`;
        }
    }
    return `${WS_ENDPOINT}?authorization=${token}`;
};

// hex → Uint8Array
function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return bytes;
}

// 把一段文字按句子边界切分，逐片发送，降低首包延迟
function splitIntoChunks(text: string, maxLen = 60): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    // 按句子边界切
    const sentences = text.split(/(?<=[。！？\.!?])/);
    let current = '';
    for (const s of sentences) {
        if ((current + s).length > maxLen && current) {
            chunks.push(current);
            current = s;
        } else {
            current += s;
        }
    }
    if (current) chunks.push(current);
    return chunks.filter(c => c.trim());
}

export interface WsTtsOptions {
    apiKey: string;
    char: AgentProfile;
    model?: string;
    /** 每收到一个音频 chunk 就回调（base64 data URL），用于边播边缓存 */
    onAudioChunk?: (dataUrl: string) => void;
    /** 合成全部完成 */
    onFinished?: () => void;
    /** 出错 */
    onError?: (err: string) => void;
}

export class MiniMaxWsTts {
    private ws: WebSocket | null = null;
    private taskStarted = false;
    private audioQueue: AudioBuffer[] = [];
    private audioCtx: AudioContext | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private isPlaying = false;
    private interrupted = false;
    private pendingChunks: string[] = [];
    private options: WsTtsOptions;
    private groupId: string;
    private connectPromise: Promise<void> | null = null;

    constructor(options: WsTtsOptions, groupId = '') {
        this.options = options;
        this.groupId = groupId;
    }

    /** 连接 WebSocket，准备好后发送 task_start */
    private connect(): Promise<void> {
        if (this.connectPromise) return this.connectPromise;
        this.connectPromise = new Promise((resolve, reject) => {
            const { apiKey, char, model } = this.options;
            const vp = char.voiceProfile;
            const url = buildWsUrl(apiKey);

            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                // 建连后立刻发 task_start
                const startMsg: any = {
                    event: 'task_start',
                    model: model || vp?.model || DEFAULT_MODEL,
                    voice_setting: {
                        voice_id: vp?.voiceId || '',
                        ...buildVoiceSettings(vp),
                    },
                    audio_setting: {
                        format: 'mp3',
                        sample_rate: 32000,
                        bitrate: 128000,
                        channel: 1,
                    },
                    ...buildTtsExtras(vp),
                };
                if (this.groupId) startMsg.group_id = this.groupId;
                this.ws!.send(JSON.stringify(startMsg));
            };

            this.ws.onmessage = (event) => {
                if (this.interrupted) return;
                let msg: any;
                try {
                    msg = JSON.parse(typeof event.data === 'string' ? event.data : '{}');
                } catch {
                    return;
                }

                const evtType = msg.event || msg.Event;

                if (evtType === 'connected_success') {
                    const statusCode = msg?.base_resp?.status_code;
                    if (typeof statusCode === 'number' && statusCode !== 0) {
                        const reason = msg?.base_resp?.status_msg || '建连失败';
                        const errMsg = `TTS 鉴权失败 (${statusCode}): ${reason}`;
                        this.options.onError?.(errMsg);
                        reject(new Error(errMsg));
                        return;
                    }
                    return;
                }

                if (evtType === 'task_started') {
                    const statusCode = msg?.base_resp?.status_code;
                    if (typeof statusCode === 'number' && statusCode !== 0) {
                        const reason = msg?.base_resp?.status_msg || '任务启动失败';
                        const errMsg = `TTS 任务失败 (${statusCode}): ${reason}`;
                        this.options.onError?.(errMsg);
                        reject(new Error(errMsg));
                        return;
                    }
                    this.taskStarted = true;
                    resolve();
                    // 发送已经积压的文本
                    for (const chunk of this.pendingChunks) {
                        this.sendContinue(chunk);
                    }
                    this.pendingChunks = [];
                    return;
                }

                if (evtType === 'task_continued') {
                    const hexAudio = msg?.data?.audio;
                    if (hexAudio && typeof hexAudio === 'string' && hexAudio.length > 0) {
                        this.enqueueAudio(hexAudio);
                        this.options.onAudioChunk?.(hexAudio);
                    }
                    return;
                }

                if (evtType === 'task_finished') {
                    // 等待音频队列播完
                    this.waitUntilDone().then(() => this.options.onFinished?.());
                    return;
                }

                if (evtType === 'task_failed') {
                    const code = msg?.base_resp?.status_code;
                    const reason = msg?.base_resp?.status_msg || '合成失败';
                    const errMsg = typeof code === 'number' ? `TTS 失败 (${code}): ${reason}` : reason;
                    this.options.onError?.(errMsg);
                    reject(new Error(errMsg));
                    return;
                }
            };

            this.ws.onerror = () => {
                const err = 'WebSocket 连接失败';
                this.options.onError?.(err);
                reject(new Error(err));
            };

            this.ws.onclose = () => {
                this.taskStarted = false;
                this.connectPromise = null;
            };
        });
        return this.connectPromise;
    }

    private sendContinue(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ event: 'task_continue', text }));
    }

    private sendFinish() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ event: 'task_finish' }));
    }

    /** 将 hex 音频加入播放队列，边收边播 */
    private async enqueueAudio(hex: string) {
        try {
            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }
            const bytes = hexToBytes(hex);
            const buffer = await this.audioCtx.decodeAudioData(bytes.buffer as ArrayBuffer);
            this.audioQueue.push(buffer);
            if (!this.isPlaying) {
                this.playNext();
            }
        } catch {
            // 解码失败，跳过这个 chunk
        }
    }

    private playNext() {
        if (this.interrupted || this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }
        if (!this.audioCtx) return;

        this.isPlaying = true;
        const buffer = this.audioQueue.shift()!;
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        this.currentSource = source;
        source.onended = () => {
            this.currentSource = null;
            this.playNext();
        };
        source.start();
    }

    /** 等待音频播放完毕 */
    private waitUntilDone(): Promise<void> {
        return new Promise(resolve => {
            const check = () => {
                if (!this.isPlaying && this.audioQueue.length === 0) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    /**
     * 主入口：合成并播放一段文字
     * 支持多次调用（在同一个 WS 连接内追加文本）
     */
    async speak(text: string): Promise<void> {
        if (this.interrupted) return;

        const processedText = insertSpeechBreaks(text);
        const chunks = splitIntoChunks(processedText);

        if (!this.taskStarted) {
            // 先缓存，等 task_started 后再发
            this.pendingChunks.push(...chunks);
            await this.connect();
        } else {
            for (const chunk of chunks) {
                this.sendContinue(chunk);
            }
        }
    }

    /** 结束发送，等待所有音频播完 */
    async finish(): Promise<void> {
        if (this.pendingChunks.length && !this.taskStarted) {
            try {
                await this.connect();
            } catch {
                return;
            }
        }
        this.sendFinish();
        await this.waitUntilDone();
    }

    /**
     * 打断：立即停止播放 + 关闭连接
     * 调用后此实例不可再复用
     */
    interrupt() {
        this.interrupted = true;

        // 停止当前音频
        try {
            this.currentSource?.stop();
        } catch { }
        this.currentSource = null;
        this.audioQueue = [];
        this.isPlaying = false;

        // 关闭 WS
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        } catch { }
        this.ws = null;
        this.connectPromise = null;

        // 关闭 AudioContext
        try {
            this.audioCtx?.close();
        } catch { }
        this.audioCtx = null;
    }

    /** 是否正在播放 */
    get playing() {
        return this.isPlaying;
    }
}

/** 工厂函数，创建一个新的 WS TTS 实例 */
export function createWsTts(char: AgentProfile, apiConfig: APIConfig, callbacks?: {
    onAudioChunk?: (hex: string) => void;
    onFinished?: () => void;
    onError?: (err: string) => void;
}): MiniMaxWsTts | null {
    const apiKey = resolveMiniMaxApiKey(apiConfig).replace(/\s+/g, '');
    if (!apiKey || apiConfig.ttsProvider !== 'minimax') return null;
    const vp = char.voiceProfile;
    if (!vp?.voiceId && (!vp?.timberWeights?.length)) return null;

    return new MiniMaxWsTts({
        apiKey,
        char,
        onAudioChunk: callbacks?.onAudioChunk,
        onFinished: callbacks?.onFinished,
        onError: callbacks?.onError,
    }, apiConfig.minimaxGroupId || '');
}
