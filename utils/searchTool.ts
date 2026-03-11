/**
 * searchTool.ts — NovaClaw 搜索工具模块
 * 
 * 支持 Tavily (推荐) 和 Brave Search 双引擎
 * 供 Chat brainAgent 在对话中调用
 * 
 * 使用方式:
 *   import { SearchTool } from './searchTool';
 *   const results = await SearchTool.search('query', config);
 */

export interface SearchConfig {
    engine: 'tavily' | 'brave';
    apiKey: string;
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced'; // Tavily only
    includeAnswer?: boolean;            // Tavily only: returns AI summary
}

export interface SearchResult {
    title: string;
    url: string;
    content: string;   // snippet / description
    score?: number;     // relevance score (Tavily)
}

export interface SearchResponse {
    answer?: string;        // AI-generated summary (Tavily with includeAnswer)
    results: SearchResult[];
    engine: string;
    query: string;
    timestamp: number;
}

export const SearchTool = {

    /**
     * Unified search interface — automatically routes to the correct engine
     */
    async search(query: string, config: SearchConfig): Promise<SearchResponse> {
        if (!config.apiKey) {
            throw new Error('搜索 API Key 未配置。请在设置 → SecretVault 中添加。');
        }

        if (config.engine === 'tavily') {
            return this.searchTavily(query, config);
        } else if (config.engine === 'brave') {
            return this.searchBrave(query, config);
        }

        throw new Error(`不支持的搜索引擎: ${config.engine}`);
    },

    /**
     * Tavily Search API — AI-native search engine
     * Docs: https://docs.tavily.com/
     */
    async searchTavily(query: string, config: SearchConfig): Promise<SearchResponse> {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: config.apiKey,
                query,
                search_depth: config.searchDepth || 'basic',
                include_answer: config.includeAnswer !== false, // default true
                max_results: config.maxResults || 5,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Tavily API 错误 (${response.status}): ${err}`);
        }

        const data = await response.json();

        return {
            answer: data.answer || undefined,
            results: (data.results || []).map((r: any) => ({
                title: r.title || '',
                url: r.url || '',
                content: r.content || '',
                score: r.score,
            })),
            engine: 'tavily',
            query,
            timestamp: Date.now(),
        };
    },

    /**
     * Brave Search API
     * Docs: https://api.search.brave.com/
     */
    async searchBrave(query: string, config: SearchConfig): Promise<SearchResponse> {
        const count = config.maxResults || 5;
        const response = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': config.apiKey,
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Brave Search API 错误 (${response.status})`);
        }

        const data = await response.json();
        const results = data.web?.results || [];

        return {
            answer: undefined, // Brave doesn't provide AI summary
            results: results.map((r: any) => ({
                title: r.title || '',
                url: r.url || '',
                content: r.description || '',
            })),
            engine: 'brave',
            query,
            timestamp: Date.now(),
        };
    },

    /**
     * Test if search API connection works
     */
    async testConnection(config: SearchConfig): Promise<{ ok: boolean; message: string }> {
        try {
            const result = await this.search('test', { ...config, maxResults: 1 });
            return { ok: true, message: `✅ ${config.engine} 连接成功，返回 ${result.results.length} 条结果` };
        } catch (e: any) {
            return { ok: false, message: `❌ ${config.engine} 连接失败: ${e.message}` };
        }
    },

    /**
     * Format search results for injection into LLM context
     * Used by brainAgent when Agent needs web search capability
     */
    formatForContext(response: SearchResponse): string {
        let text = `[网络搜索结果 - ${response.engine} - "${response.query}"]\n\n`;

        if (response.answer) {
            text += `**AI 摘要**: ${response.answer}\n\n`;
        }

        text += `**搜索结果**:\n`;
        response.results.forEach((r, i) => {
            text += `${i + 1}. **${r.title}**\n`;
            text += `   ${r.url}\n`;
            text += `   ${r.content.slice(0, 200)}\n\n`;
        });

        return text;
    },
};
