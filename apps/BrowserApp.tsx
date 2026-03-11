
import React from 'react';
import { useOS } from '../context/OSContext';

/**
 * BrowserApp — 未来功能: AI 搜索/浏览
 * 
 * 规划:
 * - v1.0: 搜索能力集成到 Chat (Tavily/Brave Search API)
 * - v1.5: 独立浏览器 App + FetchURL 网页抓取
 * - v2.0: browser-use (headless browser, Agent 驱动浏览)
 * - v3.0: 悬浮球协作 (L3 Plan B)
 * 
 * 当前搜索功能已通过 searchTool.ts 预留接口
 */
const BrowserApp: React.FC = () => {
    const { closeApp, agent } = useOS();

    return (
        <div className="h-full w-full bg-gradient-to-br from-blue-50 via-cyan-50 to-sky-50 flex flex-col">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">浏览器</h1>
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold ml-auto">未来功能</span>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-28 h-28 bg-white/80 rounded-3xl shadow-lg flex items-center justify-center">
                    <span className="text-5xl">🌐</span>
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-lg font-bold text-slate-700">AI 浏览器</h2>
                    <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                        让 {agent?.name || 'Agent'} 帮你搜索和浏览网页，<br />
                        获取真实的网络信息。
                    </p>
                </div>

                <div className="w-full max-w-xs space-y-3">
                    {/* Fake Search Bar */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-3 flex items-center gap-2">
                        <span className="text-slate-300">🔍</span>
                        <span className="text-sm text-slate-300 flex-1">搜索或输入网址...</span>
                    </div>

                    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🔮</span>
                            <span className="text-xs font-bold text-blue-700">三级搜索方案</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-1.5 pl-6 list-disc">
                            <li><b>L1 API 搜索</b> — Tavily/Brave 真实搜索 (v1.0 ✅ 已预留)</li>
                            <li><b>L1.5 FetchURL</b> — 网页正文抓取 + 转 Markdown</li>
                            <li><b>L2 browser-use</b> — Agent 驱动 Headless 浏览器</li>
                            <li><b>L3 悬浮球</b> — 用户浏览时 Agent 协助分析</li>
                        </ul>
                    </div>

                    <div className="bg-emerald-50/80 rounded-2xl p-3 text-center">
                        <p className="text-[11px] text-emerald-600 font-medium">
                            💬 当前搜索功能已集成至聊天
                        </p>
                        <p className="text-[10px] text-emerald-500 mt-1">
                            在聊天中向 {agent?.name || 'Agent'} 提问，即可触发网络搜索
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BrowserApp;
