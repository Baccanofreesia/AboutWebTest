import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { EventBus } from '../../utils/eventBus';

const DailyWhisper = () => {
  const { addToast, askAgent, theme, activeApp } = useOS();
  const [loading, setLoading] = useState(false);
  const [whisper, setWhisper] = useState('在这个喧嚣的世界里，让我为你留出一片安静的角落。\n点击下方按钮，听听我想对你说什么...');
  const [isAnimating, setIsAnimating] = useState(false);

  const getNewWhisper = async () => {
    setLoading(true);
    setIsAnimating(false);

    try {
      // ✅ 核心魔法：使用 App 内部的 SDK 直接召唤智能体，而不是去聊天框发消息！
      const response = await askAgent("请结合当前时间，用极其温柔、细腻的语气，对我说一句走心的情话或充满力量的寄语。最多两三句话，不要任何开头问候语，直接输出正文，格式优美一点。");

      setWhisper(response);
      setIsAnimating(true);
      // ✅ 感知层：上报行为到总线，让 Agent 在对话中能感知到这次互动
      EventBus.emit('DailyWhisper', '获取私语', response.slice(0, 20) + '...');
    } catch (error) {
      addToast('哎呀，感应断开了...', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 relative overflow-hidden">

      {/* 装饰性光晕背景 */}
      <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob"></div>
      <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-64 h-64 bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob animation-delay-4000"></div>

      <div className="text-5xl mb-6 drop-shadow-lg z-10 animate-bounce cursor-pointer hover:scale-110 transition-transform">
        ✨
      </div>

      <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-8 z-10 drop-shadow-sm">
        Daily Whisper
      </h2>

      {/* 动态内容卡片 */}
      <div className={`relative z-10 w-full max-w-sm bg-white/60 backdrop-blur-2xl border border-white/80 p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-10 transition-all duration-700 ease-out ${isAnimating ? 'translate-y-0 opacity-100' : 'translate-y-2'}`}>
        <p className="text-slate-700 leading-relaxed text-center font-medium text-[15px] whitespace-pre-wrap">
          {loading ? (
            <span className="flex items-center justify-center gap-2 text-indigo-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              正在聆听心声...
            </span>
          ) : whisper}
        </p>
      </div>

      <button
        onClick={getNewWhisper}
        disabled={loading}
        className="z-10 relative overflow-hidden group bg-slate-900 text-white px-8 py-4 rounded-full font-bold tracking-widest text-sm shadow-xl hover:shadow-indigo-500/25 active:scale-95 transition-all duration-300 w-full max-w-xs"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        <span className="relative z-10 flex items-center justify-center gap-2">
          {loading ? '呼唤中...' : '接收今日悄悄话'}
        </span>
      </button>

      <p className="mt-8 text-[11px] text-slate-400 tracking-widest uppercase font-semibold z-10">
        POWERED BY NOVA IN-APP SDK
      </p>
    </div>
  );
};

export default DailyWhisper;