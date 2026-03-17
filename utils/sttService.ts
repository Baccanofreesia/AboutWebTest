/**
 * sttService.ts — 语音转文字 (STT) 服务
 * 
 * Phase 1: 使用浏览器原生 Web Speech API (免费、零配置)
 * Phase 2: 可扩展为 Faster-Whisper 后端
 * 
 * 功能:
 * - 从 audio Blob 进行语音识别
 * - 实时流式识别 (用于录音时)
 * - 降级处理 (浏览器不支持时)
 */

export interface STTResult {
    text: string;
    confidence: number;
    isFinal: boolean;
}

/**
 * 从音频 Blob 进行语音识别
 * 使用 Web Speech API: 播放音频到虚拟输出，同时通过 SpeechRecognition 捕获
 * 
 * 注意: Web Speech API 只能识别麦克风输入，无法直接识别文件
 * 所以实际策略: 录音时就同步做 STT，录音结束时已有转写文本
 */
export class SpeechToTextService {
    private recognition: any = null;
    private isListening = false;
    private transcript = '';
    private onResult: ((result: STTResult) => void) | null = null;

    constructor() {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'zh-CN'; // Default Chinese, auto-detects mixed
            this.recognition.maxAlternatives = 1;

            this.recognition.onresult = (event: any) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        finalTranscript += result[0].transcript;
                    } else {
                        interimTranscript += result[0].transcript;
                    }
                }

                if (finalTranscript) {
                    this.transcript += finalTranscript;
                    this.onResult?.({ text: this.transcript, confidence: event.results[event.resultIndex]?.[0]?.confidence || 0, isFinal: true });
                } else if (interimTranscript) {
                    this.onResult?.({ text: this.transcript + interimTranscript, confidence: 0.5, isFinal: false });
                }
            };

            this.recognition.onerror = (event: any) => {
                console.warn('[STT] Error:', event.error);
                // Don't stop on 'no-speech' errors, keep listening
                if (event.error !== 'no-speech' && event.error !== 'aborted') {
                    this.stop();
                }
            };

            this.recognition.onend = () => {
                // Auto-restart if still supposed to be listening (continuous mode fix)
                if (this.isListening) {
                    try { this.recognition.start(); } catch (e) { /* ignore */ }
                }
            };
        }
    }

    get isSupported(): boolean {
        return !!this.recognition;
    }

    /**
     * 开始实时识别 (在录音时调用)
     */
    start(onResult?: (result: STTResult) => void): void {
        if (!this.recognition) return;
        this.transcript = '';
        this.onResult = onResult || null;
        this.isListening = true;
        try {
            this.recognition.start();
        } catch (e) {
            console.warn('[STT] Start failed:', e);
        }
    }

    /**
     * 停止识别，返回最终文本
     */
    stop(): string {
        this.isListening = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* ignore */ }
        }
        const result = this.transcript.trim();
        this.transcript = '';
        this.onResult = null;
        return result;
    }

    /**
     * 取消识别
     */
    cancel(): void {
        this.isListening = false;
        if (this.recognition) {
            try { this.recognition.abort(); } catch (e) { /* ignore */ }
        }
        this.transcript = '';
        this.onResult = null;
    }

    /**
     * 设置识别语言
     */
    setLanguage(lang: string): void {
        if (this.recognition) {
            this.recognition.lang = lang;
        }
    }
}

// Singleton instance
let sttInstance: SpeechToTextService | null = null;

export function getSTTService(): SpeechToTextService {
    if (!sttInstance) {
        sttInstance = new SpeechToTextService();
    }
    return sttInstance;
}
