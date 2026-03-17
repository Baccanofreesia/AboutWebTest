import type { APIConfig, ApiSource } from '../types';

export interface ResolvedEndpoint {
    chatUrl: string;
    modelsUrl: string;
    headers: Record<string, string>;
    transformBody?: (body: any) => any;
    supportsStreaming: boolean;
}

export interface ApiSourceMeta {
    label: string;
    placeholder: string;
    defaultBaseUrl: string;
    description: string;
    hardcodedModels?: string[];
}

// ── 火山方舟 Coding Plan 支持的模型
const VOLCENGINE_CODING_MODELS = [
    'doubao-seed-2.0-code',
    'doubao-seed-2.0-pro',
    'doubao-seed-2.0-lite',
    'doubao-seed-code',
    'minimax-m2.5',
    'glm-4.7',
    'deepseek-v3.2',
    'kimi-k2.5',
    'ark-code-latest',
];

// ── MiniMax Anthropic 兼容接口支持的模型
// 注意：Anthropic 兼容层支持 M2.1/M2，不是 M2.5
// M2.5 请使用 OpenAI 兼容接口（minimax 普通 source）
const MINIMAX_CODING_MODELS = [
    'MiniMax-M2.5',
    'MiniMax-M2.1',
    'MiniMax-M2.1-lightning',
    'MiniMax-M2',
];

export const API_SOURCE_REGISTRY: Record<ApiSource, ApiSourceMeta> = {
    openai_compatible: {
        label: 'OpenAI 兼容 (通用中转)',
        placeholder: 'https://api.openai.com/v1',
        defaultBaseUrl: '',
        description: '兼容 OneAPI / NewAPI / 各类中转站',
    },
    volcengine: {
        label: '火山引擎方舟 (在线推理)',
        placeholder: 'https://ark.cn-beijing.volces.com/api/v3',
        defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        description: '字节跳动火山引擎在线推理接口 | Model 填 Endpoint ID (ep-xxxx)',
    },
    volcengine_coding: {
        label: '火山引擎方舟 Coding Plan',
        placeholder: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        description: '火山方舟编程套餐 | OpenAI 兼容 | Model 直接填模型名，无需 ep-xxxx',
        hardcodedModels: VOLCENGINE_CODING_MODELS,
    },
    minimax: {
        label: 'MiniMax 官方 (按量付费)',
        placeholder: 'https://api.minimax.chat/v1',
        defaultBaseUrl: 'https://api.minimax.chat/v1',
        description: 'MiniMax 官方 ChatCompletion Pro，按 token 计费',
    },
    minimax_coding: {
        label: 'MiniMax Coding Plan (Anthropic 兼容)',
        // 国内用户固定用 api.minimaxi.com/anthropic
        placeholder: 'https://api.minimaxi.com/anthropic/v1',
        defaultBaseUrl: 'https://api.minimaxi.com/anthropic/v1',
        description: 'MiniMax 编程套餐 | Anthropic 协议 | 支持 M2.1 / M2.1-lightning / M2',
        hardcodedModels: MINIMAX_CODING_MODELS,
    },
    gemini: {
        label: 'Google Gemini 原生',
        placeholder: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        description: 'Google Gemini OpenAI 兼容层 | URL 末尾需含 /openai',
    },
    deepseek: {
        label: 'DeepSeek 官方',
        placeholder: 'https://api.deepseek.com/v1',
        defaultBaseUrl: 'https://api.deepseek.com/v1',
        description: 'DeepSeek 官方 API',
    },
    moonshot: {
        label: 'Moonshot / Kimi 官方',
        placeholder: 'https://api.moonshot.cn/v1',
        defaultBaseUrl: 'https://api.moonshot.cn/v1',
        description: 'Moonshot AI / Kimi 官方接口',
    },
};

function normalizeGeminiBase(rawBase: string): string {
    if (rawBase.endsWith('/openai')) return rawBase;
    const idx = rawBase.indexOf('/openai');
    if (idx !== -1) return rawBase.slice(0, idx + '/openai'.length);
    return `${rawBase}/openai`;
}

function applyVolcengineProxy(baseUrl: string): string {
    if (window.location.hostname !== 'localhost') return baseUrl;
    if (!baseUrl.includes('ark.cn-beijing.volces.com')) return baseUrl;
    const relativePath = baseUrl.replace('https://ark.cn-beijing.volces.com', '');
    return `/api/proxy/volcengine${relativePath}`;
}

function applyMinimaxCodingProxy(baseUrl: string): string {
    if (window.location.hostname !== 'localhost') return baseUrl;
    // baseUrl = https://api.minimaxi.com/anthropic
    // 代理到 /api/proxy/minimax-coding/anthropic
    const relativePath = baseUrl.replace(/^https?:\/\/[^/]+/, '');
    return `/api/proxy/minimax-coding${relativePath}`;
}

export function resolveApiEndpoint(config: APIConfig): ResolvedEndpoint {
    const source: ApiSource = config.apiSource || 'openai_compatible';
    let baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    const apiKey = config.apiKey || '';

    const defaultHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || 'sk-none'}`,
    };

    switch (source) {

        case 'volcengine': {
            const url = applyVolcengineProxy(baseUrl);
            return {
                chatUrl: `${url}/chat/completions`,
                modelsUrl: `${url}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };
        }

        case 'volcengine_coding': {
            const url = applyVolcengineProxy(baseUrl);
            return {
                chatUrl: `${url}/chat/completions`,
                modelsUrl: `${url}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };
        }

        case 'minimax': {
            const minimaxGroupId = (config as any).minimaxGroupId || '';
            const modelsUrl = minimaxGroupId
                ? `${baseUrl}/models?GroupId=${minimaxGroupId}`
                : `${baseUrl}/models`;
            return {
                chatUrl: `${baseUrl}/text/chatcompletion_v2`,
                modelsUrl,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                transformBody: (body: any) => ({
                    ...body,
                    tokens_to_generate: body.max_tokens || 4096,
                    bot_setting: undefined,
                }),
                supportsStreaming: true,
            };
        }

        case 'minimax_coding': {
            // baseUrl 应为 https://api.minimaxi.com/anthropic
            // chatUrl  = https://api.minimaxi.com/anthropic/messages
            const url = applyMinimaxCodingProxy(baseUrl);
            const chatUrl = url.endsWith('/v1')
                ? `${url}/messages`
                : url.endsWith('/anthropic')
                    ? `${url}/v1/messages`
                    : `${url}/messages`;
            return {
                chatUrl: chatUrl,
                modelsUrl: `${url}/v1/models`,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                transformBody: (body: any) => {
                    const { messages, model, max_tokens, stream, temperature, ...rest } = body;
                    // 把 system role 从 messages 数组里分离出来
                    const systemMsg = messages?.find((m: any) => m.role === 'system');
                    const chatMessages = messages?.filter((m: any) => m.role !== 'system') || [];
                    return {
                        model,
                        max_tokens: max_tokens || 4096,
                        stream: stream ?? true,
                        // temperature 范围 (0, 1]，文档建议用 1
                        temperature: Math.min(Math.max(temperature ?? 1, 0.01), 1),
                        ...(systemMsg?.content ? { system: systemMsg.content } : {}),
                        messages: chatMessages,
                        ...rest,
                    };
                },
                supportsStreaming: true,
            };
        }

        case 'gemini': {
            const geminiBase = normalizeGeminiBase(baseUrl);
            return {
                chatUrl: `${geminiBase}/chat/completions`,
                modelsUrl: `${geminiBase}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };
        }

        case 'deepseek':
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };

        case 'moonshot':
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };

        case 'openai_compatible':
        default:
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true,
            };
    }
}

export function getApiSourceLabel(source?: ApiSource): string {
    return API_SOURCE_REGISTRY[source || 'openai_compatible']?.label || 'OpenAI 兼容';
}

export function getHardcodedModels(source?: ApiSource): string[] | null {
    return API_SOURCE_REGISTRY[source || 'openai_compatible']?.hardcodedModels ?? null;
}