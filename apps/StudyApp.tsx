
import React from 'react';
import { useOS } from '../context/OSContext';

/**
 * StudyApp — Placeholder for Single-Agent Migration
 * 
 * Original from SULLYTEST2: Full PDF study room with AI tutoring, 
 * KaTeX math rendering, markdown blackboard, Q&A, chapter management.
 * 
 * Migration Status: 🔄 Pending adaptation
 * - Need to add StudyCourse/StudyChapter types to types.ts
 * - Need to adapt from multi-agent (characters[]) to single-agent pattern
 * - PDF processing, KaTeX rendering logic is preserved in SULLYTEST2/apps/StudyApp.tsx
 */
const StudyApp: React.FC = () => {
    const { closeApp, agent, addToast } = useOS();

    return (
        <div className="h-full w-full bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex flex-col">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">自习室</h1>
                    <span className="text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-bold ml-auto">迁移中</span>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-24 h-24 bg-white/80 rounded-3xl shadow-lg flex items-center justify-center">
                    <span className="text-5xl">📚</span>
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-lg font-bold text-slate-700">自习室</h2>
                    <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                        上传 PDF 教材，{agent?.name || 'Agent'} 会化身私教，<br />
                        用角色扮演的方式为你讲解每一章节。
                    </p>
                </div>

                <div className="w-full max-w-xs space-y-3">
                    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">📖</span>
                            <span className="text-xs font-bold text-emerald-700">功能列表</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-1.5 pl-6 list-disc">
                            <li>PDF 文本提取 & AI 课程大纲生成</li>
                            <li>逐章教学（带角色扮演风格）</li>
                            <li>KaTeX 数学公式渲染</li>
                            <li>课堂问答 & 进度追踪</li>
                            <li>教学记忆保存</li>
                        </ul>
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

export default StudyApp;
