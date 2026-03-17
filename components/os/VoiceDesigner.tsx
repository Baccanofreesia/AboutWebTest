import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { fetchMiniMaxVoices, MiniMaxVoiceItem, synthesizeSpeech } from '../../utils/ttsService';

const DEFAULT_MODEL = 'speech-02-hd';
const PREVIEW_TEXT = '你好呀，这是捏出来的新声音，听听看喜不喜欢？';
const SOUND_EFFECTS_OPTIONS = [
    { value: '', label: '无音效' },
    { value: 'spacious_echo', label: '空旷回声' },
    { value: 'auditorium_echo', label: '礼堂回声' },
    { value: 'lofi_telephone', label: 'LoFi 电话' },
];

interface TimberWeight {
    id: string;
    voice_id: string;
    voice_name: string;
    weight: number;
}

const Slider: React.FC<{
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; unit?: string; showValue?: boolean;
}> = ({ label, value, min, max, step, onChange, unit = '', showValue = true }) => (
    <div className="space-y-1">
        <div className="flex justify-between items-center break-keep">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">{label}</span>
            {showValue && <span className="text-[11px] font-mono text-slate-600 whitespace-nowrap">{value}{unit}</span>}
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer" />
    </div>
);

export const VoiceDesigner: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { apiConfig, addToast, agent, updateAgent } = useOS();

    // ── Fish Speech vs MiniMax ──
    const isFishSpeech = apiConfig.ttsProvider === 'fish_speech';
    const isMinimax = apiConfig.ttsProvider === 'minimax';

    // ── Setup State from Agent Profile ──
    const [timberWeights, setTimberWeights] = useState<TimberWeight[]>(() => {
        const saved = agent?.voiceProfile?.timberWeights;
        if (saved && saved.length > 0) {
            return saved.map((tw, i) => ({ id: `init-${i}`, voice_id: tw.voice_id, voice_name: '', weight: tw.weight }));
        }
        const existingVoiceId = agent?.voiceProfile?.voiceId;
        if (existingVoiceId) {
            return [{ id: 'init-0', voice_id: existingVoiceId, voice_name: '', weight: 1 }];
        }
        return [];
    });

    const [modifyPitch, setModifyPitch] = useState(agent?.voiceProfile?.voiceModify?.pitch ?? 0);
    const [modifyIntensity, setModifyIntensity] = useState(agent?.voiceProfile?.voiceModify?.intensity ?? 0);
    const [modifyTimbre, setModifyTimbre] = useState(agent?.voiceProfile?.voiceModify?.timbre ?? 0);
    const [soundEffect, setSoundEffect] = useState(agent?.voiceProfile?.voiceModify?.sound_effects ?? '');

    const [speed, setSpeed] = useState(agent?.voiceProfile?.speed ?? 1);
    const [volume, setVolume] = useState(agent?.voiceProfile?.vol ?? 1);
    const [pitch, setPitch] = useState(agent?.voiceProfile?.pitch ?? 0);
    const [emotion, setEmotion] = useState(agent?.voiceProfile?.emotion ?? '');
    const [model, setModel] = useState(agent?.voiceProfile?.model || DEFAULT_MODEL);

    // ── Preview ──
    const [previewText, setPreviewText] = useState(PREVIEW_TEXT);
    const [isGenerating, setIsGenerating] = useState(false);
    const [audioUrl, setAudioUrl] = useState('');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // ── Voice List (MiniMax) ──
    const [availableVoices, setAvailableVoices] = useState<MiniMaxVoiceItem[]>([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [showVoicePicker, setShowVoicePicker] = useState(false);
    const [pickingForIndex, setPickingForIndex] = useState(-1);
    const [voiceSearch, setVoiceSearch] = useState('');

    useEffect(() => {
        return () => {
            if (audioUrl) URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);

    // ── Minimax voices ──
    const handleLoadVoices = async () => {
        if (!isMinimax) return;
        setIsLoadingVoices(true);
        try {
            const result = await fetchMiniMaxVoices(apiConfig, 'all');
            const allVoices = [...result.system_voice, ...result.voice_cloning, ...result.voice_generation];
            setAvailableVoices(allVoices);
            addToast(`已加载 ${allVoices.length} 个音色`, 'success');
        } catch (err: any) {
            addToast(err?.message || '加载音色失败', 'error');
        } finally {
            setIsLoadingVoices(false);
        }
    };

    // ── Helpers ──
    const addTimberSlot = () => setTimberWeights(prev => [...prev, { id: `tw-${Date.now()}`, voice_id: '', voice_name: '', weight: 1 }]);
    const removeTimberSlot = (index: number) => setTimberWeights(prev => prev.filter((_, i) => i !== index));
    const updateTimberWeight = (index: number, weight: number) => setTimberWeights(prev => prev.map((tw, i) => i === index ? { ...tw, weight } : tw));
    const updateTimberVoiceId = (index: number, voice_id: string, voice_name: string = '') => setTimberWeights(prev => prev.map((tw, i) => i === index ? { ...tw, voice_id, voice_name } : tw));

    const handleApply = () => {
        if (!agent) return addToast('没有 Agent 数据', 'error');
        if (apiConfig.ttsProvider === 'none') return addToast('TTS 未配置', 'error');

        const validTimbers = timberWeights.filter(tw => tw.voice_id.trim());
        if (validTimbers.length === 0) return addToast('请至少输入一个音色 ID', 'error');

        const hasModify = modifyPitch !== 0 || modifyIntensity !== 0 || modifyTimbre !== 0 || soundEffect;

        const updatedVoiceProfile = {
            voiceId: validTimbers.length === 1 ? validTimbers[0].voice_id.trim() : '',
            model: model || DEFAULT_MODEL,
            timberWeights: validTimbers.length > 1 ? validTimbers.map(tw => ({ voice_id: tw.voice_id.trim(), weight: tw.weight })) : undefined,
            voiceModify: hasModify ? {
                ...(modifyPitch !== 0 ? { pitch: modifyPitch } : {}),
                ...(modifyIntensity !== 0 ? { intensity: modifyIntensity } : {}),
                ...(modifyTimbre !== 0 ? { timbre: modifyTimbre } : {}),
                ...(soundEffect ? { sound_effects: soundEffect } : {}),
            } : undefined,
            emotion: emotion || undefined,
            speed: speed !== 1 ? speed : undefined,
            vol: volume !== 1 ? volume : undefined,
            pitch: pitch !== 0 ? pitch : undefined,
        };

        updateAgent({ voiceProfile: updatedVoiceProfile });
        addToast('Agent 语音形象已保存', 'success');
        onClose();
    };

    const handlePreview = async () => {
        const text = previewText.trim();
        if (!text) return addToast('请输入试听文本', 'error');
        const validTimbers = timberWeights.filter(tw => tw.voice_id.trim());
        if (validTimbers.length === 0) return addToast('请设置声音', 'error');

        setIsGenerating(true);
        try {
            // Build temporary profile for synthesis exactly as apply would
            const hasModify = modifyPitch !== 0 || modifyIntensity !== 0 || modifyTimbre !== 0 || soundEffect;
            const tempProfile = {
                ...agent!,
                voiceProfile: {
                    voiceId: validTimbers.length === 1 ? validTimbers[0].voice_id.trim() : '',
                    model: model || DEFAULT_MODEL,
                    timberWeights: validTimbers.length > 1 ? validTimbers.map(tw => ({ voice_id: tw.voice_id.trim(), weight: tw.weight })) : undefined,
                    voiceModify: hasModify ? { pitch: modifyPitch, intensity: modifyIntensity, timbre: modifyTimbre, sound_effects: soundEffect } : undefined,
                    emotion, speed, vol: volume, pitch
                }
            };

            const blob = await synthesizeSpeech(text, tempProfile, apiConfig);
            if (audioUrl) URL.revokeObjectURL(audioUrl);
            const newUrl = URL.createObjectURL(blob);
            setAudioUrl(newUrl);
            setTimeout(() => { audioRef.current?.play().catch(() => { }); }, 50);
        } catch (err: any) {
            addToast(err?.message || '合成失败', 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const filteredVoices = useMemo(() => {
        if (!voiceSearch.trim()) return availableVoices.slice(0, 100);
        const q = voiceSearch.toLowerCase();
        return availableVoices.filter(v => (v.voice_id || '').toLowerCase().includes(q) || (v.voice_name || '').toLowerCase().includes(q)).slice(0, 100);
    }, [availableVoices, voiceSearch]);

    if (!isFishSpeech && !isMinimax) {
        return (
            <div className="absolute inset-x-0 bottom-0 top-[20%] bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col z-50 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-bold text-slate-800">语音形象设置</h2>
                    <button onClick={onClose} className="px-4 py-2 bg-slate-200 rounded-full text-xs font-bold text-slate-600">关闭</button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm">
                    未配置受支持的 TTS 服务 (请在设置中选择 MiniMax 或 Fish Speech)
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-x-0 bottom-0 top-[10%] bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col z-50 overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="px-5 py-4 bg-white/80 backdrop-blur border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-base font-bold text-slate-800">为「{agent?.name}」设计声音</h2>
                    <p className="text-[10px] text-slate-500">{isMinimax ? 'MiniMax 引擎 - 支持参数和混合' : 'Fish Speech 引擎 - 直接引用声音'}</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleApply} className="text-xs px-4 py-2 bg-primary text-white font-bold rounded-xl active:scale-95 transition-transform">
                        保存
                    </button>
                    <button onClick={onClose} className="text-xs px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl">取消</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* ── Fish Speech Simplified UI ── */}
                {isFishSpeech && (
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                        <label className="text-xs font-bold text-slate-700 block mb-2">Reference ID (声音引用)</label>
                        <input
                            value={timberWeights[0]?.voice_id || ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setTimberWeights([{ id: 'init-0', voice_id: val, voice_name: '', weight: 1 }]);
                            }}
                            className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-primary transition-all"
                            placeholder="输入 Fish Speech 配置的声音 ID"
                        />
                        <p className="text-[10px] text-slate-400 mt-2">Fish Speech 一般只需要指定声音的 Reference ID。</p>
                    </div>
                )}

                {/* ── MiniMax Advanced UI ── */}
                {isMinimax && (
                    <>
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-700">声线构成</span>
                                <div className="flex gap-2">
                                    {availableVoices.length === 0 && (
                                        <button onClick={handleLoadVoices} disabled={isLoadingVoices}
                                            className="text-[10px] px-2 py-1 rounded bg-indigo-50 text-indigo-600 font-bold hover:bg-indigo-100 disabled:opacity-50">
                                            {isLoadingVoices ? '获取云端库...' : '浏览云端音色'}
                                        </button>
                                    )}
                                    <button onClick={addTimberSlot} className="text-[10px] px-3 py-1 rounded bg-emerald-50 text-emerald-600 font-bold hover:bg-emerald-100">
                                        + 混合声线
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3 pt-2">
                                {timberWeights.map((tw, index) => (
                                    <div key={tw.id} className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2 relative">
                                        {timberWeights.length > 1 && (
                                            <button onClick={() => removeTimberSlot(index)} className="absolute top-2 right-2 text-slate-300 hover:text-red-400">
                                                ✕
                                            </button>
                                        )}
                                        <div className="flex items-center gap-2 pr-6">
                                            <input
                                                value={tw.voice_id}
                                                onChange={e => updateTimberVoiceId(index, e.target.value)}
                                                className="flex-1 bg-white rounded-lg px-3 py-1.5 text-xs border border-slate-200 focus:border-indigo-300"
                                                placeholder="输入 voice_id"
                                            />
                                            {availableVoices.length > 0 && (
                                                <button onClick={() => { setPickingForIndex(index); setShowVoicePicker(true); }}
                                                    className="px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold">选</button>
                                            )}
                                        </div>
                                        {timberWeights.length > 1 && (
                                            <div className="pt-2">
                                                <Slider label="混合权重" value={tw.weight} min={1} max={100} step={1} onChange={v => updateTimberWeight(index, v)} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
                                <span className="text-xs font-bold text-slate-700">发音参数</span>
                                <div className="space-y-4 pt-1">
                                    <Slider label="语速" value={speed} min={0.5} max={2} step={0.1} onChange={setSpeed} unit="x" />
                                    <Slider label="音量" value={volume} min={0} max={2} step={0.1} onChange={setVolume} />
                                    <Slider label="音调" value={pitch} min={-12} max={12} step={1} onChange={setPitch} />
                                </div>
                            </div>
                            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
                                <span className="text-xs font-bold text-slate-700">音色微调</span>
                                <div className="space-y-4 pt-1">
                                    <Slider label="音高调整（低沉/明亮）" value={modifyPitch} min={-100} max={100} step={1} onChange={setModifyPitch} />
                                    <Slider label="强度调整（力量感/柔和）" value={modifyIntensity} min={-100} max={100} step={1} onChange={setModifyIntensity} />
                                    <Slider label="音色调整（磁性/清脆）" value={modifyTimbre} min={-100} max={100} step={1} onChange={setModifyTimbre} />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                            <span className="text-xs font-bold text-slate-700">TTS 模型 (引擎)</span>
                            <div className="flex flex-wrap gap-2 pt-1">
                                {['speech-01-turbo', 'speech-02-hd', 'speech-02-standard', 'speech-02-standard-240522'].map(m => (
                                    <button key={m} onClick={() => setModel(m)}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${model === m ? 'bg-primary border-primary text-white' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-white'}`}>
                                        {m}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[9px] text-slate-400 mt-1">
                                {model === 'speech-02-hd' ? 'HD 模型: 音质上限最高，适合细腻情感' : 
                                 model === 'speech-01-turbo' ? 'Turbo 模型: 响应速度极快，适合日常对话' : 
                                 '标准模型: 均衡的选择'}
                            </p>
                        </div>

                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                            <div className="flex gap-4">
                                <div className="flex-1 space-y-1">
                                    <span className="text-xs font-bold text-slate-700">情感倾向</span>
                                    <select value={emotion} onChange={e => setEmotion(e.target.value)}
                                        className="w-full bg-slate-50 px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-primary">
                                        {['', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].map(em => (
                                            <option key={em} value={em}>{em === '' ? '自动' : em}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <span className="text-xs font-bold text-slate-700">空间音效</span>
                                    <select value={soundEffect} onChange={e => setSoundEffect(e.target.value)}
                                        className="w-full bg-slate-50 px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-primary">
                                        {SOUND_EFFECTS_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Preview Box ── */}
                <div className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100">
                    <textarea
                        value={previewText}
                        onChange={e => setPreviewText(e.target.value)}
                        className="w-full bg-white rounded-xl p-3 text-xs border border-indigo-100 resize-none h-16 focus:ring-2 focus:ring-indigo-200"
                    />
                    <div className="flex items-center gap-3 mt-3">
                        <button onClick={handlePreview} disabled={isGenerating}
                            className="flex-1 py-2.5 bg-indigo-500 text-white rounded-xl text-xs font-bold active:scale-95 transition-transform disabled:opacity-50">
                            {isGenerating ? '正在合成...' : '播放试听'}
                        </button>
                        {audioUrl && (
                            <audio ref={audioRef} controls src={audioUrl} className="h-9 w-32 outline-none" />
                        )}
                    </div>
                </div>

                {/* Bottom space */}
                <div className="h-6" />
            </div>

            {/* Voice Picker Overlay (MiniMax) */}
            {showVoicePicker && (
                <div className="absolute inset-x-0 bottom-0 top-[20%] bg-white rounded-t-3xl shadow-2xl flex flex-col z-50">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <span className="text-sm font-bold text-slate-800">音色库 ({filteredVoices.length})</span>
                        <button onClick={() => setShowVoicePicker(false)} className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full">关闭</button>
                    </div>
                    <div className="p-3 shrink-0">
                        <input value={voiceSearch} onChange={e => setVoiceSearch(e.target.value)}
                            placeholder="搜索音色 ID 或中文名..." className="w-full bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 text-xs" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {filteredVoices.map(v => (
                            <button key={v.voice_id}
                                onClick={() => {
                                    updateTimberVoiceId(pickingForIndex, v.voice_id, v.voice_name || '');
                                    setShowVoicePicker(false);
                                }}
                                className="w-full text-left p-3 hover:bg-indigo-50 rounded-xl transition-colors border-b border-slate-50 last:border-0 flex items-center justify-between">
                                <span className="font-bold text-sm text-slate-700 truncate min-w-0 mr-2">{v.voice_name || '未命名'}</span>
                                <span className="text-[10px] text-slate-400 font-mono truncate shrink-0 max-w-[150px]">{v.voice_id}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
