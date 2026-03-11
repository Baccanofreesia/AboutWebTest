import { APIConfig, AgentProfile } from '../types';

export type MiniMaxVoiceType = 'all' | 'system' | 'voice_cloning' | 'voice_generation';

export interface MiniMaxVoiceItem {
    voice_id: string;
    voice_name?: string;
    [key: string]: any;
}

export interface MiniMaxVoiceListResult {
    system_voice: MiniMaxVoiceItem[];
    voice_cloning: MiniMaxVoiceItem[];
    voice_generation: MiniMaxVoiceItem[];
    trace_id?: string;
}

const MINIMAX_VOICE_ENDPOINT = '/api/minimax/get-voice';
const MINIMAX_T2A_ENDPOINT = '/api/minimax/t2a';
const DEFAULT_MINIMAX_MODEL = 'speech-02-hd';

// MiniMax 支持的语气标签
const VALID_INTERJECTION_TAGS = new Set([
    'chuckle', 'laughs', 'sighs', 'coughs', 'clear-throat', 'groans',
    'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'snorts',
    'lip-smacking', 'humming', 'hissing', 'emm',
]);

const CN_CUE_MAP: Record<string, string> = {
    '轻笑': '(chuckle)', '笑': '(laughs)', '大笑': '(laughs)',
    '叹气': '(sighs)', '叹息': '(sighs)',
    '咳嗽': '(coughs)', '咳': '(coughs)',
    '呻吟': '(groans)', '哼': '(groans)',
    '换气': '(breath)', '呼吸': '(breath)',
    '喘气': '(pant)', '喘': '(pant)',
    '吸气': '(inhale)', '呼气': '(exhale)',
    '倒吸气': '(gasps)', '嘶': '(hissing)',
    '嗯': '(emm)', '唔': '(emm)',
    '咂嘴': '(lip-smacking)', '哼唱': '(humming)',
    '喷鼻息': '(snorts)', '吸鼻子': '(sniffs)',
};

const normalizeApiKey = (raw: string): string => raw.trim().replace(/^Bearer\s+/i, '').trim();

/** Strip parenthetical content intelligently */
const stripParensPreservingTags = (text: string): string => {
    return text
        .replace(/（([^）]{1,48})）/g, (_m, cue: string) => {
            const t = cue.trim();
            if (CN_CUE_MAP[t]) return CN_CUE_MAP[t];
            for (const [key, tag] of Object.entries(CN_CUE_MAP)) {
                if (t.includes(key)) return tag;
            }
            return '';
        })
        .replace(/\(([^)]{1,80})\)/g, (_m, inner: string) => {
            const tag = inner.trim().toLowerCase();
            if (VALID_INTERJECTION_TAGS.has(tag)) return `(${tag})`;
            return '';
        });
};

/** Clean text for TTS */
export const cleanTextForTts = (raw: string): string => {
    const voiceTagMatch = raw.match(/<[语語]音>([\s\S]*?)<\/[语語]音>/);
    if (voiceTagMatch) {
        return stripParensPreservingTags(voiceTagMatch[1]).replace(/\s+/g, ' ').trim();
    }
    let text = raw;
    text = text.replace(/\[\[.*?\]\]/g, '');
    text = text.replace(/%%BILINGUAL%%[\s\S]*/i, '');
    text = stripParensPreservingTags(text);
    text = text.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
};

/** Insert native MiniMax pauses */
export const insertSpeechBreaks = (text: string): string => {
    if (!text) return '';
    return text
        .replace(/[…]{2,}/g, '……<#0.45#>')
        .replace(/[…]/g, '…<#0.35#>')
        .replace(/\.{3,}/g, '...<#0.35#>')
        .replace(/——/g, '——<#0.18#>')
        .replace(/--/g, '--<#0.18#>')
        .replace(/([。])/g, '$1<#0.12#>')
        .replace(/([！？!?])/g, '$1<#0.14#>')
        .replace(/([，,])/g, '$1<#0.06#>')
        .replace(/([、；;：:])/g, '$1<#0.05#>')
        .replace(/\n/g, '\n<#0.25#>')
        .replace(/(<#[\d.]+#>[\s]*){2,}/g, (match) => {
            const times = [...match.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1]));
            return `<#${Math.min(Math.max(...times), 0.5).toFixed(2)}#>`;
        })
        .trim();
};

const softClamp = (value: number, limit: number): number => {
    if (Math.abs(value) <= limit) return value;
    const sign = value > 0 ? 1 : -1;
    const excess = Math.abs(value) - limit;
    return sign * (limit + Math.log1p(excess) * (limit * 0.15));
};

export const buildTtsExtras = (vp: AgentProfile['voiceProfile']) => {
    if (!vp) return {};
    const extras: any = {};
    const tw = vp.timberWeights;
    if (tw && tw.length > 1) {
        extras.timber_weights = (() => {
            const totalWeight = tw.reduce((sum: number, t: any) => sum + (t.weight || 0), 0);
            if (totalWeight === 0) return tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round(100 / tw.length) }));
            const raw = tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round((t.weight / totalWeight) * 100) }));
            const diff = 100 - raw.reduce((s: number, r: any) => s + r.weight, 0);
            if (diff !== 0) raw[0].weight += diff;
            return raw;
        })();
    }
    if (vp.voiceModify) {
        const vm: any = {};
        if (vp.voiceModify.pitch) vm.pitch = Math.round(softClamp(vp.voiceModify.pitch, 40));
        if (vp.voiceModify.intensity) vm.intensity = Math.round(softClamp(vp.voiceModify.intensity, 30));
        if (vp.voiceModify.timbre) vm.timbre = Math.round(softClamp(vp.voiceModify.timbre, 40));
        if (vp.voiceModify.sound_effects) vm.sound_effects = vp.voiceModify.sound_effects;
        if (Object.keys(vm).length) extras.voice_modify = vm;
    }
    return extras;
};

export const buildVoiceSettings = (vp: AgentProfile['voiceProfile']) => ({
    speed: Math.max(0.75, Math.min(1.4, vp?.speed ?? 1)),
    vol: Math.max(0.3, Math.min(2, vp?.vol ?? 1)),
    pitch: Math.max(-8, Math.min(8, vp?.pitch ?? 0)),
    ...(vp?.emotion ? { emotion: vp.emotion } : {}),
});

export const convertHexAudioToBlob = (hexAudio: string, mimeType = 'audio/mpeg'): Blob => {
    const cleanHex = hexAudio.trim().replace(/^0x/i, '');
    if (!cleanHex || cleanHex.length % 2 !== 0 || /[^\da-f]/i.test(cleanHex)) {
        throw new Error('HEX 音频数据格式异常');
    }
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
    }
    return new Blob([bytes], { type: mimeType });
};

export async function fetchMiniMaxVoices(apiConfig: APIConfig, voiceType: MiniMaxVoiceType = 'all'): Promise<MiniMaxVoiceListResult> {
    const key = normalizeApiKey(apiConfig.minimaxApiKey || '');
    if (!key) throw new Error('缺少 MiniMax API Key');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-MiniMax-API-Key': key,
    };
    if (apiConfig.minimaxGroupId) {
        headers['X-MiniMax-Group-Id'] = apiConfig.minimaxGroupId;
    }

    const response = await fetch(MINIMAX_VOICE_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ voice_type: voiceType }),
    });

    const data = await response.json();
    const statusCode = data?.base_resp?.status_code;
    if (!response.ok || (typeof statusCode === 'number' && statusCode !== 0)) {
        const statusMsg = data?.base_resp?.status_msg || `HTTP ${response.status}`;
        throw new Error(`MiniMax 查询失败: ${statusMsg}`);
    }

    return {
        system_voice: Array.isArray(data?.system_voice) ? data.system_voice : [],
        voice_cloning: Array.isArray(data?.voice_cloning) ? data.voice_cloning : [],
        voice_generation: Array.isArray(data?.voice_generation) ? data.voice_generation : [],
        trace_id: data?.trace_id,
    };
}

/** Fetch remote audio URL and return as Blob */
export const fetchRemoteAudioBlob = async (sourceUrl: string): Promise<Blob> => {
    const cacheBustedUrl = sourceUrl.includes('?') ? `${sourceUrl}&_ts=${Date.now()}` : `${sourceUrl}?_ts=${Date.now()}`;
    const response = await fetch(cacheBustedUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`音频下载失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('音频下载为空文件');
    return blob;
};

/**
 * Universal Synthesis Function (Supports MiniMax & Fish Speech)
 */
export async function synthesizeSpeech(
    text: string,
    char: AgentProfile,
    apiConfig: APIConfig
): Promise<Blob> {
    const provider = apiConfig.ttsProvider;
    if (!provider || provider === 'none') {
        throw new Error('未配置 TTS 服务商');
    }

    const vp = char.voiceProfile;
    if (!vp?.voiceId && (!vp?.timberWeights || vp.timberWeights.length === 0)) {
        throw new Error('该 Agent 尚未配置 Voice ID');
    }

    // Minimax Specific Logic
    if (provider === 'minimax') {
        const apiKey = normalizeApiKey(apiConfig.minimaxApiKey || '');
        if (!apiKey) throw new Error('未配置 MiniMax API Key');

        const processedText = insertSpeechBreaks(text);
        const payload: any = {
            model: vp?.model || DEFAULT_MINIMAX_MODEL,
            text: processedText,
            voice_setting: {
                voice_id: vp?.voiceId || '',
                ...buildVoiceSettings(vp),
            },
            audio_setting: { format: 'mp3' },
            ...buildTtsExtras(vp),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-MiniMax-API-Key': apiKey,
        };
        if (apiConfig.minimaxGroupId) {
            headers['X-MiniMax-Group-Id'] = apiConfig.minimaxGroupId;
        }

        const res = await fetch(MINIMAX_T2A_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `MiniMax TTS 失败 (HTTP ${res.status})`);

        const baseResp = data?.base_resp;
        if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
            throw new Error(`MiniMax 业务错误: ${baseResp.status_msg || `status_code=${baseResp.status_code}`}`);
        }

        const audio = data?.data?.audio;
        if (!audio) throw new Error('MiniMax 返回无音频数据');

        if (/^https?:\/\//i.test(audio.trim())) {
            return await fetchRemoteAudioBlob(audio.trim());
        } else {
            return convertHexAudioToBlob(audio, 'audio/mpeg');
        }
    } 
    
    // Fish Speech Local/Remote Logic
    else if (provider === 'fish_speech') {
        const baseUrl = apiConfig.fishSpeechBaseUrl?.replace(/\/+$/, '');
        if (!baseUrl) throw new Error('未配置 Fish Speech Base URL');

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiConfig.fishSpeechApiKey) {
            headers['Authorization'] = `Bearer ${apiConfig.fishSpeechApiKey}`;
        }

        const payload = {
            text: text, // Fish Speech generally does not need internal pauses or custom MiniMax tags
            reference_id: vp.voiceId,
            normalize: true,
            format: "mp3"
        };

        const res = await fetch(`${baseUrl}/v1/tts`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`Fish Speech 失败 (HTTP ${res.status})`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const errData = await res.json();
            throw new Error(errData.message || 'Fish Speech 返回异常格式');
        }

        // Return the binary blob directly
        return await res.blob();
    }

    throw new Error('未知的 TTS 服务商');
}
