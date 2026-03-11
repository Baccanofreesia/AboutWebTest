
import React from 'react';
import { useOS } from '../context/OSContext';

/**
 * MusicApp — 未来功能: 一起听歌
 * 
 * 规划方案:
 * A. 内嵌播放器 (Web Audio API + 本地/网络音频)
 * B. AI 歌单推荐 (Agent 分享音乐品味)
 * C. 同步听歌 (播放状态同步 + 实时评论)
 * D. 音乐 MCP Skill (接入 Spotify/QQ音乐 API)
 * 
 * 建议路线: 先 A+B, 后 D
 */
const MusicApp: React.FC = () => {
    const { closeApp, agent } = useOS();

    return (
        <div className="h-full w-full bg-gradient-to-br from-indigo-50 via-purple-50 to-fuchsia-50 flex flex-col">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">音乐</h1>
                    <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-bold ml-auto">未来功能</span>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-28 h-28 bg-white/80 rounded-3xl shadow-lg flex items-center justify-center relative">
                    <span className="text-5xl">🎵</span>
                    <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-indigo-400 rounded-full flex items-center justify-center shadow-md">
                        <span className="text-white text-sm">♪</span>
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-lg font-bold text-slate-700">一起听歌</h2>
                    <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                        和 {agent?.name || 'Agent'} 一起分享音乐，<br />
                        聊聊最近喜欢的歌曲。
                    </p>
                </div>

                <div className="w-full max-w-xs space-y-3">
                    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🎧</span>
                            <span className="text-xs font-bold text-indigo-700">规划功能</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-1.5 pl-6 list-disc">
                            <li>内嵌音乐播放器</li>
                            <li>Agent AI 歌单推荐</li>
                            <li>同步听歌 & 实时评论</li>
                            <li>QQ音乐 / Spotify MCP Skill</li>
                        </ul>
                    </div>

                    {/* Fake Player UI Preview */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-xl flex items-center justify-center text-white text-xl shadow-md">♫</div>
                            <div className="flex-1">
                                <p className="text-xs font-bold text-slate-700">等待开发...</p>
                                <p className="text-[10px] text-slate-400">NovaClaw Music</p>
                            </div>
                            <div className="flex gap-2 text-slate-300">
                                <span className="text-lg">⏮</span>
                                <span className="text-lg">▶️</span>
                                <span className="text-lg">⏭</span>
                            </div>
                        </div>
                        <div className="mt-3 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full w-1/3 bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MusicApp;
