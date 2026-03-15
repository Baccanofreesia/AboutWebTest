import { safeResponseJson } from './safeApi';

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

export const transcribeWithColi = async (blob: Blob): Promise<{ text: string; emotion?: string } | null> => {
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
        if (!res.ok || !data?.success) return null;
        const text = String(data?.text || '').trim();
        if (!text) return null;
        return { text, emotion: data?.emotion || '' };
    } catch {
        return null;
    }
};

export const transcribeWithFasterWhisper = async (blob: Blob): Promise<{ text: string; emotion?: string } | null> => {
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
        if (!res.ok || !data?.success) return null;
        const text = String(data?.text || '').trim();
        if (!text) return null;
        return { text, emotion: data?.emotion || '' };
    } catch {
        return null;
    }
};
