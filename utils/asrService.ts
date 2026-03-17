import { safeResponseJson } from './safeApi';

export type AsrResult = { text: string; emotion?: string; error?: string };

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = String(reader.result || '');
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
            if (!base64) reject(new Error('base64 为空'));
            else resolve(base64);
        };
        reader.onerror = () => reject(new Error('读取音频失败'));
        reader.readAsDataURL(blob);
    });
};

const decodeToPcm16 = async (blob: Blob, targetSampleRate = 16000): Promise<Int16Array> => {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) throw new Error('AudioContext not supported');
    const audioCtx = new AudioCtx();
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    let rendered = decoded;
    if (decoded.sampleRate !== targetSampleRate || decoded.numberOfChannels !== 1) {
        const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
        const offlineCtx = new OfflineAudioContext(1, frameCount, targetSampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(offlineCtx.destination);
        source.start(0);
        rendered = await offlineCtx.startRendering();
    }

    const channel = rendered.getChannelData(0);
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    try { audioCtx.close(); } catch { }
    return pcm;
};

const pcmToBase64 = async (pcm: Int16Array): Promise<string> => {
    const bytes = new Uint8Array(pcm.buffer);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
    return blobToBase64(blob);
};

export const transcribeWithColi = async (blob: Blob): Promise<AsrResult | null> => {
    try {
        const base64 = await blobToBase64(blob);
        const res = await fetch('/api/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                engine: 'coli',
                model: 'sensevoice',
                noPolish: true,
                base64,
                filename: 'voice.webm'
            })
        });
        const data = await safeResponseJson(res);
        if (!res.ok || !data?.success) return { text: '', error: data?.error || `HTTP ${res.status}` };
        const text = String(data?.text || '').trim();
        if (!text) return { text: '', error: 'empty result' };
        return { text, emotion: data?.emotion || '' };
    } catch {
        return { text: '', error: 'request failed' };
    }
};

export const transcribeWithFasterWhisper = async (blob: Blob): Promise<AsrResult | null> => {
    try {
        const base64 = await blobToBase64(blob);
        const res = await fetch('/api/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                engine: 'faster-whisper',
                model: 'distil-large-v3',
                language: 'zh',
                base64,
                filename: 'call.webm'
            })
        });
        const data = await safeResponseJson(res);
        if (!res.ok || !data?.success) return { text: '', error: data?.error || `HTTP ${res.status}` };
        const text = String(data?.text || '').trim();
        if (!text) return { text: '', error: 'empty result' };
        return { text, emotion: data?.emotion || '' };
    } catch {
        return { text: '', error: 'request failed' };
    }
};

export const transcribeWithByteDance = async (
    blob: Blob,
    config: {
        appKey?: string;
        accessKey?: string;
        resourceId?: string;
        mode?: 'fast' | 'standard' | 'dual';
        language?: string;
        enablePunc?: boolean;
        enableItn?: boolean;
        enableEmotion?: boolean;
    }
): Promise<AsrResult | null> => {
    try {
        if (!config.appKey || !config.accessKey || !config.resourceId) {
            return { text: '', error: 'missing bytedance credentials' };
        }
        const pcm = await decodeToPcm16(blob, 16000);
        const base64 = await pcmToBase64(pcm);
        const res = await fetch('/api/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                engine: 'bytedance',
                base64,
                format: 'pcm',
                rate: 16000,
                bits: 16,
                channel: 1,
                language: config.language,
                bytedance: {
                    appKey: config.appKey,
                    accessKey: config.accessKey,
                    resourceId: config.resourceId,
                    mode: config.mode || 'fast',
                    enablePunc: config.enablePunc ?? true,
                    enableItn: config.enableItn ?? true,
                    enableEmotion: config.enableEmotion ?? false,
                }
            })
        });
        const data = await safeResponseJson(res);
        if (!res.ok || !data?.success) return { text: '', error: data?.error || `HTTP ${res.status}` };
        const text = String(data?.text || '').trim();
        if (!text) return { text: '', error: 'empty result' };
        return { text, emotion: data?.emotion || '' };
    } catch (e: any) {
        return { text: '', error: e?.message || 'request failed' };
    }
};

export const transcribeWithByteDanceFile = async (
    blob: Blob,
    config: {
        appKey?: string;
        accessKey?: string;
        resourceId?: string;
        publicBaseUrl?: string;
        language?: string;
        enablePunc?: boolean;
        enableItn?: boolean;
        enableEmotion?: boolean;
    }
): Promise<AsrResult | null> => {
    try {
        if (!config.appKey || !config.accessKey || !config.resourceId) {
            return { text: '', error: 'missing bytedance credentials' };
        }
        if (!config.publicBaseUrl) {
            return { text: '', error: 'missing public base url' };
        }
        const pcm = await decodeToPcm16(blob, 16000);
        const base64 = await pcmToBase64(pcm);
        const res = await fetch('/api/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                engine: 'bytedance-auc',
                pcmBase64: base64,
                format: 'wav',
                rate: 16000,
                bits: 16,
                channel: 1,
                language: config.language,
                publicBaseUrl: config.publicBaseUrl,
                bytedance: {
                    appKey: config.appKey,
                    accessKey: config.accessKey,
                    resourceId: config.resourceId,
                    enablePunc: config.enablePunc ?? true,
                    enableItn: config.enableItn ?? true,
                    enableEmotion: config.enableEmotion ?? false,
                }
            })
        });
        const data = await safeResponseJson(res);
        if (!res.ok || !data?.success) return { text: '', error: data?.error || `HTTP ${res.status}` };
        const text = String(data?.text || '').trim();
        if (!text) return { text: '', error: 'empty result' };
        return { text, emotion: data?.emotion || '' };
    } catch (e: any) {
        return { text: '', error: e?.message || 'request failed' };
    }
};
