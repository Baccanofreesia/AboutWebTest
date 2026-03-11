
import React from 'react';
import { useOS } from '../context/OSContext';

/**
 * XhsFreeRoamApp — Placeholder for Single-Agent Migration
 * 
 * Original from SULLYTEST2: Agent autonomously browses XHS (小红书),
 * posts, comments, searches, saves topics — driven by MCP Server.
 * 
 * Migration Status: 🔄 Pending adaptation
 * - Need to add XhsActivityRecord type to types.ts
 * - Need to add ConfirmDialog component
 * - Need to add xhsFreeRoam engine
 * - Need to adapt from multi-agent (characters[]) to single-agent pattern
 * - XHS MCP integration is already set up in Settings+OSContext
 */
const XhsFreeRoamApp: React.FC = () => {
    const { closeApp, agent, realtimeConfig, addToast } = useOS();

    const mcpEnabled = realtimeConfig?.xhsMcpConfig?.enabled || false;

    return (
        <div className="h-full w-full bg-gradient-to-br from-rose-50 via-pink-50 to-red-50 flex flex-col">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">自由活动</h1>
                    <span className="text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-bold ml-auto">迁移中</span>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-24 h-24 bg-white/80 rounded-3xl shadow-lg flex items-center justify-center">
                    <span className="text-5xl">📕</span>
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-lg font-bold text-slate-700">自由活动</h2>
                    <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                        让 {agent?.name || 'Agent'} 自主浏览小红书，<br />
                        发帖、评论、搜索、收藏话题。
                    </p>
                </div>

                <div className="w-full max-w-xs space-y-3">
                    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🔮</span>
                            <span className="text-xs font-bold text-rose-700">功能列表</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-1.5 pl-6 list-disc">
                            <li>AI 自主决策浏览/发帖/搜索/评论</li>
                            <li>基于 MCP 协议的小红书交互</li>
                            <li>实时思考过程可视化</li>
                            <li>活动历史记录 & 详情查看</li>
                            <li>角色人设驱动的行为风格</li>
                        </ul>
                    </div>

                    {/* MCP Status */}
                    <div className={`rounded-2xl p-3 text-center ${mcpEnabled ? 'bg-emerald-50/80' : 'bg-red-50/80'}`}>
                        <p className={`text-[11px] font-medium ${mcpEnabled ? 'text-emerald-600' : 'text-red-600'}`}>
                            {mcpEnabled ? '✅ 小红书 MCP 已启用' : '❌ 小红书 MCP 未启用'}
                        </p>
                        {!mcpEnabled && (
                            <p className="text-[10px] text-red-400 mt-1">
                                请前往 设置 → 实时感知 → 小红书 MCP 开启
                            </p>
                        )}
                    </div>

                    <div className="bg-amber-50/80 rounded-2xl p-3 text-center">
                        <p className="text-[11px] text-amber-600 font-medium">
                            ⚠️ 正在从 SULLYTEST2 迁移至 NovaClaw 单Agent架构
                        </p>
                        <p className="text-[10px] text-amber-500 mt-1">
                            原版代码已保留，待适配完成后自动启用
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default XhsFreeRoamApp;
