import React, { useState, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { MemoryFragment, UserImpression, AgentProfile } from '../types';
import { DB } from '../utils/db';
import { fsBridge } from '../utils/fsBridge';
import Modal from '../components/os/Modal';

// --- Reusable Components Extracted from Character.tsx ---

const TagGroup: React.FC<{ title: string; tags: string[]; color: string; onRemove?: (t: string) => void }> = ({ title, tags, color, onRemove }) => (
    <div className="mb-4">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${color}`}></span> {title}
        </h4>
        <div className="flex flex-wrap gap-2">
            {tags.length > 0 ? tags.map((t, i) => (
                <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white border border-slate-100 text-xs text-slate-600 shadow-sm">
                    {t}
                    {onRemove && <button onClick={() => onRemove(t)} className="ml-1.5 text-slate-300 hover:text-red-400">×</button>}
                </span>
            )) : <span className="text-xs text-slate-300 italic">暂无数据</span>}
        </div>
    </div>
);

const AnalysisBlock: React.FC<{ title: string; content: string; icon: React.ReactNode }> = ({ title, content, icon }) => (
    <div className="bg-white/60 p-4 rounded-2xl border border-white/60 shadow-sm relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500 text-slate-800">
            {icon}
        </div>
        <h4 className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-2 relative z-10">
            {title}
        </h4>
        <p className="text-sm text-slate-700 leading-relaxed text-justify relative z-10 whitespace-pre-wrap">
            {content || "需要更多数据进行分析..."}
        </p>
    </div>
);

// --- Impression Panel ---

interface ImpressionPanelProps {
    impression: UserImpression | undefined;
    isGenerating: boolean;
    onGenerate: (type: 'initial' | 'update') => void;
    onUpdateImpression: (newImp: UserImpression) => void;
}

const ImpressionPanel: React.FC<ImpressionPanelProps> = ({ impression, isGenerating, onGenerate, onUpdateImpression }) => {
    const removeTag = (path: string[], tag: string) => {
        if (!impression) return;
        const newImp = JSON.parse(JSON.stringify(impression));
        let target = newImp;
        for (let i = 0; i < path.length - 1; i++) {
            target = target[path[i]];
        }
        const lastKey = path[path.length - 1];
        if (Array.isArray(target[lastKey])) {
            target[lastKey] = target[lastKey].filter((t: string) => t !== tag);
            onUpdateImpression(newImp);
        }
    };

    if (!impression && !isGenerating) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-6">
                <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-200">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12"><path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59" /></svg>
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-700">尚未生成印象档案</h3>
                    <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto">让 AI 遍历过往的记忆和对话，生成关于你的四维画像。</p>
                </div>
                <button onClick={() => onGenerate('initial')} className="px-8 py-3 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all">开始深度分析</button>
            </div>
        );
    }

    if (isGenerating) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
                <div className="relative w-20 h-20"><div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div><div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
                <p className="text-sm text-slate-500 font-medium animate-pulse">正在回顾你们的共同回忆...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Version {impression?.version.toFixed(1)}</div>
                    <div className="text-xs text-slate-600">上次更新: {new Date(impression?.lastUpdated || Date.now()).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => onGenerate('initial')} className="px-3 py-1.5 text-xs font-bold text-slate-400 bg-slate-50 rounded-lg hover:bg-slate-100">重置</button>
                    <button onClick={() => onGenerate('update')} className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-500 rounded-lg shadow-md shadow-indigo-200 hover:bg-indigo-600 active:scale-95 transition-all">追加/更新</button>
                </div>
            </div>

            <div className="relative bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-6 text-white shadow-lg overflow-hidden">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-3">核心印象 (Core Summary)</h3>
                <p className="text-lg font-light leading-relaxed italic opacity-95">"{impression?.personality_core.summary}"</p>
                <div className="mt-6 pt-4 border-t border-white/20 grid grid-cols-2 gap-4">
                    <div><div className="text-[10px] text-white/60 uppercase mb-1">互动模式</div><div className="text-sm font-medium">{impression?.personality_core.interaction_style}</div></div>
                    <div><div className="text-[10px] text-white/60 uppercase mb-1">语气感知</div><div className="text-sm font-medium">{impression?.behavior_profile.tone_style}</div></div>
                </div>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <h3 className="text-sm font-bold text-slate-700 mb-6 flex items-center gap-2">价值地图 (Value Map)</h3>
                <TagGroup title="观察到的特质 (Traits)" tags={impression?.personality_core.observed_traits || []} color="bg-blue-400" onRemove={(t) => removeTag(['personality_core', 'observed_traits'], t)} />
                <TagGroup title="TA 喜欢的 (Likes)" tags={impression?.value_map.likes || []} color="bg-pink-400" onRemove={(t) => removeTag(['value_map', 'likes'], t)} />
                <TagGroup title="TA 讨厌的 (Dislikes)" tags={impression?.value_map.dislikes || []} color="bg-slate-400" onRemove={(t) => removeTag(['value_map', 'dislikes'], t)} />
                <div className="mt-4 p-4 bg-slate-50 rounded-xl"><div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">核心价值观推测</div><p className="text-sm text-slate-600">{impression?.value_map.core_values}</p></div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                <AnalysisBlock title="情绪状态总结 (Emotion)" content={impression?.behavior_profile.emotion_summary || ''} icon={<svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>} />
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="grid grid-cols-2 gap-6">
                        <div><div className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-2">✅ 正向触发器</div><ul className="list-disc list-inside text-xs text-slate-600 space-y-1">{impression?.emotion_schema.triggers.positive.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
                        <div><div className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">❌ 压力/雷区</div><ul className="list-disc list-inside text-xs text-slate-600 space-y-1">{impression?.emotion_schema.triggers.negative.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
                    </div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm"><div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">舒适区 (Comfort Zone)</div><p className="text-sm text-slate-600">{impression?.emotion_schema.comfort_zone}</p></div>
            </div>

            {impression?.observed_changes && impression.observed_changes.length > 0 && (
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                    <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">最近观察到的变化</h4>
                    <ul className="space-y-2">{impression.observed_changes.map((c, i) => <li key={i} className="text-xs text-amber-900 flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span><span className="opacity-90">{c}</span></li>)}</ul>
                </div>
            )}
        </div>
    );
};

// --- Memory Archivist ---

interface MemoryArchivistProps {
    memories: MemoryFragment[];
    refinedMemories: Record<string, string>;
    activeMemoryMonths: string[];
    onRefine: (year: string, month: string, summary: string) => Promise<void>;
    onDeleteMemories: (ids: string[]) => void;
    onUpdateMemory: (id: string, newSummary: string) => void;
    onToggleActiveMonth: (year: string, month: string) => void;
}

const MemoryArchivist: React.FC<MemoryArchivistProps> = ({ memories, refinedMemories, activeMemoryMonths, onRefine, onDeleteMemories, onUpdateMemory, onToggleActiveMonth }) => {
    const [viewState, setViewState] = useState<{ level: 'root' | 'year' | 'month', selectedYear: string | null, selectedMonth: string | null }>({ level: 'root', selectedYear: null, selectedMonth: null });
    const [isRefining, setIsRefining] = useState(false);
    const [isManageMode, setIsManageMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [editMemory, setEditMemory] = useState<MemoryFragment | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const { tree, stats } = useMemo(() => {
        const tree: Record<string, Record<string, MemoryFragment[]>> = {};
        let totalChars = 0;
        const safeMemories = Array.isArray(memories) ? memories : [];
        safeMemories.forEach(m => {
            totalChars += m.summary.length;
            let year = '未知年份', month = '未知';
            const dateMatch = m.date.match(/(\d{4})[-/年](\d{1,2})/);
            if (dateMatch) { year = dateMatch[1]; month = dateMatch[2].padStart(2, '0'); } else if (m.date.includes('unknown')) year = '未归档';
            if (!tree[year]) tree[year] = {};
            if (!tree[year][month]) tree[year][month] = [];
            tree[year][month].push(m);
        });
        const sortedTree: typeof tree = {};
        Object.keys(tree).sort((a, b) => b.localeCompare(a)).forEach(y => {
            sortedTree[y] = {};
            Object.keys(tree[y]).sort((a, b) => b.localeCompare(a)).forEach(m => {
                sortedTree[y][m] = tree[y][m].sort((ma, mb) => mb.date.localeCompare(ma.date));
            });
        });
        return { tree: sortedTree, stats: { totalChars, count: safeMemories.length } };
    }, [memories]);

    const handleBack = () => {
        if (viewState.level === 'month') setViewState(prev => ({ ...prev, level: 'year', selectedMonth: null }));
        else if (viewState.level === 'year') setViewState({ level: 'root', selectedYear: null, selectedMonth: null });
    };

    const requestDelete = () => { if (selectedIds.size > 0) setShowDeleteConfirm(true); };
    const performDelete = () => { onDeleteMemories(Array.from(selectedIds)); setSelectedIds(new Set()); setIsManageMode(false); setShowDeleteConfirm(false); };

    if (!memories || memories.length === 0) return <div className="flex flex-col items-center justify-center h-48 text-slate-400"><p className="text-xs">暂无记忆档案</p></div>;

    const renderYears = () => (
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
            {Object.keys(tree).map(year => (
                <div key={year} onClick={() => setViewState({ level: 'year', selectedYear: year, selectedMonth: null })} className="bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-white/50 shadow-sm active:scale-95 transition-all flex flex-col justify-between h-28 group cursor-pointer hover:bg-white/80">
                    <div className="flex justify-between items-start">
                        <div className="p-2 bg-amber-100/50 rounded-lg text-amber-600"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg></div>
                        <span className="text-[10px] bg-slate-100 px-2 py-1 rounded-full text-slate-500 font-mono">{Object.values(tree[year]).reduce((acc, curr: any) => acc + curr.length, 0)}项</span>
                    </div>
                    <div><h3 className="text-xl font-light text-slate-800 tracking-tight">{year}</h3><p className="text-[10px] text-slate-400">年度档案归档</p></div>
                </div>
            ))}
        </div>
    );

    const renderMonths = () => viewState.selectedYear && tree[viewState.selectedYear] && (
        <div className="grid grid-cols-3 gap-3 animate-fade-in">
            {Object.keys(tree[viewState.selectedYear]).map(month => {
                const monthKey = `${viewState.selectedYear}-${month}`;
                const isActive = activeMemoryMonths.includes(monthKey);
                return (
                    <div key={month} className="relative group">
                        <div onClick={() => setViewState(prev => ({ ...prev, level: 'month', selectedMonth: month }))} className="bg-white/50 backdrop-blur-sm p-3 rounded-2xl border border-white/40 shadow-sm active:scale-95 transition-all flex flex-col justify-center items-center gap-2 aspect-square cursor-pointer hover:bg-white/70 relative overflow-hidden">
                            {refinedMemories?.[monthKey] && <div className="absolute top-0 right-0 w-3 h-3 bg-indigo-500 rounded-bl-lg shadow-sm"></div>}
                            <span className="text-2xl font-light text-slate-700">{parseInt(month)}<span className="text-xs ml-0.5 text-slate-400">月</span></span>
                            <div className="h-0.5 w-4 border-b border-primary/30 rounded-full"></div>
                            <span className="text-[10px] text-slate-400">{tree[viewState.selectedYear!][month].length} 条记忆</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onToggleActiveMonth(viewState.selectedYear!, month); }} className={`absolute -top-2 -right-2 p-1.5 rounded-full shadow-md z-10 transition-colors ${isActive ? 'bg-primary text-white' : 'bg-white text-slate-300 border border-slate-100'}`}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clipRule="evenodd" /></svg>
                        </button>
                    </div>
                );
            })}
        </div>
    );

    const renderMemories = () => {
        if (!viewState.selectedYear || !viewState.selectedMonth) return null;
        const key = `${viewState.selectedYear}-${viewState.selectedMonth}`;
        const refinedContent = refinedMemories?.[key];
        const rawMemories = tree[viewState.selectedYear]?.[viewState.selectedMonth] || [];
        const isActive = activeMemoryMonths.includes(key);
        const groupedByDay: Record<string, MemoryFragment[]> = {};
        rawMemories.forEach(m => { if (!groupedByDay[m.date]) groupedByDay[m.date] = []; groupedByDay[m.date].push(m); });

        return (
            <div className="space-y-6 animate-fade-in pb-8">
                <div className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100 relative group">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-indigo-700"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .914-.143Z" clipRule="evenodd" /></svg><h4 className="text-xs font-bold tracking-wide uppercase">核心记忆 (AI Context)</h4></div>
                        <div className="flex gap-2">
                            <button onClick={() => onToggleActiveMonth(viewState.selectedYear!, viewState.selectedMonth!)} className={`text-[10px] px-3 py-1 rounded-full border shadow-sm transition-colors flex items-center gap-1 ${isActive ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200'}`}>{isActive ? '详细回忆已激活 (Active)' : '仅使用核心记忆 (Default)'}</button>
                            <button onClick={async () => {
                                setIsRefining(true);
                                const combinedText = rawMemories.map(m => `${m.date}: ${m.summary} (${m.mood || '无'})`).join('\n');
                                await onRefine(viewState.selectedYear!, viewState.selectedMonth!, combinedText);
                                setIsRefining(false);
                            }} disabled={isRefining} className="text-[10px] bg-white text-indigo-600 px-3 py-1 rounded-full border border-indigo-200 shadow-sm hover:bg-indigo-500 hover:text-white transition-colors flex items-center gap-1">{isRefining ? '...' : (refinedContent ? '重新精炼' : '生成')}</button>
                        </div>
                    </div>
                    {refinedContent ? <p className="text-xs text-indigo-900/80 leading-relaxed whitespace-pre-wrap">{refinedContent}</p> : <p className="text-xs text-indigo-300 italic">点击右上角生成本月记忆摘要。</p>}
                </div>

                <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Time Logs</h4>
                    <div className="flex gap-2">
                        {isManageMode && selectedIds.size > 0 && <button onClick={requestDelete} className="text-[10px] bg-red-500 text-white px-3 py-1 rounded-full font-bold shadow-sm active:scale-95 transition-transform">删除 ({selectedIds.size})</button>}
                        <button onClick={() => { setIsManageMode(!isManageMode); setSelectedIds(new Set()); }} className={`text-[10px] px-3 py-1 rounded-full border transition-colors ${isManageMode ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>{isManageMode ? '完成' : '管理'}</button>
                    </div>
                </div>

                <div className="mt-2 pl-2">
                    {Object.entries(groupedByDay).map(([date, dayMemories]) => (
                        <div key={date} className="relative pl-8 pb-8 last:pb-0 border-l-[2px] border-slate-100 last:border-l-0">
                            <div className="absolute left-[-7px] top-0 w-3.5 h-3.5 bg-slate-300 rounded-full border-4 border-slate-50 z-10"></div>
                            <div className="mb-3 -mt-1.5 flex items-center gap-2"><span className="text-xs font-bold text-slate-500 font-mono tracking-tight">{date}</span>{dayMemories.length > 1 && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 rounded-md text-slate-400 font-normal">{dayMemories.length} 记录</span>}</div>
                            <div className="space-y-3">
                                {dayMemories.map((mem) => (
                                    <div key={mem.id} className={`relative group transition-all duration-300 ${isManageMode ? 'cursor-pointer' : ''}`} onClick={() => { if (isManageMode) setSelectedIds(prev => { const n = new Set(prev); if (n.has(mem.id)) n.delete(mem.id); else n.add(mem.id); return n; }); else setEditMemory(mem); }}>
                                        {isManageMode && <div className={`absolute -left-[38px] top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors z-20 ${selectedIds.has(mem.id) ? 'bg-primary border-primary' : 'bg-white border-slate-300'}`}>{selectedIds.has(mem.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}</div>}
                                        <div className={`bg-white p-4 rounded-xl rounded-tl-none border border-slate-100 shadow-sm transition-all ${isManageMode && selectedIds.has(mem.id) ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
                                            {mem.mood && <div className="mb-1"><span className="text-[10px] px-1.5 py-0.5 bg-primary/5 text-primary rounded-md font-medium">#{mem.mood}</span></div>}
                                            <p className="text-sm text-slate-700 leading-relaxed text-justify whitespace-pre-wrap">{mem.summary}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full relative">
            <div className="flex justify-between items-center mb-6 px-1">
                <div className="flex gap-4">
                    <div><span className="block text-[10px] text-slate-400 uppercase tracking-widest">总字数</span><span className="text-lg font-medium text-slate-700 font-mono">{stats.totalChars.toLocaleString()}</span></div>
                    <div><span className="block text-[10px] text-slate-400 uppercase tracking-widest">总条目</span><span className="text-lg font-medium text-slate-700 font-mono">{stats.count}</span></div>
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-white/50 px-3 py-1.5 rounded-full border border-white/50 shadow-sm">
                    {viewState.level === 'root' ? <span>档案室</span> : (
                        <>
                            <button onClick={() => setViewState({ level: 'root', selectedYear: null, selectedMonth: null })} className="hover:text-primary">档案</button><span className="text-slate-300">/</span>
                            {viewState.level === 'year' ? <span className="text-slate-800">{viewState.selectedYear}</span> : (<><button onClick={() => setViewState(prev => ({ ...prev, level: 'year', selectedMonth: null }))} className="hover:text-primary">{viewState.selectedYear}</button><span className="text-slate-300">/</span><span className="text-slate-800">{parseInt(viewState.selectedMonth!)}月</span></>)}
                        </>
                    )}
                </div>
            </div>
            {viewState.level === 'root' && renderYears()}
            {viewState.level === 'year' && <><div className="mb-4 flex items-center gap-2"><button onClick={handleBack} className="p-1.5 bg-white rounded-full text-slate-400 shadow-sm"><svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" /></svg></button></div>{renderMonths()}</>}
            {viewState.level === 'month' && <><div className="mb-4 flex items-center gap-2"><button onClick={handleBack} className="p-1.5 bg-white rounded-full text-slate-400 shadow-sm"><svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" /></svg></button></div>{renderMemories()}</>}
            <Modal isOpen={!!editMemory} title="编辑记忆" onClose={() => setEditMemory(null)} footer={<button onClick={() => { if (editMemory) onUpdateMemory(editMemory.id, editMemory.summary); setEditMemory(null); }} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存修改</button>}>
                {editMemory && <textarea value={editMemory.summary} onChange={e => setEditMemory({ ...editMemory, summary: e.target.value })} className="w-full h-40 bg-slate-100 rounded-xl p-3 text-sm resize-none" />}
            </Modal>
            <Modal isOpen={showDeleteConfirm} title="确认删除" onClose={() => setShowDeleteConfirm(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button><button onClick={performDelete} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认删除</button></div>}>
                <p className="text-sm text-slate-600 text-center py-4">确定删除这 {selectedIds.size} 条记忆吗？</p>
            </Modal>
        </div>
    );
};

// --- CheckPhone App Main Shell (SULLYTEST2-style Grid Launcher) ---

type PanelType = 'grid' | 'dashboard' | 'memories' | 'impression' | 'workspace' | 'skills' | 'permissions' | 'cron';

// --- AppIcon Component (from SULLYTEST2) ---
const AppIcon: React.FC<{ icon: string; color: string; label: string; onClick: () => void }> = ({ icon, color, label, onClick }) => (
    <div className="flex flex-col items-center gap-1.5">
        <button
            onClick={onClick}
            className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] flex items-center justify-center text-2xl shadow-lg border border-white/10 active:scale-95 transition-transform relative overflow-hidden"
            style={{ background: color }}
        >
            <div className="absolute inset-0 bg-gradient-to-tr from-black/10 to-transparent"></div>
            <div className="relative z-10 drop-shadow-md">{icon}</div>
        </button>
        <span className="text-[10px] font-medium text-white/90 drop-shadow-md tracking-wide px-1 py-0.5 rounded bg-black/10 backdrop-blur-[2px]">{label}</span>
    </div>
);

const CheckPhoneApp: React.FC = () => {
    const { closeApp, characters, updateCharacter, userProfile, addToast, apiConfig } = useOS();
    const [activePanel, setActivePanel] = useState<PanelType>('grid');
    const [isGeneratingImpression, setIsGeneratingImpression] = useState(false);

    // --- Permissions state ---
    const [perms, setPerms] = useState({ notify: true, sysSettings: true, network: false });
    const togglePerm = (key: 'notify' | 'sysSettings' | 'network') => {
        setPerms(prev => ({ ...prev, [key]: !prev[key] }));
        addToast(`${key === 'notify' ? '主动通知' : key === 'sysSettings' ? '修改设置' : '外部网络'}权限已${perms[key] ? '关闭' : '开启'}`, 'info');
    };

    const agent = characters[0];

    // --- Heartbeat helpers ---
    const toggleHeartbeat = () => {
        const current = agent?.heartbeat?.enabled ?? false;
        updateCharacter(agent.id, {
            heartbeat: { ...(agent?.heartbeat || { intervalMinutes: 30, prompt: '' }), enabled: !current }
        });
        addToast(`心跳已${current ? '关闭' : '开启'}`, 'info');
    };
    const adjustInterval = (delta: number) => {
        const cur = agent?.heartbeat?.intervalMinutes || 30;
        const next = Math.max(5, Math.min(120, cur + delta));
        updateCharacter(agent.id, {
            heartbeat: { ...(agent?.heartbeat || { enabled: false, prompt: '' }), intervalMinutes: next }
        });
    };

    // --- Panel Header with Back Button ---
    const PanelHeader: React.FC<{ title: string }> = ({ title }) => (
        <div className="pt-10 h-24 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200">
            <button onClick={() => setActivePanel('grid')} className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <span className="font-bold text-base tracking-wide truncate max-w-[200px]">{title}</span>
            <div className="w-8"></div>
        </div>
    );

    // ─── Dashboard Panel ───
    const renderDashboard = () => {
        const memCount = agent?.memories?.length || 0;
        const dynamicCount = agent?.dynamicMemories?.length || 0;
        const pendingProposals = agent?.coreProposals?.filter(p => p.status === 'pending').length || 0;

        return (
            <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
                <PanelHeader title="系统状态" />
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                    {/* Agent Banner */}
                    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-green-50 rounded-full blur-3xl"></div>
                        <div className="relative z-10 flex items-center gap-5">
                            <div className="relative">
                                <img src={agent?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=nova'} className="w-16 h-16 rounded-2xl object-cover shadow-sm ring-2 ring-white" alt="Avatar" />
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white ring-2 ring-green-100 animate-pulse"></div>
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    {agent?.name || 'Nova'}
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] uppercase font-bold tracking-widest rounded-md">Online</span>
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">系统核心稳定运行中</p>
                            </div>
                        </div>
                    </div>
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between h-28">
                            <div className="text-slate-400"><span className="text-xs font-bold uppercase tracking-widest">记忆碎片</span></div>
                            <div className="flex items-end justify-between"><span className="text-3xl font-light text-slate-800 font-mono">{memCount}</span><span className="text-[10px] text-purple-500 bg-purple-50 px-2 py-1 rounded-md">Memories</span></div>
                        </div>
                        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between h-28">
                            <div className="text-slate-400"><span className="text-xs font-bold uppercase tracking-widest">近期动态</span></div>
                            <div className="flex items-end justify-between"><span className="text-3xl font-light text-slate-800 font-mono">{dynamicCount}</span><span className="text-[10px] text-blue-500 bg-blue-50 px-2 py-1 rounded-md">L3a</span></div>
                        </div>
                        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between h-28">
                            <div className="text-slate-400"><span className="text-xs font-bold uppercase tracking-widest">待审提案</span></div>
                            <div className="flex items-end justify-between"><span className="text-3xl font-light text-slate-800 font-mono">{pendingProposals}</span><span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-1 rounded-md">Pending</span></div>
                        </div>
                        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between h-28">
                            <div className="text-slate-400"><span className="text-xs font-bold uppercase tracking-widest">安全评级</span></div>
                            <div className="flex items-end justify-between"><span className="text-2xl font-bold text-slate-800">Safe</span><span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">Level 1</span></div>
                        </div>
                    </div>
                    {/* Heartbeat Status */}
                    <div className="bg-slate-800 rounded-3xl p-6 text-slate-300 shadow-lg">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                            Heartbeat & Cron
                        </h3>
                        <div className="space-y-2 font-mono text-[11px] opacity-80">
                            <p className="flex gap-3"><span className="text-emerald-400">💓</span> <span>心跳间隔: {agent?.heartbeat?.intervalMinutes || 30} 分钟</span></p>
                            <p className="flex gap-3"><span className="text-blue-400">⏰</span> <span>定时任务: 请进入[后台调度]查看</span></p>
                            <p className="flex gap-3 mt-2 text-[9px] text-slate-500"><span>📡</span> <span>心跳时 Agent 会检查待办/提醒，有需要时主动推送通知给你</span></p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ─── Workspace Panel (Real File Browser) ───
    const [wsFiles, setWsFiles] = useState<any[]>([]);
    const [wsCurrentPath, setWsCurrentPath] = useState('/');
    const [wsViewingFile, setWsViewingFile] = useState<any | null>(null);
    const [wsEditing, setWsEditing] = useState(false);
    const [wsEditContent, setWsEditContent] = useState('');
    const [wsCreating, setWsCreating] = useState<'file' | 'folder' | null>(null);
    const [wsNewName, setWsNewName] = useState('');
    const [showMoveWsItem, setShowMoveWsItem] = useState<any | null>(null);
    const [wsMoveTargetPath, setWsMoveTargetPath] = useState('/');

    // Load workspace files when panel opens
    const loadWsFiles = async () => {
        // DB.seedDefaultWorkspaceFiles() is removed because OSContext.tsx now handles full Boot Sync from physical disk.
        const files = await DB.getWorkspaceFiles();
        setWsFiles(files);
    };

    const currentItems = wsFiles.filter(f => f.path === wsCurrentPath);

    const handleCreateWsItem = async () => {
        if (!wsNewName.trim() || !wsCreating) return;
        const now = Date.now();
        const newFile: any = {
            id: `ws-${now}-${Math.random().toString(36).slice(2, 6)}`,
            name: wsNewName.trim() + (wsCreating === 'file' && !wsNewName.includes('.') ? '.md' : ''),
            path: wsCurrentPath,
            type: wsCreating,
            content: wsCreating === 'file' ? '# ' + wsNewName.trim() + '\n\n' : undefined,
            size: 0,
            createdAt: now,
            updatedAt: now,
        };
        await DB.saveWorkspaceFile(newFile);

        // Sync to physical workspace if configured
        if (apiConfig.nativeWorkspacePath) {
            try {
                const fullRelativePath = wsCurrentPath.substring(1) + newFile.name; // remove leading slash
                if (wsCreating === 'file') {
                    await fsBridge.writeFile(apiConfig.nativeWorkspacePath, fullRelativePath, newFile.content);
                }
            } catch (e) {
                console.error("Failed to sync to physical workspace", e);
                // addToast('同步到本地文件失败', 'error'); // Optional error toast
            }
        }

        setWsNewName('');
        setWsCreating(null);
        addToast(`${wsCreating === 'file' ? '文件' : '文件夹'}已创建`, 'success');
        loadWsFiles();
    };

    const handleDeleteWsFile = async (file: any) => {
        await DB.deleteWorkspaceFile(file.id);
        // If it's a folder, also delete children from DB
        if (file.type === 'folder') {
            const childPath = wsCurrentPath + file.name + '/';
            const children = wsFiles.filter(f => f.path.startsWith(childPath));
            for (const c of children) await DB.deleteWorkspaceFile(c.id);
        }

        // Delete physical file/folder
        if (apiConfig.nativeWorkspacePath) {
            try {
                const fullRelativePath = file.path.substring(1) + file.name;
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                await fsBridge.deleteFile(apiConfig.nativeWorkspacePath, fullRelativePath, allowGlobal);
            } catch (e) {
                console.error("Physical delete failed", e);
            }
        }

        addToast('已删除', 'info');
        setWsViewingFile(null);
        loadWsFiles();
    };

    const handleSaveWsFile = async () => {
        if (!wsViewingFile) return;
        const updated = { ...wsViewingFile, content: wsEditContent, size: wsEditContent.length, updatedAt: Date.now() };
        await DB.saveWorkspaceFile(updated);

        // Sync to physical workspace if configured
        if (apiConfig.nativeWorkspacePath) {
            try {
                const fullRelativePath = updated.path.substring(1) + updated.name;
                await fsBridge.writeFile(apiConfig.nativeWorkspacePath, fullRelativePath, updated.content);
            } catch (e) {
                console.error("Failed to sync to physical workspace", e);
                // addToast('同步到本地文件失败', 'error');
            }
        }

        setWsViewingFile(updated);
        setWsEditing(false);
        addToast('文件已保存', 'success');
        loadWsFiles();
    };

    const handleMoveWsItem = async () => {
        if (!showMoveWsItem) return;
        const item = showMoveWsItem;
        if (item.path === wsMoveTargetPath) {
            setShowMoveWsItem(null);
            addToast('已在当前目录', 'info');
            return;
        }
        const oldFolderPath = `${item.path}${item.name}/`;
        if (item.type === 'folder' && wsMoveTargetPath.startsWith(oldFolderPath)) {
            addToast('不能移动到自身子目录', 'error');
            return;
        }

        const oldRelativePath = `${item.path.substring(1)}${item.name}`;
        const nextRelativePath = `${wsMoveTargetPath.substring(1)}${item.name}`;
        const timestampedNextRelativePath = `${wsMoveTargetPath.substring(1)}${item.name}-${Date.now()}`;
        let finalName = item.name;
        let finalPath = wsMoveTargetPath;

        if (apiConfig.nativeWorkspacePath) {
            try {
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                await fsBridge.renameFile(apiConfig.nativeWorkspacePath, oldRelativePath, nextRelativePath, allowGlobal);
            } catch {
                const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
                await fsBridge.renameFile(apiConfig.nativeWorkspacePath, oldRelativePath, timestampedNextRelativePath, allowGlobal);
                finalName = timestampedNextRelativePath.split('/').pop() || item.name;
            }
        }

        await DB.saveWorkspaceFile({ ...item, name: finalName, path: finalPath, updatedAt: Date.now() });
        if (item.type === 'folder') {
            const oldPrefix = `${item.path}${item.name}/`;
            const newPrefix = `${finalPath}${finalName}/`;
            const descendants = wsFiles.filter(f => f.path.startsWith(oldPrefix));
            for (const child of descendants) {
                await DB.saveWorkspaceFile({ ...child, path: child.path.replace(oldPrefix, newPrefix), updatedAt: Date.now() });
            }
        }

        setShowMoveWsItem(null);
        addToast('已移动', 'success');
        loadWsFiles();
    };

    const renderWorkspace = () => {
        // First load
        if (wsFiles.length === 0 && activePanel === 'workspace') {
            loadWsFiles();
        }

        // File viewer/editor mode
        if (wsViewingFile) {
            return (
                <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
                    <div className="pt-10 h-24 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200">
                        <button onClick={() => { setWsViewingFile(null); setWsEditing(false); }} className="text-blue-500 text-sm font-bold flex items-center gap-1">← 返回</button>
                        <span className="text-sm font-bold text-slate-700 truncate max-w-[50%]">{wsViewingFile.name}</span>
                        <div className="flex gap-2">
                            {!wsEditing ? (
                                <button onClick={() => { setWsEditing(true); setWsEditContent(wsViewingFile.content || ''); }} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold">编辑</button>
                            ) : (
                                <button onClick={handleSaveWsFile} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg font-bold">保存</button>
                            )}
                            {/* <button onClick={() => handleDeleteWsFile(wsViewingFile)} className="text-xs bg-red-100 text-red-500 px-3 py-1.5 rounded-lg font-bold">删除</button> */}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-24 overscroll-contain">
                        {wsEditing ? (
                            <textarea
                                value={wsEditContent}
                                onChange={e => setWsEditContent(e.target.value)}
                                className="w-full h-full min-h-[400px] bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-700 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="输入文件内容..."
                            />
                        ) : (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{wsViewingFile.content || '(空文件)'}</pre>
                            </div>
                        )}
                        <div className="mt-4 text-[10px] text-slate-400 text-center">
                            大小: {wsViewingFile.size}B · 更新: {new Date(wsViewingFile.updatedAt).toLocaleString()}
                        </div>
                    </div>
                </div>
            );
        }

        // File browser
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
                <PanelHeader title="工作区" />
                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar pb-24 overscroll-contain">
                    {/* Path breadcrumb */}
                    <div className="flex items-center gap-1 text-xs text-slate-400 px-2">
                        <button onClick={() => setWsCurrentPath('/')} className="text-blue-500 font-bold hover:underline">Root</button>
                        {wsCurrentPath !== '/' && wsCurrentPath.split('/').filter(Boolean).map((seg, idx, arr) => (
                            <span key={idx} className="flex items-center gap-1">
                                <span>/</span>
                                <button onClick={() => setWsCurrentPath('/' + arr.slice(0, idx + 1).join('/') + '/')} className="text-blue-500 hover:underline">{seg}</button>
                            </span>
                        ))}
                    </div>

                    {/* File/Folder list */}
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                        {currentItems.length === 0 && (
                            <div className="p-8 text-center text-sm text-slate-300">此目录为空</div>
                        )}
                        {currentItems.sort((a: any, b: any) => (a.type === 'folder' ? -1 : 1) - (b.type === 'folder' ? -1 : 1) || a.name.localeCompare(b.name)).map((item: any) => (
                            <button
                                key={item.id}
                                onClick={async () => {
                                    if (item.type === 'folder') {
                                        setWsCurrentPath(wsCurrentPath + item.name + '/');
                                    } else {
                                        setWsViewingFile({ ...item, content: '正在读取文件...' });
                                        if (item.content === undefined && apiConfig.nativeWorkspacePath) {
                                            try {
                                                const fullRelativePath = item.path.substring(1) + item.name;
                                                const content = await fsBridge.readFile(apiConfig.nativeWorkspacePath, fullRelativePath);
                                                const updatedItem = { ...item, content };
                                                setWsViewingFile(updatedItem);
                                                // Optional: Save to DB to cache it, or don't to keep DB lean (LRU strategy)
                                                // Here we just keep DB lean by not saving back.
                                            } catch (e) {
                                                setWsViewingFile({ ...item, content: `(读取失败: ${e})` });
                                            }
                                        } else {
                                            setWsViewingFile(item);
                                        }
                                    }
                                }}
                                className="w-full p-4 border-b border-slate-50 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
                            >
                                <span className="text-xl">{item.type === 'folder' ? '📁' : item.name.endsWith('.md') ? '📝' : '📄'}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-700 truncate">{item.name}</div>
                                    <div className="text-[10px] text-slate-400">{item.type === 'folder' ? `${wsFiles.filter((f: any) => f.path === wsCurrentPath + item.name + '/').length} 个项目` : `${item.size}B`}</div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteWsFile(item); }}
                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors active:scale-95"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMoveWsItem(item);
                                        setWsMoveTargetPath(wsCurrentPath);
                                    }}
                                    className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors active:scale-95"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h10.75m0 0-3.5-3.5m3.5 3.5-3.5 3.5M19.5 7.5v9" /></svg>
                                </button>
                                <span className="text-slate-300 text-sm">{item.type === 'folder' ? '›' : ''}</span>
                            </button>
                        ))}
                    </div>

                    {/* Create buttons */}
                    {wsCreating ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                            <div className="text-xs font-bold text-slate-600">{wsCreating === 'file' ? '📄 新建文件' : '📁 新建文件夹'}</div>
                            <input
                                value={wsNewName}
                                onChange={e => setWsNewName(e.target.value)}
                                placeholder={wsCreating === 'file' ? '文件名 (如 notes.md)' : '文件夹名'}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleCreateWsItem()}
                            />
                            <div className="flex gap-2">
                                <button onClick={handleCreateWsItem} className="flex-1 bg-blue-500 text-white text-xs py-2 rounded-xl font-bold">创建</button>
                                <button onClick={() => { setWsCreating(null); setWsNewName(''); }} className="flex-1 bg-slate-100 text-slate-600 text-xs py-2 rounded-xl font-bold">取消</button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button onClick={() => setWsCreating('file')} className="flex-1 bg-white border border-slate-200 text-slate-600 text-xs py-3 rounded-2xl font-bold hover:bg-slate-50 transition-colors">📄 新建文件</button>
                            <button onClick={() => setWsCreating('folder')} className="flex-1 bg-white border border-slate-200 text-slate-600 text-xs py-3 rounded-2xl font-bold hover:bg-slate-50 transition-colors">📁 新建文件夹</button>
                        </div>
                    )}
                    <p className="text-[10px] text-slate-400 text-center">Agent 和用户都可以在工作区创建和编辑文件</p>
                </div>
                <Modal
                    isOpen={!!showMoveWsItem}
                    title={`移动${showMoveWsItem?.type === 'folder' ? '文件夹' : '文件'}`}
                    onClose={() => setShowMoveWsItem(null)}
                    footer={
                        <>
                            <button onClick={() => setShowMoveWsItem(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                            <button onClick={handleMoveWsItem} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">确认移动</button>
                        </>
                    }
                >
                    <div className="space-y-2 max-h-[45vh] overflow-y-auto no-scrollbar">
                        <button onClick={() => setWsMoveTargetPath('/')} className={`w-full text-left p-3 rounded-xl border ${wsMoveTargetPath === '/' ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'}`}>/ (Root)</button>
                        {wsFiles
                            .filter(f => f.type === 'folder')
                            .sort((a, b) => (`${a.path}${a.name}`).localeCompare(`${b.path}${b.name}`))
                            .map(folder => {
                                const folderPath = `${folder.path}${folder.name}/`;
                                const blocked = showMoveWsItem && showMoveWsItem.type === 'folder' && folderPath.startsWith(`${showMoveWsItem.path}${showMoveWsItem.name}/`);
                                return (
                                    <button
                                        key={`move-target-${folder.id}`}
                                        disabled={blocked}
                                        onClick={() => setWsMoveTargetPath(folderPath)}
                                        className={`w-full text-left p-3 rounded-xl border ${wsMoveTargetPath === folderPath ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'} ${blocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                                    >
                                        {folderPath}
                                    </button>
                                );
                            })}
                    </div>
                </Modal>
            </div>
        );
    };

    // ─── Skills Panel ───
    const renderSkills = () => (
        <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
            <PanelHeader title="技能中心" />
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 opacity-70">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl text-xl">💖</div>
                            <div><h4 className="text-sm font-bold text-slate-800">情绪共情引擎</h4><p className="text-xs text-slate-400 mt-1">自动分析语气，提供情绪安抚与支持。</p></div>
                        </div>
                        <div className="w-10 h-6 bg-primary rounded-full relative"><div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1 shadow-sm"></div></div>
                    </div>
                </div>
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 opacity-70">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl text-xl">🔔</div>
                            <div><h4 className="text-sm font-bold text-slate-800">主动关怀</h4><p className="text-xs text-slate-400 mt-1">根据记忆图谱，在特殊日期主动发消息。</p></div>
                        </div>
                        <div className="w-10 h-6 bg-primary rounded-full relative"><div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1 shadow-sm"></div></div>
                    </div>
                </div>
                <p className="text-xs text-slate-400 text-center mt-6">MCP / 自定义技能集市建设中...</p>
            </div>
        </div>
    );

    // ─── Permissions Panel ───
    const PermToggle: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
        <button onClick={onToggle} className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${on ? 'bg-green-500' : 'bg-slate-300'}`}>
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all duration-200 ${on ? 'right-1' : 'left-1'}`}></div>
        </button>
    );

    const renderPermissions = () => (
        <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
            <PanelHeader title="安全与权限" />
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-50 flex items-center justify-between">
                        <div><div className="text-sm font-bold text-slate-700">允许 AI 主动通知</div><div className="text-[10px] text-slate-400 mt-1">允许 Agent 通过系统推送主动联系你。</div></div>
                        <PermToggle on={perms.notify} onToggle={() => togglePerm('notify')} />
                    </div>
                    <div className="p-5 border-b border-slate-50 flex items-center justify-between">
                        <div><div className="text-sm font-bold text-slate-700">允许修改系统设置</div><div className="text-[10px] text-slate-400 mt-1">允许 Agent 替你更换壁纸、调整闹钟等。</div></div>
                        <PermToggle on={perms.sysSettings} onToggle={() => togglePerm('sysSettings')} />
                    </div>
                    <div className="p-5 flex items-center justify-between">
                        <div><div className="text-sm font-bold text-slate-700">外部网络访问</div><div className="text-[10px] text-slate-400 mt-1">允许 Agent 通过联网搜索回答问题。</div></div>
                        <PermToggle on={perms.network} onToggle={() => togglePerm('network')} />
                    </div>
                </div>
            </div>
        </div>
    );

    // ─── Cron Manager Panel ───
    const renderCronPanel = () => (
        <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
            <PanelHeader title="后台调度" />
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <span className="text-lg">⏰</span> 定时任务列表
                    </h3>
                    <div className="space-y-3">
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold text-slate-700">每日记忆归档</span>
                                <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-600 rounded-full font-bold">System</span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">每天凌晨2点自动提炼昨日对话为记忆摘要</p>
                            <span className="text-[10px] text-slate-400 font-mono">cron: 0 2 * * *</span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 text-center mt-6">💡 提示: 你可以在聊天中对 Agent 说"帮我设置一个明天早上7点查天气的定时任务"来创建新的 Cron 任务</p>
                </div>
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <span className="text-lg">💓</span> 心跳配置
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div><div className="text-sm font-medium text-slate-700">心跳开关</div><div className="text-[10px] text-slate-400">Agent 定期检查待办/提醒，有需要时主动推送</div></div>
                            <button onClick={toggleHeartbeat} className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${agent?.heartbeat?.enabled ? 'bg-green-500' : 'bg-slate-300'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all duration-200 ${agent?.heartbeat?.enabled ? 'right-1' : 'left-1'}`}></div>
                            </button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-slate-700">间隔频率</div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => adjustInterval(-5)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-colors flex items-center justify-center">−</button>
                                <span className="text-sm font-mono text-slate-700 w-12 text-center">{agent?.heartbeat?.intervalMinutes || 30}min</span>
                                <button onClick={() => adjustInterval(5)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-colors flex items-center justify-center">+</button>
                            </div>
                        </div>
                        <p className="text-xs text-slate-400">💡 你也可以在聊天中对 Agent 说"把心跳改为15分钟一次"来调整频率</p>
                    </div>
                </div>
            </div>
        </div>
    );

    // Methods for impression logic
    const handleGenerateImpression = async (type: 'initial' | 'update') => {
        if (!agent || !apiConfig.apiKey) { addToast('请先配置 API Key', 'error'); return; }
        setIsGeneratingImpression(true);
        try {
            addToast('印象档案生成逻辑待进一步重构', 'info');
        } catch (e: any) { addToast(`生成失败: ${e.message}`, 'error'); } finally { setIsGeneratingImpression(false); }
    };

    // Methods for memory logic
    const handleRefineMonth = async (year: string, month: string, rawText: string) => {
        if (!agent || !apiConfig.apiKey) return;
        try {
            addToast('精炼生成待 API 重构完整注入', 'info');
            const newRefined = { ...agent.refinedMemories, [`${year}-${month}`]: "示例精炼记忆" };
            updateCharacter(agent.id, { refinedMemories: newRefined });
        } catch (err: any) { addToast(err.message, 'error'); }
    };

    // ─── Grid Desktop View (SULLYTEST2-style) ───
    const renderGrid = () => {
        const bgStyle = { background: 'linear-gradient(to bottom, #1e293b, #0f172a)' };

        return (
            <div className="absolute inset-0 flex flex-col z-0" style={{ ...bgStyle, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"></div>

                {/* App Grid */}
                <div className="flex-1 px-5 pt-14 pb-5 z-10 overflow-y-auto no-scrollbar overscroll-none">
                    <div className="grid grid-cols-4 gap-y-6 gap-x-2 place-items-center content-start">
                        <AppIcon icon="📊" color="linear-gradient(135deg, #10b981, #059669)" label="状态面板" onClick={() => setActivePanel('dashboard')} />
                        <AppIcon icon="🧠" color="linear-gradient(135deg, #8b5cf6, #6d28d9)" label="记忆档案" onClick={() => setActivePanel('memories')} />
                        <AppIcon icon="👁️" color="linear-gradient(135deg, #6366f1, #4f46e5)" label="印象侧写" onClick={() => setActivePanel('impression')} />
                        <AppIcon icon="📁" color="linear-gradient(135deg, #f59e0b, #d97706)" label="工作区" onClick={() => setActivePanel('workspace')} />
                        <AppIcon icon="⚡" color="linear-gradient(135deg, #ec4899, #db2777)" label="技能中心" onClick={() => setActivePanel('skills')} />
                        <AppIcon icon="🔒" color="linear-gradient(135deg, #14b8a6, #0d9488)" label="安全权限" onClick={() => setActivePanel('permissions')} />
                        <AppIcon icon="⏰" color="linear-gradient(135deg, #3b82f6, #2563eb)" label="后台调度" onClick={() => setActivePanel('cron')} />

                        {/* Disconnect Button (SULLYTEST2 style) */}
                        <div className="flex flex-col items-center gap-1.5">
                            <button
                                onClick={closeApp}
                                className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] bg-red-500/20 backdrop-blur-md border border-red-400/50 flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-red-500/40"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-7 h-7 text-white">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                                </svg>
                            </button>
                            <span className="text-[10px] font-medium text-white/90 drop-shadow-md tracking-wide px-1 py-0.5 rounded bg-black/10 backdrop-blur-[2px]">断开连接</span>
                        </div>
                    </div>
                </div>

                {/* Bottom Dock */}
                <div className="p-4 z-20">
                    <div className="bg-white/20 backdrop-blur-xl rounded-[2rem] p-3 flex justify-around items-center border border-white/10 shadow-lg">
                        <button onClick={() => setActivePanel('dashboard')} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center text-xl shadow-sm">📊</div></button>
                        <button onClick={() => setActivePanel('memories')} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center text-xl shadow-sm">🧠</div></button>
                        <button onClick={() => setActivePanel('cron')} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-xl shadow-sm">⏰</div></button>
                        <button onClick={() => setActivePanel('impression')} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-xl shadow-sm">👁️</div></button>
                    </div>
                </div>
            </div>
        );
    };

    // ─── Main Render ───
    return (
        <div className="absolute inset-0 bg-slate-900 overflow-hidden font-sans overscroll-none">
            {activePanel === 'grid' && renderGrid()}
            {activePanel === 'dashboard' && renderDashboard()}
            {activePanel === 'workspace' && renderWorkspace()}
            {activePanel === 'skills' && renderSkills()}
            {activePanel === 'permissions' && renderPermissions()}
            {activePanel === 'cron' && renderCronPanel()}
            {activePanel === 'memories' && (
                <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
                    <PanelHeader title="记忆档案" />
                    <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-24 overscroll-contain">
                        <MemoryArchivist
                            memories={agent?.memories || []}
                            refinedMemories={agent?.refinedMemories || {}}
                            activeMemoryMonths={agent?.activeMemoryMonths || []}
                            onRefine={handleRefineMonth}
                            onDeleteMemories={(ids) => updateCharacter(agent.id, { memories: agent.memories?.filter(m => !ids.includes(m.id)) })}
                            onUpdateMemory={(id, summary) => updateCharacter(agent.id, { memories: agent.memories?.map(m => m.id === id ? { ...m, summary } : m) })}
                            onToggleActiveMonth={(y, m) => {
                                const key = `${y}-${m}`;
                                const am = agent?.activeMemoryMonths || [];
                                updateCharacter(agent.id, { activeMemoryMonths: am.includes(key) ? am.filter(k => k !== key) : [...am, key] });
                            }}
                        />
                    </div>
                </div>
            )}
            {activePanel === 'impression' && (
                <div className="absolute inset-0 flex flex-col bg-[#f8fafc] z-10">
                    <PanelHeader title="印象侧写" />
                    <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-24 overscroll-contain">
                        <ImpressionPanel
                            impression={agent?.impression}
                            isGenerating={isGeneratingImpression}
                            onGenerate={handleGenerateImpression}
                            onUpdateImpression={(imp) => updateCharacter(agent.id, { impression: imp })}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};


export default CheckPhoneApp;
