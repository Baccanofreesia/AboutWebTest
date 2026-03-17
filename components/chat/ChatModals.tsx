import React, { useRef, useState } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile, Message } from '../../types';

interface ChatModalsProps {
    modalType: string;
    setModalType: (v: any) => void;
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    emojiImportText: string;
    setEmojiImportText: (v: string) => void;
    settingsContextLimit: number;
    setSettingsContextLimit: (v: number) => void;
    settingsHideSysLogs: boolean;
    setSettingsHideSysLogs: (v: boolean) => void;
    settingsCallInitiative: number;
    setSettingsCallInitiative: (v: number) => void;
    preserveContext: boolean;
    setPreserveContext: (v: boolean) => void;
    editContent: string;
    setEditContent: (v: string) => void;
    selectedMessage: Message | null;
    selectedEmoji: { name: string; url: string } | null;
    activeCharacter: CharacterProfile;
    allHistoryMessages?: Message[];
    chatVoiceEnabled?: boolean;
    onToggleChatVoice?: () => void;
    chatVoiceLang?: string;
    onSetChatVoiceLang?: (lang: string) => void;
    translationEnabled: boolean;
    onToggleTranslation: () => void;
    translateSourceLang: string;
    translateTargetLang: string;
    onSetTranslateSourceLang: (lang: string) => void;
    onSetTranslateLang: (lang: string) => void;
    onTransfer: () => void;
    onImportEmoji: () => void;
    onSaveSettings: () => void;
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
    onClearHistory: () => void;
    onSetHistoryStart: (id: number | undefined) => void;
    onEnterSelectionMode: () => void;
    onReplyMessage: () => void;
    onEditMessageStart: () => void;
    onConfirmEditMessage: () => void;
    onDeleteMessage: () => void;
    onCopyMessage: () => void;
    onDeleteEmoji: () => void;
    onFavoriteSticker?: () => void;
    chatWaitTime: number;
    onSetChatWaitTime: (v: number) => void;
    replySplitInterval?: number;
    onSetReplySplitInterval?: (v: number) => void;
}

const ChatModals: React.FC<ChatModalsProps> = ({
    modalType, setModalType,
    transferAmt, setTransferAmt,
    emojiImportText, setEmojiImportText,
    settingsContextLimit, setSettingsContextLimit,
    settingsHideSysLogs, setSettingsHideSysLogs,
    settingsCallInitiative, setSettingsCallInitiative,
    preserveContext, setPreserveContext,
    editContent, setEditContent,
    selectedMessage, selectedEmoji, activeCharacter, allHistoryMessages = [],
    chatVoiceEnabled, onToggleChatVoice, chatVoiceLang, onSetChatVoiceLang,
    translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang, onSetTranslateSourceLang, onSetTranslateLang,
    onTransfer, onImportEmoji, onSaveSettings, onBgUpload, onRemoveBg, onClearHistory,
    onSetHistoryStart, onEnterSelectionMode, onReplyMessage, onEditMessageStart, onConfirmEditMessage, onDeleteMessage, onCopyMessage, onDeleteEmoji, onFavoriteSticker,
    chatWaitTime, onSetChatWaitTime, replySplitInterval, onSetReplySplitInterval
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [historyPage, setHistoryPage] = useState(0);
    const HISTORY_PAGE_SIZE = 50;
<<<<<<< Updated upstream
    const {
        isEnabled, setIsEnabled,
        isConnected, isConnecting, error,
        serverAddress, setServerAddress,
        connect, disconnect, scan, stopAll,
        devices, settings: toySettings,
        updateControlSettings,
        proposeState, respondToPropose,
        startSession, endSession
    } = useIntiface();
=======
>>>>>>> Stashed changes

    return (
        <>
            <Modal
                isOpen={modalType === 'transfer'} title="Credits 转账" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onTransfer} className="flex-1 py-3 bg-orange-500 text-white rounded-2xl">确认</button></>}
            ><input type="number" value={transferAmt} onChange={e => setTransferAmt(e.target.value)} className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-lg font-bold" autoFocus /></Modal>

            <Modal
                isOpen={modalType === 'emoji-import'} title="表情注入" onClose={() => setModalType('none')}
                footer={<button onClick={onImportEmoji} className="w-full py-4 bg-primary text-white font-bold rounded-2xl">注入</button>}
            ><textarea value={emojiImportText} onChange={e => setEmojiImportText(e.target.value)} placeholder="Name--URL" className="w-full h-40 bg-slate-100 rounded-2xl p-4 resize-none" /></Modal>

            <Modal
                isOpen={modalType === 'chat-settings'} title="聊天设置" onClose={() => setModalType('none')}
                footer={<button onClick={onSaveSettings} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">聊天背景</label>
                        <div onClick={() => bgInputRef.current?.click()} className="h-24 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden relative">
                            {activeCharacter.chatBackground ? <img src={activeCharacter.chatBackground} className="w-full h-full object-cover opacity-60" /> : <span className="text-xs text-slate-400">点击上传图片</span>}
                            {activeCharacter.chatBackground && <span className="absolute z-10 text-xs bg-white/80 px-2 py-1 rounded">更换</span>}
                        </div>
                        <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                        {activeCharacter.chatBackground && <button onClick={onRemoveBg} className="text-[10px] text-red-400 mt-1">移除背景</button>}
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">上下文条数 ({settingsContextLimit})</label>
                        <input type="range" min="20" max="5000" step="10" value={settingsContextLimit} onChange={e => setSettingsContextLimit(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (超长记忆)</span></div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">消息合并等待 ({(chatWaitTime / 1000).toFixed(1)}s)</label>
                        <input type="range" min="500" max="10000" step="500" value={chatWaitTime} onChange={e => onSetChatWaitTime(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>0.5s (即时)</span><span>10s (深度思考)</span></div>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">连续发送消息包的时间窗。检测到“视频/图片”时会自动额外增加 1.5s。</p>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Agent 主动来电倾向 ({Math.round(settingsCallInitiative * 100)}%)</label>
                        <input type="range" min="0" max="100" step="1" value={Math.round(settingsCallInitiative * 100)} onChange={e => setSettingsCallInitiative(parseInt(e.target.value) / 100)} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>0% (极保守)</span><span>100% (很主动)</span></div>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">仅影响对话内主动来电的触发倾向与冷却时长。</p>
                    </div>
                    {onSetReplySplitInterval && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">回复拆分间隔 ({replySplitInterval ? `${(replySplitInterval / 1000).toFixed(1)}s` : '自动'})</label>
                            <input type="range" min="0" max="5000" step="500" value={replySplitInterval || 0} onChange={e => onSetReplySplitInterval(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>自动 (根据长度)</span><span>5s (固定间隔)</span></div>
                            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">AI 发送多条消息气泡之间的停顿时间。设为 0 表示自动计算模拟打字速度。</p>
                        </div>
                    )}
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex justify-between items-center cursor-pointer" onClick={() => setSettingsHideSysLogs(!settingsHideSysLogs)}>
                            <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">隐藏系统日志</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${settingsHideSysLogs ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settingsHideSysLogs ? 'translate-x-4' : ''}`}></div>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">开启后，隐藏系统消息记录。</p>
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex justify-between items-center cursor-pointer" onClick={onToggleChatVoice}>
                            <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">语音消息</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${chatVoiceEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${chatVoiceEnabled ? 'translate-x-4' : ''}`}></div>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">开启后，AI 回复可能会以语音形式发送（需配置 API）。</p>
                        {chatVoiceEnabled && (
                            <div className="mt-3">
                                <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">语音语种</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {[{v:'',l:'默认'},{v:'en',l:'English'},{v:'ja',l:'日本語'},{v:'ko',l:'한국어'},{v:'fr',l:'Français'},{v:'es',l:'Español'}].map(opt => (
                                        <button key={opt.v} onClick={() => onSetChatVoiceLang?.(opt.v)}
                                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${chatVoiceLang === opt.v ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>
                                            {opt.l}
                                        </button>
                                    ))}
                                </div>
                                {chatVoiceLang && <p className="text-[10px] text-primary/70 mt-1.5">选择非默认语种时，AI 台词会先翻译再生成语音。</p>}
                            </div>
                        )}
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex justify-between items-center cursor-pointer" onClick={onToggleTranslation}>
                            <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">消息翻译</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${translationEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${translationEnabled ? 'translate-x-4' : ''}`}></div>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。
                         </p>
                        {translationEnabled && (
                            <div className="mt-3 space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">选（气泡显示语言）</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                            <button key={`src-${lang}`} onClick={() => onSetTranslateSourceLang(lang)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateSourceLang === lang ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{lang}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">译（翻译目标语言）</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                            <button key={`tgt-${lang}`} onClick={() => onSetTranslateLang(lang)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateTargetLang === lang ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>{lang}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                        <button onClick={() => setModalType('history-manager')} className="w-full py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                            管理上下文 / 隐藏历史
                        </button>
                        <p className="text-[10px] text-slate-400 mt-2 text-center">可选择从某条消息开始显示，隐藏之前的记录（不被 AI 读取）。</p>
                    </div>
                    <div className="pt-2 border-t border-slate-100">
<<<<<<< Updated upstream
                        <label className="text-xs font-bold text-slate-400 uppercase mb-3 block">玩具控制 (Intiface)</label>

                        <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsEnabled(!isEnabled)}>
                            <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">启用设备连接</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${isEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isEnabled ? 'translate-x-4' : ''}`}></div>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">开启后可连接 Intiface Central (Buttplug)。</p>

                        {isEnabled && (
                            <div className="mt-3 space-y-3">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">服务器地址 (WebSocket)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={serverAddress}
                                            onChange={(e) => setServerAddress(e.target.value)}
                                            disabled={isConnected}
                                            className="flex-1 bg-slate-100 rounded-xl px-3 py-2 text-xs font-mono text-slate-700 border border-slate-200"
                                            placeholder="ws://127.0.0.1:12345"
                                        />
                                        <button
                                            onClick={() => (isConnected ? disconnect() : connect(serverAddress))}
                                            disabled={isConnecting}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold ${isConnected ? 'bg-red-500 text-white' : 'bg-primary text-white'} ${isConnecting ? 'opacity-60' : ''}`}
                                        >
                                            {isConnecting ? '连接中' : isConnected ? '断开' : '连接'}
                                        </button>
                                    </div>
                                    {error && <div className="text-[10px] text-red-500">{error}</div>}
                                </div>

                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>设备数：{devices.length}</span>
                                    <div className="flex gap-2">
                                        <button onClick={scan} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">扫描</button>
                                        <button onClick={stopAll} className="px-2 py-1 rounded-lg bg-yellow-100 text-yellow-700">停止所有</button>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center cursor-pointer" onClick={() => updateControlSettings({ enabled: !toySettings.enabled })}>
                                    <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">允许 AI 控制</label>
                                    <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${toySettings.enabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${toySettings.enabled ? 'translate-x-4' : ''}`}></div>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400">该开关是最终授权（用户一票否决）。</p>

                                <div className="flex justify-between items-center cursor-pointer" onClick={() => updateControlSettings({ userVetoEnabled: !toySettings.userVetoEnabled })}>
                                    <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">用户一票否决</label>
                                    <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${toySettings.userVetoEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${toySettings.userVetoEnabled ? 'translate-x-4' : ''}`}></div>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center cursor-pointer" onClick={() => updateControlSettings({ agentProactiveEnabled: !toySettings.agentProactiveEnabled })}>
                                    <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">允许 Agent 主动提议</label>
                                    <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${toySettings.agentProactiveEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${toySettings.agentProactiveEnabled ? 'translate-x-4' : ''}`}></div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">控制模式</label>
                                    <select
                                        value={toySettings.mode}
                                        onChange={(e) => updateControlSettings({ mode: e.target.value as any })}
                                        className="w-full bg-slate-100 rounded-xl px-3 py-2 text-xs text-slate-700 border border-slate-200"
                                    >
                                        <option value="manual">手动（需明确指令）</option>
                                        <option value="mixed">混合（建议+确认）</option>
                                        <option value="auto">自动（可自主决定）</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">强度上限 ({toySettings.maxIntensity}%)</label>
                                    <input
                                        type="range"
                                        min="10"
                                        max="100"
                                        step="5"
                                        value={toySettings.maxIntensity}
                                        onChange={(e) => updateControlSettings({ maxIntensity: parseInt(e.target.value) })}
                                        className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => updateControlSettings({ allowGradient: !toySettings.allowGradient })}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold ${toySettings.allowGradient ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500'}`}
                                    >
                                        允许渐变
                                    </button>
                                    <button
                                        onClick={() => updateControlSettings({ allowPattern: !toySettings.allowPattern })}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold ${toySettings.allowPattern ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500'}`}
                                    >
                                        允许模式
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">安全词</label>
                                    <input
                                        type="text"
                                        value={toySettings.safeWord || ''}
                                        onChange={(e) => updateControlSettings({ safeWord: e.target.value.trim() })}
                                        className="w-full bg-slate-100 rounded-xl px-3 py-2 text-xs text-slate-700 border border-slate-200"
                                        placeholder="停止"
                                    />
                                </div>

                                {proposeState.isProposing && (
                                    <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 border border-slate-200 space-y-2">
                                        <div className="font-bold text-slate-700">控制提议中</div>
                                        <div>类型：{proposeState.proposeType === 'agent_initiated' ? 'Agent 主动' : '用户提出'}</div>
                                        <div className="flex gap-2">
                                            <button onClick={() => respondToPropose(true)} className="flex-1 py-2 rounded-lg bg-primary text-white font-bold">同意</button>
                                            <button onClick={() => respondToPropose(false)} className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 font-bold">拒绝</button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button onClick={startSession} className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">开始会话</button>
                                    <button onClick={endSession} className="flex-1 py-2 rounded-xl bg-red-50 text-red-500 text-xs font-bold">结束会话</button>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="pt-2 border-t border-slate-100">
=======
>>>>>>> Stashed changes
                        <label className="text-xs font-bold text-red-400 uppercase mb-3 block">危险区域 (Danger Zone)</label>
                        <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                {preserveContext && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                            </div>
                            <span className="text-sm text-slate-600">清空时保留最后10条记录 (维持语境)</span>
                        </div>
                        <button onClick={onClearHistory} className="w-full py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2">执行清空</button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'history-manager'} title="历史记录断点" onClose={() => { setModalType('none'); setHistoryPage(0); }}
                footer={<><button onClick={() => onSetHistoryStart(undefined)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">恢复全部</button><button onClick={() => { setModalType('none'); setHistoryPage(0); }} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">完成</button></>}
            >
                <div className="space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar p-1">
                    <p className="text-xs text-slate-400 text-center mb-2">点击某条消息，将其设为新的起点。此条之前的消息将被隐藏且不发送给 AI。</p>
                    {(() => {
                        const reversed = allHistoryMessages.slice().reverse();
                        const totalPages = Math.max(1, Math.ceil(reversed.length / HISTORY_PAGE_SIZE));
                        const pageMessages = reversed.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
                        return (
                            <>
                                {reversed.length > HISTORY_PAGE_SIZE && (
                                    <div className="flex items-center justify-between px-1 py-1">
                                        <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0} className={`px-3 py-1 text-xs rounded-lg ${historyPage === 0 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>上一页</button>
                                        <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}（共 {reversed.length} 条）</span>
                                        <button onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={historyPage >= totalPages - 1} className={`px-3 py-1 text-xs rounded-lg ${historyPage >= totalPages - 1 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>下一页</button>
                                    </div>
                                )}
                                {pageMessages.map(m => (
                                    <div key={m.id} onClick={() => onSetHistoryStart(m.id)} className={`p-3 rounded-xl border cursor-pointer text-xs flex gap-2 items-start ${activeCharacter.hideBeforeMessageId === m.id ? 'bg-primary/10 border-primary ring-1 ring-primary' : 'bg-white border-slate-100 hover:bg-slate-50'}`}>
                                        <span className="text-slate-400 font-mono whitespace-nowrap pt-0.5">[{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-600 mb-0.5">{m.role === 'user' ? '我' : activeCharacter.name}</div>
                                            <div className="text-slate-500 truncate">{m.content}</div>
                                        </div>
                                        {activeCharacter.hideBeforeMessageId === m.id && <span className="text-primary font-bold text-[10px] bg-white px-2 rounded-full border border-primary/20">起点</span>}
                                    </div>
                                ))}
                            </>
                        );
                    })()}
                </div>
            </Modal>

            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={onEnterSelectionMode} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">多选 / 批量删除</button>
                    <button onClick={onReplyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">引用 / 回复</button>
                    {selectedMessage?.type === 'text' && <button onClick={onEditMessageStart} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">编辑内容</button>}
                    {selectedMessage?.type === 'text' && <button onClick={onCopyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">复制文字</button>}
                    {selectedMessage?.type === 'emoji' && onFavoriteSticker && (
                        <button onClick={onFavoriteSticker} className="w-full py-3 bg-primary/10 text-primary font-bold rounded-2xl active:bg-primary/20 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                            </svg>
                            收藏表情
                        </button>
                    )}
                    <button onClick={onDeleteMessage} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">删除消息</button>
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'delete-emoji'} title="删除表情包" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onDeleteEmoji} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">删除</button></>}
            >
                <div className="flex flex-col items-center gap-4 py-2">
                    {selectedEmoji && <img src={selectedEmoji.url} className="w-24 h-24 object-contain rounded-xl border" />}
                    <p className="text-center text-sm text-slate-500">确定要删除这个表情包吗？</p>
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'edit-message'} title="编辑内容" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onConfirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed" />
            </Modal>
        </>
    );
};

export default ChatModals;
