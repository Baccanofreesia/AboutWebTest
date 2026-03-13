import type { APIConfig, ApiSource } from '../types';

/**
 * Resolved API endpoint configuration for a given source.
 */
export interface ResolvedEndpoint {
    chatUrl: string;
    modelsUrl: string;
    headers: Record<string, string>;
    /** Optional request body transformer for non-OpenAI-compatible formats */
    transformBody?: (body: any) => any;
    /** Whether this source supports streaming */
    supportsStreaming: boolean;
}

/**
 * Source metadata for UI display and auto-fill.
 */
export interface ApiSourceMeta {
    label: string;
    placeholder: string;      // URL placeholder hint
    defaultBaseUrl: string;    // Official endpoint base
    description: string;
}

/**
 * Registry of all supported API sources with their metadata.
 */
export const API_SOURCE_REGISTRY: Record<ApiSource, ApiSourceMeta> = {
    openai_compatible: {
        label: 'OpenAI 兼容 (通用中转)',
        placeholder: 'https://api.openai.com/v1',
        defaultBaseUrl: '',
        description: '兼容 OneAPI / NewAPI / 各类中转站'
    },
    volcengine: {
        label: '火山引擎方舟 (ARK)',
        placeholder: 'https://ark.cn-beijing.volces.com/api/v3',
        defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        description: '字节跳动火山引擎官方接口'
    },
    minimax: {
        label: 'MiniMax 官方',
        placeholder: 'https://api.minimax.chat/v1',
        defaultBaseUrl: 'https://api.minimax.chat/v1',
        description: 'MiniMax 官方 ChatCompletion Pro'
    },
    gemini: {
        label: 'Google Gemini 原生',
        placeholder: 'https://generativelanguage.googleapis.com/v1beta',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        description: 'Google Gemini API (支持 OpenAI 兼容层)'
    },
    deepseek: {
        label: 'DeepSeek 官方',
        placeholder: 'https://api.deepseek.com/v1',
        defaultBaseUrl: 'https://api.deepseek.com/v1',
        description: 'DeepSeek 官方 API'
    },
    moonshot: {
        label: 'Moonshot / Kimi 官方',
        placeholder: 'https://api.moonshot.cn/v1',
        defaultBaseUrl: 'https://api.moonshot.cn/v1',
        description: 'Moonshot AI / Kimi 官方接口'
    }
};

/**
 * Resolves the API endpoint, headers, and optional body transformer
 * based on the user's selected API source.
 */
export function resolveApiEndpoint(config: APIConfig): ResolvedEndpoint {
    const source: ApiSource = config.apiSource || 'openai_compatible';
    let baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    const apiKey = config.apiKey || '';

    // Dev proxy for Volcengine on localhost
    if (window.location.hostname === 'localhost' && baseUrl.includes('ark.cn-beijing.volces.com')) {
        const relativePath = baseUrl.replace('https://ark.cn-beijing.volces.com', '');
        baseUrl = `/api/proxy/volcengine${relativePath}`;
    }

    const defaultHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || 'sk-none'}`
    };

    switch (source) {
        case 'volcengine':
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true
            };

        case 'minimax':
            return {
                chatUrl: `${baseUrl}/text/chatcompletion_v2`,
                modelsUrl: `${baseUrl}/models`,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                transformBody: (body: any) => {
                    // MiniMax uses 'model' at top level and 'messages' like OpenAI
                    // but may require additional fields
                    return {
                        ...body,
                        tokens_to_generate: body.max_tokens || 4096,
                        bot_setting: undefined // clear if present
                    };
                },
                supportsStreaming: true
            };

        case 'gemini': {
            // Gemini supports OpenAI-compatible layer at /openai/ path
            const isOpenAIPath = baseUrl.includes('/openai');
            const chatPath = isOpenAIPath ? '/chat/completions' : '/openai/chat/completions';
            const modelsPath = isOpenAIPath ? '/models' : '/openai/models';
            return {
                chatUrl: `${baseUrl}${chatPath}`,
                modelsUrl: `${baseUrl}${modelsPath}`,
                headers: defaultHeaders,
                supportsStreaming: true
            };
        }

        case 'deepseek':
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true
            };

        case 'moonshot':
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true
            };

        case 'openai_compatible':
        default:
            return {
                chatUrl: `${baseUrl}/chat/completions`,
                modelsUrl: `${baseUrl}/models`,
                headers: defaultHeaders,
                supportsStreaming: true
            };
    }
}

/**
 * Get the source label for display purposes.
 */
export function getApiSourceLabel(source?: ApiSource): string {
    return API_SOURCE_REGISTRY[source || 'openai_compatible']?.label || 'OpenAI 兼容';
}
