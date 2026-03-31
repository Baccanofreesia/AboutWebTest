/**
 * XHS MCP Client — 双模 (MCP + Bridge)
 *
 * - MCP 模式: JSON-RPC Streamable HTTP
 * - Bridge 模式: REST API (/api/...)
 *
 * 自动根据 serverUrl 判断:
 * - 含 /api → Bridge
 * - 其他 → MCP
 */

export interface McpToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

type BackendMode = 'mcp' | 'bridge';

const detectMode = (serverUrl: string): BackendMode => {
    if (serverUrl.includes('/api')) return 'bridge';
    return 'mcp';
};

// ==================== MCP Session State ====================

let requestIdCounter = 0;
let currentSessionId: string | null = null;
let mcpInitialized = false;
let discoveredTools: { name: string; description?: string }[] = [];

// ==================== Tool Name Resolution ====================

const TOOL_NAME_ALIASES: Record<string, string[]> = {
    'check_login': ['check_login', 'checkLogin', 'check_login_status', 'checkLoginStatus'],
    'search': ['search', 'search_notes', 'searchNotes', 'search_feeds', 'searchFeeds'],
    'get_recommend': ['get_recommend', 'getRecommend', 'list_feeds', 'listFeeds', 'get_feed_list', 'getFeedList', 'list_notes', 'listNotes'],
    'get_note_detail': ['get_note_detail', 'getNoteDetail', 'get_feed_detail', 'getFeedDetail'],
    'publish_note': ['publish_note', 'publishNote', 'publish_post', 'publishPost', 'publish_content', 'publishContent'],
    'comment': ['comment', 'post_comment', 'postComment', 'post_comment_to_feed', 'postCommentToFeed'],
    'get_user_info': ['get_user_info', 'getUserInfo', 'get_user_profile', 'getUserProfile', 'user_profile', 'userProfile'],
    'like_feed': ['like_feed', 'likeFeed', 'like_note', 'likeNote'],
    'favorite_feed': ['favorite_feed', 'favoriteFeed', 'favorite_note', 'favoriteNote', 'collect_note', 'collectNote'],
    'reply_comment': ['reply_comment', 'replyComment', 'reply_comment_in_feed', 'replyCommentInFeed'],
};

const resolveToolName = (desiredName: string): string => {
    if (!discoveredTools.length) return desiredName;
    if (discoveredTools.some(t => t.name === desiredName)) return desiredName;

    const aliases = TOOL_NAME_ALIASES[desiredName];
    if (aliases) {
        for (const alias of aliases) {
            if (discoveredTools.some(t => t.name === alias)) return alias;
        }
    }

    const norm = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
    const desired = norm(desiredName);
    const match = discoveredTools.find(t => norm(t.name) === desired);
    if (match) return match.name;

    console.warn(`[MCP] 未找到工具"${desiredName}"的匹配，可用: ${discoveredTools.map(t => t.name).join(', ')}`);
    return desiredName;
};

const extractNoteIdFromUrl = (url: string): string => {
    const match = url.match(/\/explore\/([a-f0-9]+)/i) || url.match(/\/discovery\/item\/([a-f0-9]+)/i) || url.match(/\/([a-f0-9]{24})/);
    return match ? match[1] : url;
};

const extractXsecTokenFromUrl = (url: string): string | undefined => {
    try {
        const u = new URL(url);
        return u.searchParams.get('xsec_token') || undefined;
    } catch {
        return undefined;
    }
};

// ==================== Auto-extract helpers ====================

/**
 * 从 feed/recommend 响应中提取第一个可用的 xsec_token
 * 支持多种嵌套格式: [{ xsec_token }], { data: [{ xsec_token }] }, { items: [...] }, 纯文本等
 */
const extractFirstXsecToken = (data: any): string | undefined => {
    if (!data) return undefined;

    const scanArray = (arr: any[]): string | undefined => {
        for (const item of arr) {
            const token = item?.xsec_token || item?.xsecToken
                || item?.noteCard?.xsec_token || item?.noteCard?.xsecToken;
            if (token) return token;
        }
        return undefined;
    };

    if (Array.isArray(data)) return scanArray(data);

    for (const key of ['items', 'notes', 'feeds', 'data', 'list', 'results', 'note_list', 'noteList']) {
        if (Array.isArray(data[key])) {
            const token = scanArray(data[key]);
            if (token) return token;
        }
    }

    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        for (const key of ['items', 'notes', 'feeds', 'list', 'results', 'note_list', 'noteList']) {
            if (Array.isArray(data.data[key])) {
                const token = scanArray(data.data[key]);
                if (token) return token;
            }
        }
        if (Array.isArray(data.data)) return scanArray(data.data);
    }

    if (typeof data === 'string') {
        const match = data.match(/xsec_token[=:]["']?\s*([A-Za-z0-9+/=]+)/);
        if (match) return match[1];
    }

    return undefined;
};

const adaptParams = (resolvedName: string, args: Record<string, any>): Record<string, any> => {
    const norm = resolvedName.replace(/[_-]/g, '').toLowerCase();
    if (args.url && !args.feed_id) {
        const feedIdTools = ['getfeeddetail', 'getnotedetail', 'postcomment', 'postcommenttofeed', 'replycommentinfeed'];
        if (feedIdTools.some(n => norm === n)) {
            const adapted = { ...args };
            adapted.feed_id = extractNoteIdFromUrl(args.url);
            if (!adapted.xsec_token) {
                const token = extractXsecTokenFromUrl(args.url);
                if (token) adapted.xsec_token = token;
            }
            delete adapted.url;
            return adapted;
        }
    }
    return args;
};

// ==================== MCP JSON-RPC ====================

interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id?: number;
}

interface McpJsonRpcResponse {
    jsonrpc: '2.0';
    id?: number;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

const buildRequest = (method: string, params?: any, isNotification = false): McpJsonRpcRequest => {
    const req: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        method,
        params,
    };
    if (!isNotification) {
        req.id = ++requestIdCounter;
    }
    return req;
};

const parseSseResponse = (text: string): McpJsonRpcResponse | null => {
    const lines = text.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
        if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        else if (line.startsWith('data:')) dataLines.push(line.slice(5));
    }
    if (dataLines.length === 0) return null;
    for (let i = dataLines.length - 1; i >= 0; i--) {
        try { return JSON.parse(dataLines[i]); } catch { /* ignore */ }
    }
    return null;
};

const parseResponse = (text: string, contentType: string): McpJsonRpcResponse => {
    if (contentType.includes('text/event-stream') || text.trimStart().startsWith('event:') || text.trimStart().startsWith('data:')) {
        const parsed = parseSseResponse(text);
        if (parsed) return parsed;
    }
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch { /* fall through */ }
        }
        throw new Error(`MCP: 无法解析响应: ${text.slice(0, 300)}`);
    }
};

const mcpPost = async (
    serverUrl: string,
    body: McpJsonRpcRequest,
    expectResponse = true,
): Promise<{ response: McpJsonRpcResponse | null; sessionId: string | null }> => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };
    if (currentSessionId) headers['Mcp-Session-Id'] = currentSessionId;

    const resp = await fetch(serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');
    if (resp.status === 202) {
        return { response: null, sessionId };
    }
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`MCP HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }
    if (!expectResponse) return { response: null, sessionId };

    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    const parsed = parseResponse(text, contentType);
    return { response: parsed, sessionId };
};

const mcpInitialize = async (serverUrl: string): Promise<void> => {
    const initReq = buildRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'NovaClaw-XHS', version: '1.0.0' },
    });
    const { response, sessionId } = await mcpPost(serverUrl, initReq);
    if (sessionId) currentSessionId = sessionId;
    if (response?.error) throw new Error(`MCP Initialize failed: ${response.error.message}`);
    if (!currentSessionId) {
        console.warn('[MCP] 无法读取 Mcp-Session-Id（CORS 限制）');
        throw new Error(
            'MCP 连接失败: CORS 限制无法读取 Session ID。\n请运行 CORS 代理: node scripts/mcp-proxy.mjs\n然后设置 MCP URL 为 http://localhost:18061/mcp'
        );
    }
    const notifReq = buildRequest('notifications/initialized', {}, true);
    await mcpPost(serverUrl, notifReq, false);

    try {
        const toolsReq = buildRequest('tools/list');
        const { response: toolsResp } = await mcpPost(serverUrl, toolsReq);
        if (toolsResp?.result?.tools) {
            discoveredTools = toolsResp.result.tools.map((t: any) => ({ name: t.name, description: t.description }));
            console.log('[MCP] tools:', discoveredTools.map(t => t.name).join(', '));
        }
    } catch (e) {
        console.warn('[MCP] tools/list 失败，使用默认工具名', e);
    }

    mcpInitialized = true;
};

const mcpCall = async (serverUrl: string, method: string, params?: any): Promise<McpJsonRpcResponse> => {
    if (!mcpInitialized) await mcpInitialize(serverUrl);
    const body = buildRequest(method, params);
    const { response } = await mcpPost(serverUrl, body);
    if (!response) throw new Error('MCP: 未收到响应');
    return response;
};

const mcpCallTool = async (serverUrl: string, toolName: string, args: Record<string, any> = {}): Promise<McpToolResult> => {
    try {
        if (!mcpInitialized) await mcpInitialize(serverUrl);
        const resolved = resolveToolName(toolName);
        const adapted = adaptParams(resolved, args);
        const resp = await mcpCall(serverUrl, 'tools/call', { name: resolved, arguments: adapted });

        if (resp.error) {
            return { success: false, error: `MCP Error [${resp.error.code}]: ${resp.error.message}` };
        }

        const result = resp.result;
        if (result?.content) {
            const textParts = result.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text);
            const fullText = textParts.join('\n');
            if (result.isError) return { success: false, error: fullText || 'MCP 工具执行失败' };
            try {
                const parsed = JSON.parse(fullText);
                return { success: true, data: parsed };
            } catch {
                return { success: true, data: fullText };
            }
        }
        return { success: true, data: result };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

// ==================== Bridge (REST) ====================

const bridgePost = async (serverUrl: string, path: string, body: any = {}): Promise<McpToolResult> => {
    const baseUrl = serverUrl.replace(/\/+$/, '').replace(/\/api$/, '');
    const url = `${baseUrl}/api/${path}`;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const text = await resp.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch { data = text; }

        if (resp.status === 401) {
            return { success: false, error: '未登录，请先在浏览器中登录小红书' };
        }
        if (!resp.ok) {
            const errMsg = typeof data === 'string' ? data : (data?.error || data?.message || JSON.stringify(data));
            return { success: false, error: `Bridge HTTP ${resp.status}: ${errMsg}` };
        }
        if (data && typeof data === 'object') {
            if ('code' in data && data.code !== 0) return { success: false, error: data.message || data.error || 'Bridge Error' };
            if (data.error) return { success: false, error: data.error };
        }
        return { success: true, data: data?.data ?? data };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

// ==================== Public API ====================

export const XhsMcpClient = {

    resetSession: () => {
        currentSessionId = null;
        mcpInitialized = false;
        requestIdCounter = 0;
        discoveredTools = [];
    },

    testConnection: async (serverUrl: string): Promise<{ connected: boolean; tools?: string[]; error?: string; nickname?: string; userId?: string; loggedIn?: boolean; xsecToken?: string }> => {
        const mode = detectMode(serverUrl);
        try {
            if (mode === 'bridge') {
                const ping = await bridgePost(serverUrl, 'check-login');
                if (!ping.success) return { connected: false, error: ping.error };
                const d = ping.data;
                let loggedIn = false;
                let nickname: string | undefined;
                let userId: string | undefined;
                let xsecToken: string | undefined;
                if (typeof d === 'string') {
                    loggedIn = d.includes('已登录');
                    const nameMatch = d.match(/昵称[:：]\s*(.+)/);
                    if (nameMatch) nickname = nameMatch[1].trim();
                    const idMatch = d.match(/(?:user_id|userId|red_id|ID)[:：\s]*(\S+)/i);
                    if (idMatch) userId = idMatch[1].trim();
                } else {
                    loggedIn = !!(d.logged_in || d.loggedIn || d.is_logged_in || d.isLoggedIn);
                    nickname = d.nickname || d.name || d.username || undefined;
                    userId = d.user_id || d.userId || d.id || d.red_id || undefined;
                    xsecToken = d.xsec_token || d.xsecToken || undefined;
                }
                if (loggedIn && !xsecToken) {
                    try {
                        const feedResult = await bridgePost(serverUrl, 'list-feeds');
                        if (feedResult.success) xsecToken = extractFirstXsecToken(feedResult.data) || xsecToken;
                    } catch { /* ignore */ }
                }
                return { connected: true, tools: ['bridge'], nickname, userId, loggedIn, xsecToken };
            }

            XhsMcpClient.resetSession();
            await mcpInitialize(serverUrl);
            const tools = discoveredTools.map(t => t.name);
            let nickname: string | undefined;
            let userId: string | undefined;
            let loggedIn = false;
            let xsecToken: string | undefined;
            try {
                const loginResult = await mcpCallTool(serverUrl, 'check_login');
                if (loginResult.success && loginResult.data) {
                    const d = loginResult.data;
                    if (typeof d === 'string') {
                        loggedIn = d.includes('已登录');
                        const nameMatch = d.match(/昵称[:：]\s*(.+)/);
                        if (nameMatch) nickname = nameMatch[1].trim();
                        const idMatch = d.match(/(?:用户ID|user_id|userId|red_id|ID)[:：\s]*(\S+)/i);
                        if (idMatch) userId = idMatch[1].trim();
                    } else {
                        loggedIn = !!(d.logged_in || d.loggedIn || d.is_logged_in || d.isLoggedIn);
                        nickname = d.nickname || d.name || d.username || undefined;
                        userId = d.user_id || d.userId || d.id || d.red_id || undefined;
                        xsecToken = d.xsec_token || d.xsecToken || undefined;
                    }
                }
            } catch { /* ignore */ }
            if (loggedIn && !xsecToken) {
                try {
                    const feedResult = await mcpCallTool(serverUrl, 'get_recommend');
                    if (feedResult.success) xsecToken = extractFirstXsecToken(feedResult.data) || xsecToken;
                } catch { /* ignore */ }
            }
            return { connected: true, tools, nickname, userId, loggedIn, xsecToken };
        } catch (e: any) {
            return { connected: false, error: e.message };
        }
    },

    ensureInitialized: async (serverUrl: string): Promise<void> => {
        if (detectMode(serverUrl) === 'mcp' && !mcpInitialized) {
            XhsMcpClient.resetSession();
            await mcpInitialize(serverUrl);
        }
    },

    checkLogin: async (serverUrl: string): Promise<McpToolResult> => {
        return detectMode(serverUrl) === 'bridge'
            ? bridgePost(serverUrl, 'check-login')
            : mcpCallTool(serverUrl, 'check_login');
    },

    search: async (serverUrl: string, keyword: string, options?: {
        sort_by?: string; note_type?: string; publish_time?: string; search_scope?: string; location?: string;
    }): Promise<McpToolResult> => {
        return detectMode(serverUrl) === 'bridge'
            ? bridgePost(serverUrl, 'search', { keyword, ...options })
            : mcpCallTool(serverUrl, 'search', { keyword });
    },

    getRecommend: async (serverUrl: string): Promise<McpToolResult> => {
        return detectMode(serverUrl) === 'bridge'
            ? bridgePost(serverUrl, 'list-feeds')
            : mcpCallTool(serverUrl, 'get_recommend');
    },

    getNoteDetail: async (serverUrl: string, noteUrl: string, xsecToken?: string, options?: { loadAllComments?: boolean }): Promise<McpToolResult> => {
        const feedId = extractNoteIdFromUrl(noteUrl);
        const token = xsecToken || extractXsecTokenFromUrl(noteUrl) || '';

        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'get-feed-detail', {
                feed_id: feedId, xsec_token: token,
                ...(options?.loadAllComments ? { load_all_comments: true, click_more_replies: true } : {}),
            });
        }
        const args: Record<string, any> = { url: noteUrl };
        if (token) args.xsec_token = token;
        if (options?.loadAllComments) {
            args.load_all_comments = true;
            args.click_more_replies = true;
        }
        return mcpCallTool(serverUrl, 'get_note_detail', args);
    },

    publishNote: async (serverUrl: string, params: {
        title: string; content: string; images?: string[]; tags?: string[]; is_private?: boolean;
    }): Promise<McpToolResult> => {
        const normalizedImages = (params.images || [])
            .map((img) => String(img || '').trim())
            .filter(Boolean);
        if (detectMode(serverUrl) === 'bridge') {
            if (normalizedImages.length === 0) {
                return { success: false, error: 'Bridge 发布图文至少需要 1 张图片，请先准备素材。' };
            }
            const isPrivate = !!params.is_private;
            return bridgePost(serverUrl, 'publish', {
                title: params.title, content: params.content,
                images: normalizedImages, tags: params.tags || [],
                is_private: isPrivate,
                visibility: isPrivate ? 'private' : undefined,
            });
        }
        const args = { ...params, images: normalizedImages };
        return mcpCallTool(serverUrl, 'publish_note', args);
    },

    publishVideo: async (serverUrl: string, params: {
        title: string; content: string; video: string; tags?: string[];
    }): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'publish-video', {
                title: params.title, content: params.content,
                video: params.video, tags: params.tags || [],
            });
        }
        return { success: false, error: '视频发布仅在 Skills (Bridge) 模式下可用' };
    },

    publishLongArticle: async (serverUrl: string, params: {
        title: string; content: string; images?: string[];
    }): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'long-article', {
                title: params.title, content: params.content, images: params.images || [],
            });
        }
        return { success: false, error: '长文发布仅在 Skills (Bridge) 模式下可用' };
    },

    comment: async (serverUrl: string, noteUrl: string, content: string, xsecToken?: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            const feedId = extractNoteIdFromUrl(noteUrl);
            const token = xsecToken || extractXsecTokenFromUrl(noteUrl) || '';
            return bridgePost(serverUrl, 'post-comment', { feed_id: feedId, xsec_token: token, content });
        }
        const args: Record<string, any> = { url: noteUrl, content };
        if (xsecToken) args.xsec_token = xsecToken;
        return mcpCallTool(serverUrl, 'comment', args);
    },

    likeFeed: async (serverUrl: string, feedId: string, xsecToken: string, unlike = false): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'like-feed', { feed_id: feedId, xsec_token: xsecToken, unlike });
        }
        return mcpCallTool(serverUrl, 'like_feed', { feed_id: feedId, xsec_token: xsecToken, ...(unlike ? { unlike: true } : {}) });
    },

    favoriteFeed: async (serverUrl: string, feedId: string, xsecToken: string, unfavorite = false): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'favorite-feed', { feed_id: feedId, xsec_token: xsecToken, unfavorite });
        }
        return mcpCallTool(serverUrl, 'favorite_feed', { feed_id: feedId, xsec_token: xsecToken, ...(unfavorite ? { unfavorite: true } : {}) });
    },

    replyComment: async (serverUrl: string, feedId: string, xsecToken: string, content: string, commentId?: string, userId?: string, parentCommentId?: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'reply-comment', {
                feed_id: feedId, xsec_token: xsecToken, content,
                comment_id: commentId, user_id: userId, parent_comment_id: parentCommentId,
            });
        }
        const args: Record<string, any> = { feed_id: feedId, xsec_token: xsecToken, content };
        if (commentId) args.comment_id = commentId;
        if (userId) args.user_id = userId;
        if (parentCommentId) args.parent_comment_id = parentCommentId;
        return mcpCallTool(serverUrl, 'reply_comment', args);
    },

    getUserProfile: async (serverUrl: string, userId: string, xsecToken?: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') {
            return bridgePost(serverUrl, 'user-profile', { user_id: userId, xsec_token: xsecToken || '' });
        }
        const args: Record<string, any> = { user_id: userId };
        if (xsecToken) args.xsec_token = xsecToken;
        return mcpCallTool(serverUrl, 'get_user_info', args);
    },

    login: async (serverUrl: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') return bridgePost(serverUrl, 'login');
        return { success: false, error: '登录功能仅在 Skills (Bridge) 模式下可用' };
    },

    getQrcode: async (serverUrl: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') return bridgePost(serverUrl, 'get-qrcode');
        return { success: false, error: '二维码功能仅在 Skills (Bridge) 模式下可用' };
    },

    logout: async (serverUrl: string): Promise<McpToolResult> => {
        if (detectMode(serverUrl) === 'bridge') return bridgePost(serverUrl, 'delete-cookies');
        return { success: false, error: '登出功能仅在 Skills (Bridge) 模式下可用' };
    },
};

// ==================== Helpers ====================

export const extractNotesFromMcpData = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) {
        if (data.length > 0 && Array.isArray(data[0])) {
            console.log(`[XHS] extractNotes: 检测到嵌套数组，展开(${data.length} 组)`);
            return data.flat().filter((n: any) => n && typeof n === 'object' && !Array.isArray(n));
        }
        return data;
    }
    for (const key of ['notes', 'items', 'feeds', 'data', 'list', 'results', 'note_list', 'noteList']) {
        if (Array.isArray(data[key])) {
            const arr = data[key];
            if (arr.length > 0 && Array.isArray(arr[0])) {
                console.log(`[XHS] extractNotes: data.${key} 是嵌套数组，展开`);
                return arr.flat().filter((n: any) => n && typeof n === 'object' && !Array.isArray(n));
            }
            return arr;
        }
    }
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        for (const key of ['notes', 'items', 'feeds', 'list', 'results', 'note_list', 'noteList']) {
            if (Array.isArray(data.data[key])) {
                console.log(`[XHS] extractNotes: 从 data.data.${key} 找到数组, length=${data.data[key].length}`);
                return data.data[key];
            }
        }
    }
    if (typeof data === 'object') {
        const skipKeys = new Set(['interactions', 'tags', 'images', 'comments', 'replies']);
        for (const [key, val] of Object.entries(data)) {
            if (skipKeys.has(key)) continue;
            if (Array.isArray(val) && (val as any[]).length > 0) {
                const first = (val as any[])[0];
                if (first && typeof first === 'object' &&
                    (first.noteId || first.note_id || first.id || first.noteCard ||
                        first.displayTitle || first.title || first.desc || first.cover)) {
                    console.log(`[XHS] extractNotes: 在 key "${key}" 中找到笔记数组 length=${(val as any[]).length}`);
                    return val as any[];
                }
            }
        }
    }
    if (typeof data === 'string') {
        console.warn('[XHS] extractNotes: data 是纯文本，无法提取笔记', data.slice(0, 200));
        return [];
    }
    console.warn('[XHS] extractNotes: 未找到笔记数组 data keys:', Object.keys(data));
    return [];
};

export const normalizeNote = (n: any): { noteId: string; title: string; desc: string; author: string; authorId: string; likes: number; xsecToken?: string; coverUrl?: string; type?: string } => {
    const card = n.noteCard || n.notecard;
    const coverObj = card?.cover || n.cover;
    const rawCoverUrl = typeof coverObj === 'string' ? coverObj
        : coverObj?.urlDefault || coverObj?.url_default || coverObj?.url || coverObj?.urlPre || undefined;
    const coverUrl = rawCoverUrl?.replace(/^http:\/\//, 'https://');
    const likesRaw = n.likes || n.liked_count
        || n.interact_info?.liked_count || n.interactInfo?.likedCount
        || card?.interact_info?.liked_count || card?.interactInfo?.likedCount || 0;
    return {
        noteId: n.noteId || n.note_id || n.id || card?.note_id || card?.noteId || '',
        title: n.title || n.display_title || n.displayTitle || card?.display_title || card?.displayTitle || '',
        desc: (n.desc || n.description || n.content || card?.desc || card?.description || card?.title || '').slice(0, 500),
        author: n.author || n.nickname || n.user?.nickname || n.user?.name || card?.user?.nickname || card?.user?.name || '',
        authorId: n.authorId || n.author_id || n.user?.user_id || n.user?.userId || card?.user?.user_id || card?.user?.userId || '',
        likes: typeof likesRaw === 'string' ? parseInt(likesRaw, 10) || 0 : (likesRaw || 0),
        xsecToken: n.xsecToken || n.xsec_token || card?.xsec_token || card?.xsecToken || undefined,
        coverUrl,
        type: n.type || card?.type || undefined,
    };
};
