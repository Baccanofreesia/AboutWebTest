



import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, MemoryFragment, Message, UserImpression, CharacterExportData } from '../types';
import Modal from '../components/os/Modal';
import { processImage } from '../utils/file';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { DB } from '../utils/db';

const CharacterCard: React.FC<{ 
    char: CharacterProfile; 
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
}> = ({ char, onClick, onDelete }) => (
    <div 
        onClick={onClick}
        className="relative p-4 rounded-3xl border bg-white/40 border-white/40 hover:bg-white/60 hover:scale-[1.01] transition-all duration-300 cursor-pointer group shadow-sm"
    >
        <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-slate-100 border border-white/50 overflow-hidden relative shadow-inner">
                <div className="absolute inset-0 bg-slate-100/50"></div> 
                <img src={char.avatar} className="w-full h-full object-cover relative z-10" alt={char.name} />
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate text-slate-700">
                    {char.name}
                </h3>
                <p className="text-xs text-slate-400 truncate mt-0.5 font-light">
                    {char.description || '暂无描述'}
                </p>
            </div>
        </div>
        {/* FIX: Removed opacity-0 to make it visible on mobile, added visual cues */}
        <button 
            onClick={onDelete}
            className="absolute top-3 right-3 p-2 rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 active:bg-red-100 active:text-red-500 transition-all z-10"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
        </button>
    </div>
);

// ... (Impression Components - TagGroup, AnalysisBlock, ImpressionPanel kept exactly same) ...
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
                    <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto">让 AI 遍历过往的记忆和对话，生成一份关于你的“私密观察报告”。这将让 TA 更懂你。</p>
                </div>
                <button 
                    onClick={() => onGenerate('initial')}
                    className="px-8 py-3 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all"
                >
                    开始深度分析
                </button>
            </div>
        );
    }

    if (isGenerating) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
                 <div className="relative w-20 h-20">
                     <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                     <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                 </div>
                 <p className="text-sm text-slate-500 font-medium animate-pulse">正在回顾你们的共同回忆...</p>
                 <p className="text-xs text-slate-400">构建思维殿堂 / 梳理情绪图谱</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header Actions */}
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

            {/* Core Summary - High Priority */}
            <div className="relative bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-6 text-white shadow-lg overflow-hidden">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-3">核心印象 (Core Summary)</h3>
                <p className="text-lg font-light leading-relaxed italic opacity-95">"{impression?.personality_core.summary}"</p>
                
                <div className="mt-6 pt-4 border-t border-white/20 grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-[10px] text-white/60 uppercase mb-1">互动模式</div>
                        <div className="text-sm font-medium">{impression?.personality_core.interaction_style}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-white/60 uppercase mb-1">语气感知</div>
                        <div className="text-sm font-medium">{impression?.behavior_profile.tone_style}</div>
                    </div>
                </div>
            </div>

            {/* Dimension 1: Values & Traits */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <h3 className="text-sm font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    价值地图 (Value Map)
                </h3>
                
                <TagGroup title="观察到的特质 (Traits)" tags={impression?.personality_core.observed_traits || []} color="bg-blue-400" onRemove={(t) => removeTag(['personality_core', 'observed_traits'], t)} />
                <TagGroup title="TA 喜欢的 (Likes)" tags={impression?.value_map.likes || []} color="bg-pink-400" onRemove={(t) => removeTag(['value_map', 'likes'], t)} />
                <TagGroup title="TA 讨厌的 (Dislikes)" tags={impression?.value_map.dislikes || []} color="bg-slate-400" onRemove={(t) => removeTag(['value_map', 'dislikes'], t)} />
                
                <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">核心价值观推测</div>
                    <p className="text-sm text-slate-600">{impression?.value_map.core_values}</p>
                </div>
            </div>

            {/* Dimension 2: Emotional Intelligence */}
            <div className="grid grid-cols-1 gap-4">
                <AnalysisBlock 
                    title="情绪状态总结 (Emotion)" 
                    content={impression?.behavior_profile.emotion_summary || ''}
                    icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <div className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-2">✅ 正向触发器</div>
                            <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                                {impression?.emotion_schema.triggers.positive.map((t, i) => <li key={i}>{t}</li>)}
                            </ul>
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">❌ 压力/雷区</div>
                            <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                                {impression?.emotion_schema.triggers.negative.map((t, i) => <li key={i}>{t}</li>)}
                            </ul>
                        </div>
                    </div>
                </div>
                 <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                     <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">舒适区 (Comfort Zone)</div>
                     <p className="text-sm text-slate-600">{impression?.emotion_schema.comfort_zone}</p>
                </div>
            </div>

            {/* Updates Log */}
            {impression?.observed_changes && impression.observed_changes.length > 0 && (
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                    <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">最近观察到的变化</h4>
                    <ul className="space-y-2">
                        {impression.observed_changes.map((c, i) => (
                            <li key={i} className="text-xs text-amber-900 flex items-start gap-2">
                                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                                <span className="opacity-90">{c}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// ... (MemoryArchivist implementation remains same) ...
// Since I cannot partial update, I will include the full MemoryArchivist implementation here.
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
    const [viewState, setViewState] = useState<{
        level: 'root' | 'year' | 'month';
        selectedYear: string | null;
        selectedMonth: string | null;
    }>({ level: 'root', selectedYear: null, selectedMonth: null });
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
            if (dateMatch) {
                year = dateMatch[1];
                month = dateMatch[2].padStart(2, '0');
            } else if (m.date.includes('unknown')) year = '未归档';
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

    const handleYearClick = (year: string) => setViewState({ level: 'year', selectedYear: year, selectedMonth: null });
    const handleMonthClick = (month: string) => setViewState(prev => ({ ...prev, level: 'month', selectedMonth: month }));
    const handleBack = () => {
        if (viewState.level === 'month') setViewState(prev => ({ ...prev, level: 'year', selectedMonth: null }));
        else if (viewState.level === 'year') setViewState({ level: 'root', selectedYear: null, selectedMonth: null });
    };

    const triggerRefine = async () => {
        if (!viewState.selectedYear || !viewState.selectedMonth) return;
        setIsRefining(true);
        const monthMems = tree[viewState.selectedYear][viewState.selectedMonth];
        const combinedText = monthMems.map(m => `${m.date}: ${m.summary} (${m.mood || '无'})`).join('\n');
        try { await onRefine(viewState.selectedYear, viewState.selectedMonth, combinedText); } finally { setIsRefining(false); }
    };

    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedIds(next);
    };

    const requestDelete = () => { if (selectedIds.size > 0) setShowDeleteConfirm(true); };
    const performDelete = () => { onDeleteMemories(Array.from(selectedIds)); setSelectedIds(new Set()); setIsManageMode(false); setShowDeleteConfirm(false); };

    if (!memories || memories.length === 0) return <div className="flex flex-col items-center justify-center h-48 text-slate-400"><p className="text-xs">暂无记忆档案</p></div>;

    const renderYears = () => (
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
            {Object.keys(tree).map(year => (
                <div key={year} onClick={() => handleYearClick(year)} className="bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-white/50 shadow-sm active:scale-95 transition-all flex flex-col justify-between h-28 group cursor-pointer hover:bg-white/80">
                    <div className="flex justify-between items-start">
                         <div className="p-2 bg-amber-100/50 rounded-lg text-amber-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg></div>
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
                         <div onClick={() => handleMonthClick(month)} className="bg-white/50 backdrop-blur-sm p-3 rounded-2xl border border-white/40 shadow-sm active:scale-95 transition-all flex flex-col justify-center items-center gap-2 aspect-square cursor-pointer hover:bg-white/70 relative overflow-hidden">
                            {refinedMemories?.[monthKey] && <div className="absolute top-0 right-0 w-3 h-3 bg-indigo-500 rounded-bl-lg shadow-sm"></div>}
                            <span className="text-2xl font-light text-slate-700">{parseInt(month)}<span className="text-xs ml-0.5 text-slate-400">月</span></span>
                            <div className="h-0.5 w-4 bg-primary/30 rounded-full"></div>
                            <span className="text-[10px] text-slate-400">{tree[viewState.selectedYear!][month].length} 条记忆</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onToggleActiveMonth(viewState.selectedYear!, month); }} className={`absolute -top-2 -right-2 p-1.5 rounded-full shadow-md z-10 transition-colors ${isActive ? 'bg-primary text-white' : 'bg-white text-slate-300 border border-slate-100'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clipRule="evenodd" /></svg>
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

        if (rawMemories.length === 0) return <div className="flex flex-col items-center justify-center h-32 text-slate-300"><p className="text-xs">本月记忆已清空</p></div>;

        return (
            <div className="space-y-6 animate-fade-in pb-8">
                <div className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100 relative group">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-indigo-700"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .914-.143Z" clipRule="evenodd" /></svg><h4 className="text-xs font-bold tracking-wide uppercase">核心记忆 (AI Context)</h4></div>
                        <div className="flex gap-2">
                             <button onClick={() => onToggleActiveMonth(viewState.selectedYear!, viewState.selectedMonth!)} className={`text-[10px] px-3 py-1 rounded-full border shadow-sm transition-colors flex items-center gap-1 ${isActive ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200'}`}>{isActive ? '详细回忆已激活 (Active)' : '仅使用核心记忆 (Default)'}</button>
                             <button onClick={triggerRefine} disabled={isRefining} className="text-[10px] bg-white text-indigo-600 px-3 py-1 rounded-full border border-indigo-200 shadow-sm hover:bg-indigo-500 hover:text-white transition-colors flex items-center gap-1">{isRefining ? '...' : (refinedContent ? '重新精炼' : '生成')}</button>
                        </div>
                    </div>
                    {refinedContent ? <p className="text-xs text-indigo-900/80 leading-relaxed whitespace-pre-wrap">{refinedContent}</p> : <p className="text-xs text-indigo-300 italic">点击右上角生成本月记忆摘要。</p>}
                </div>
                
                <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Time Logs</h4>
                    <div className="flex gap-2">
                        {isManageMode && selectedIds.size > 0 && <button onClick={(e) => { e.stopPropagation(); requestDelete(); }} className="text-[10px] bg-red-500 text-white px-3 py-1 rounded-full font-bold shadow-sm active:scale-95 transition-transform">删除 ({selectedIds.size})</button>}
                        <button onClick={() => { setIsManageMode(!isManageMode); setSelectedIds(new Set()); }} className={`text-[10px] px-3 py-1 rounded-full border transition-colors ${isManageMode ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>{isManageMode ? '完成' : '管理'}</button>
                    </div>
                </div>

                <div className="mt-2 pl-2">
                    {Object.entries(groupedByDay).map(([date, dayMemories]) => (
                        <div key={date} className="relative pl-8 pb-8 last:pb-0 border-l-[2px] border-slate-100 last:border-l-0 last:border-image-source-none">
                            <div className="absolute left-[-2px] top-0 bottom-0 w-[2px] bg-slate-100"></div>
                            <div className="absolute left-[-7px] top-0 w-3.5 h-3.5 bg-slate-300 rounded-full border-4 border-slate-50 z-10"></div>
                            <div className="mb-3 -mt-1.5 flex items-center gap-2"><span className="text-xs font-bold text-slate-500 font-mono tracking-tight">{date}</span>{dayMemories.length > 1 && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 rounded-md text-slate-400 font-normal">{dayMemories.length} 记录</span>}</div>
                            <div className="space-y-3">
                                {dayMemories.map((mem) => (
                                    <div key={mem.id} className={`relative group transition-all duration-300 ${isManageMode ? 'cursor-pointer' : ''}`} onClick={() => { if (isManageMode) toggleSelection(mem.id); else setEditMemory(mem); }}>
                                        {isManageMode && <div className={`absolute -left-[38px] top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors z-20 ${selectedIds.has(mem.id) ? 'bg-primary border-primary' : 'bg-white border-slate-300'}`}>{selectedIds.has(mem.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}</div>}
                                        <div className={`bg-white p-4 rounded-xl rounded-tl-none border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all ${isManageMode && selectedIds.has(mem.id) ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
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
                            <button onClick={() => setViewState({level: 'root', selectedYear: null, selectedMonth: null})} className="hover:text-primary">档案</button><span className="text-slate-300">/</span>
                            {viewState.level === 'year' ? <span className="text-slate-800">{viewState.selectedYear}</span> : (<><button onClick={() => setViewState(prev => ({...prev, level: 'year', selectedMonth: null}))} className="hover:text-primary">{viewState.selectedYear}</button><span className="text-slate-300">/</span><span className="text-slate-800">{parseInt(viewState.selectedMonth!)}月</span></>)}
                        </>
                    )}
                </div>
            </div>
            {viewState.level === 'root' && renderYears()}
            {viewState.level === 'year' && <><div className="mb-4 flex items-center gap-2"><button onClick={handleBack} className="p-1.5 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" /></svg></button><h3 className="text-sm font-medium text-slate-600">选择月份</h3></div>{renderMonths()}</>}
            {viewState.level === 'month' && <><div className="mb-4 flex items-center gap-2"><button onClick={handleBack} className="p-1.5 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" /></svg></button><h3 className="text-sm font-medium text-slate-600">本月记忆 (点击 👁️ 激活详细回忆)</h3></div>{renderMemories()}</>}

            <Modal isOpen={!!editMemory} title="编辑记忆" onClose={() => setEditMemory(null)} footer={<button onClick={() => { if(editMemory) onUpdateMemory(editMemory.id, editMemory.summary); setEditMemory(null); }} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存修改</button>}>
                {editMemory && <div className="space-y-3"><div className="text-xs text-slate-400">日期: {editMemory.date}</div><textarea value={editMemory.summary} onChange={e => setEditMemory({...editMemory, summary: e.target.value})} className="w-full h-40 bg-slate-100 rounded-xl p-3 text-sm resize-none focus:outline-primary"/></div>}
            </Modal>
            
            <Modal isOpen={showDeleteConfirm} title="确认删除" onClose={() => setShowDeleteConfirm(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button><button onClick={performDelete} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认删除</button></div>}>
                <p className="text-sm text-slate-600 text-center py-4">确定删除选中的 {selectedIds.size} 条记忆吗？<br/><span className="text-xs text-red-400 mt-1 block">此操作不可恢复。</span></p>
            </Modal>
        </div>
    );
};

// --- Main Character App ---

const Character: React.FC = () => {
  const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, addCharacter, updateCharacter, deleteCharacter, apiConfig, addToast, userProfile, customThemes, addCustomTheme } = useOS();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detailTab, setDetailTab] = useState<'identity' | 'memory' | 'impression'>('identity');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CharacterProfile | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardImportRef = useRef<HTMLInputElement>(null);
  
  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false); 
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<string | null>(null); // New state for delete confirmation

  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [isProcessingMemory, setIsProcessingMemory] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  // Batch Summarize State
  const [batchRange, setBatchRange] = useState({ start: '', end: '' });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  // Impression State
  const [isGeneratingImpression, setIsGeneratingImpression] = useState(false);

  useEffect(() => {
    if (editingId && view === 'detail') {
        if (!formData || formData.id !== editingId) {
            const target = characters.find(c => c.id === editingId);
            if (target) setFormData(target);
        }
    }
  }, [editingId, view]); 

  useEffect(() => {
    if (formData && editingId) {
        updateCharacter(editingId, formData);
    }
  }, [formData]);

  const handleBack = () => {
      if (view === 'detail') {
          setView('list');
          setEditingId(null);
      } else closeApp();
  };

  const handleChange = (field: keyof CharacterProfile, value: any) => {
      if (!formData) return;
      setFormData({ ...formData, [field]: value });
  };

  const handleToggleActiveMonth = (year: string, month: string) => {
      if (!formData) return;
      const key = `${year}-${month}`;
      const current = formData.activeMemoryMonths || [];
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
      handleChange('activeMemoryMonths', next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              setIsCompressing(true);
              const processedBase64 = await processImage(file);
              handleChange('avatar', processedBase64);
              addToast('头像上传成功', 'success');
          } catch (error: any) { 
              addToast(error.message || '图片处理失败', 'error'); 
          } finally {
              setIsCompressing(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      }
  };
  
  // Re-implementing them briefly to ensure context validity
  const handleRefineMonth = async (year: string, month: string, rawText: string) => {
      if (!apiConfig.apiKey) { addToast('请先配置 API Key', 'error'); return; }
      const prompt = `Task: Summarize the following logs (${year}-${month}) into a concise memory. Language: Same as logs (Chinese). ${rawText.substring(0, 5000)}`;
      try {
          const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
              body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.3 })
          });
          if (!response.ok) throw new Error('API Request failed');
          const data = await response.json();
          const summary = data.choices[0].message.content.trim();
          const key = `${year}-${month}`;
          handleChange('refinedMemories', { ...(formData?.refinedMemories || {}), [key]: summary });
          addToast(`${year}年${month}月记忆精炼完成`, 'success');
      } catch (e: any) { addToast(`精炼失败: ${e.message}`, 'error'); }
  };
  const handleDeleteMemories = (ids: string[]) => { if (!formData) return; handleChange('memories', (formData.memories || []).filter(m => !ids.includes(m.id))); addToast(`已删除 ${ids.length} 条记忆`, 'success'); };
  const handleUpdateMemory = (id: string, newSummary: string) => { if (!formData) return; handleChange('memories', (formData.memories || []).map(m => m.id === id ? { ...m, summary: newSummary } : m)); addToast('记忆已更新', 'success'); };
  const handleExportPreview = () => { if (!formData) return; const mems = formData.memories as any[]; if (!mems || mems.length === 0) { addToast('暂无记忆数据可导出', 'info'); return; } const sortedMemories = [...mems].sort((a, b) => a.date.localeCompare(b.date)); let text = `【角色档案】\nName: ${formData.name}\nExported: ${new Date().toLocaleString()}\n\n`; if (formData.refinedMemories) { text += `=== 核心记忆 ===\n`; Object.entries(formData.refinedMemories).sort().forEach(([k, v]) => { text += `[${k}]: ${v}\n`; }); text += `\n=== 详细日志 ===\n`; } let currentYear = '', currentMonth = ''; sortedMemories.forEach(mem => { const match = mem.date.match(/(\d{4})[-/年](\d{1,2})/); if (match) { const y = match[1], m = match[2]; if (y !== currentYear) { text += `\n[ ${y}年 ]\n`; currentYear = y; currentMonth = ''; } if (m !== currentMonth) { text += `\n-- ${parseInt(m)}月 --\n\n`; currentMonth = m; } } text += `📅 ${mem.date} ${mem.mood ? `(#${mem.mood})` : ''}\n${mem.summary}\n\n--------------------------\n\n`; }); setExportText(text); setShowExportModal(true); navigator.clipboard.writeText(text).then(() => addToast('内容已自动复制到剪贴板', 'info')).catch(() => {}); };
  const handleNativeShare = async () => { if(!exportText) return; if (Capacitor.isNativePlatform()) { try { const fileName = `${formData?.name || 'character'}_memories.txt`; await Filesystem.writeFile({ path: fileName, data: exportText, directory: Directory.Cache, encoding: Encoding.UTF8 }); const uri = await Filesystem.getUri({ directory: Directory.Cache, path: fileName }); await Share.share({ title: '记忆档案', files: [uri.uri] }); } catch(e: any) { console.error("Native share failed", e); addToast('分享组件调起失败，请直接复制文本', 'error'); } } };
  const handleWebFileDownload = () => { const fileName = `${formData?.name || 'character'}_memories.txt`; const blob = new Blob([exportText], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); addToast('已触发浏览器下载', 'success'); };
  const handleImportMemories = async () => { if (!importText.trim() || !apiConfig.apiKey) { addToast('请检查输入内容或 API 设置', 'error'); return; } setIsProcessingMemory(true); setImportStatus('正在链接神经云端进行清洗...'); try { const prompt = `Task: Convert this text log into a JSON array. Format: [{ "date": "YYYY-MM-DD", "summary": "...", "mood": "..." }] Text: ${importText.substring(0, 8000)}`; const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` }, body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }) }); if (!response.ok) throw new Error(`HTTP Error: ${response.status}`); const data = await response.json(); let content = data.choices?.[0]?.message?.content || ''; content = content.replace(/```json/g, '').replace(/```/g, '').trim(); const firstBracket = content.indexOf('['); const lastBracket = content.lastIndexOf(']'); if (firstBracket !== -1 && lastBracket !== -1) { content = content.substring(firstBracket, lastBracket + 1); } let parsed; try { parsed = JSON.parse(content); } catch (e) { throw new Error('解析返回数据失败'); } let targetArray = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.data); if (Array.isArray(targetArray)) { const newMems = targetArray.map((m: any) => ({ id: `mem-${Date.now()}-${Math.random()}`, date: m.date || '未知', summary: m.summary || '无内容', mood: m.mood || '记录' })); handleChange('memories', [...(formData?.memories || []), ...newMems]); addToast(`成功导入 ${newMems.length} 条记忆`, 'success'); setShowImportModal(false); } else { throw new Error('结构错误'); } } catch (e: any) { setImportStatus(`错误: ${e.message || '未知错误'}`); addToast('记忆清洗失败', 'error'); } finally { setIsProcessingMemory(false); } };
  const handleBatchSummarize = async () => { if (!apiConfig.apiKey || !formData) return; setIsBatchProcessing(true); setBatchProgress('Initializing...'); try { const msgs = await DB.getMessagesByCharId(formData.id); const msgsByDate: Record<string, Message[]> = {}; msgs.forEach(m => { const d = new Date(m.timestamp); const year = d.getFullYear(); const month = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); const dateStr = `${year}-${month}-${day}`; if (batchRange.start && dateStr < batchRange.start) return; if (batchRange.end && dateStr > batchRange.end) return; if (!msgsByDate[dateStr]) msgsByDate[dateStr] = []; msgsByDate[dateStr].push(m); }); const dates = Object.keys(msgsByDate).sort(); const newMemories: MemoryFragment[] = []; for (let i = 0; i < dates.length; i++) { const date = dates[i]; setBatchProgress(`Processing ${date} (${i+1}/${dates.length})`); const dayMsgs = msgsByDate[date]; const rawLog = dayMsgs.map(m => { const time = new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}); return `[${time}] ${m.role === 'user' ? userProfile.name : formData.name}: ${m.content}`; }).join('\n'); const prompt = `系统: 你是 ${formData.name}。用户: ${userProfile.name}。任务: 阅读 ${date} 的聊天记录，生成一条简短的记忆摘要(第一人称,中文,1-3句话)。日志: ${rawLog.substring(0, 6000)}`; const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` }, body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], max_tokens: 4000, temperature: 0.5 }) }); if (response.ok) { const data = await response.json(); let summary = data.choices?.[0]?.message?.content || ''; if (summary) { newMemories.push({ id: `mem-${Date.now()}-${Math.random()}`, date: date, summary: summary.trim(), mood: 'auto' }); } } await new Promise(r => setTimeout(r, 500)); } handleChange('memories', [...(formData.memories || []), ...newMemories]); setBatchProgress('Done!'); setTimeout(() => { setIsBatchProcessing(false); setShowBatchModal(false); addToast(`Processed ${newMemories.length} days`, 'success'); }, 1000); } catch (e: any) { setBatchProgress(`Error: ${e.message}`); setIsBatchProcessing(false); } };

  // --- Impression Logic ---
  
  const handleGenerateImpression = async (type: 'initial' | 'update') => {
      // ... (Implementation kept same)
      if (!formData || !apiConfig.apiKey) {
          addToast('请先配置 API Key', 'error');
          return;
      }
      
      setIsGeneratingImpression(true);
      try {
          const charName = formData.name;
          const boundUser = userProfile;
          
          let messagesToAnalyze = "";
          const msgs = await DB.getMessagesByCharId(formData.id);
          const recentMsgs = msgs.slice(-100);
          const msgText = recentMsgs.map(m => `${m.role === 'user' ? boundUser.name : charName}: ${m.content}`).join('\n');
          
          if (msgText) messagesToAnalyze += `\n【最近的聊天记录】:\n${msgText}\n`;
          
          const mems = formData.memories || [];
          if (mems.length > 0) {
              const memText = mems.slice(-20).map(m => `[${m.date}] ${m.summary}`).join('\n');
              messagesToAnalyze += `\n【相关的过往记忆】:\n${memText}\n`;
          }

          const currentProfileJSON = formData.impression ? JSON.stringify(formData.impression, null, 2) : "null";
          const isInitialGeneration = type === 'initial' || !formData.impression;
          
          const summaryInstruction = isInitialGeneration 
              ? "用一段话（100字以内）概括你对TA的【宏观整体印象】。不要局限于最近的对话，而是定义TA本质上是个什么样的人，以及TA对你意味着什么。必须第一人称。"
              : "基于旧的总结，结合新发现，更新你对TA的【宏观整体印象】。请保持长期视角的连贯性，除非发生了重大转折，否则不要因为一两句闲聊就彻底推翻对TA的本质判断。必须第一人称。";
              
          const listInstruction = isInitialGeneration ? `"项目1", "项目2"` : `"保留旧项目", "新项目"`;
          const changesInstruction = isInitialGeneration ? "" : `"描述变化1", "描述变化2"`;

          const prompt = `
当前档案（你过去的观察）
\`\`\`json
${currentProfileJSON}
\`\`\`
${messagesToAnalyze}

【重要：语气与视角】
你【就是】"${charName}"。这份档案是你写的【私人笔记】。
因此，所有总结性的字段（如 \`core_values\`, \`summary\`, \`emotion_summary\` 等），【必须】使用你的第一人称（"我"）视角来撰写。

分析指令：四维画像更新 (第一人称视角)
根据【强制对比协议】和你自己的视角，分析新消息，并${isInitialGeneration ? '【生成】' : '【增量更新】'}以下JSON结构。

第一维：价值地图 (Value Map)
你对你家${boundUser?.name || 'TA'}的喜好、厌恶有没有什么新发现？
你觉得TA的【核心价值观】(core_values)是什么？（例如：我感觉TA很重视公平...）

第二维：情绪图谱 (Emotion Schema)
【情绪触发器】(triggers)：你注意到什么事会立刻让TA开心？什么话题会立刻让TA沉默或反感？
【压力信号】(stress_signals)：你发现TA在紧张或焦虑时，会表现出什么小动作或口头禅？
【舒适区】(comfort_zone)：你感觉TA在什么状态下最放松？

第三维：行为档案 (Behavior Profile)
【情绪总结】(emotion_summary)：你该如何总结TA${isInitialGeneration ? '的' : '最近的'}【整体情绪状态】？例如："我感觉TA最近对工作感到焦虑..."
【回应模式】(response_patterns)：你该如何总结TA在不同情绪下的典型回应方式？
【语气风格】(tone_style)：你如何评价TA的沟通风格？

第四维：性格核心 (Personality Core)
【性格特质】(observed_traits)：你观察到了TA的哪些具体性格特点？
【互动风格】(interaction_style)：TA在和你互动时，倾向于扮演什么角色？
【核心总结】(summary)：${summaryInstruction}

输出JSON结构v2.0（严格遵守, 不要用markdown代码块包裹，直接返回JSON）
{
  "version": 2.0,
  "lastUpdated": ${Date.now()},
  "value_map": {
    "likes": [${listInstruction}],
    "dislikes": [${listInstruction}],
    "core_values": "（【用你的语气】总结TA的核心价值观，例如：'我发现TA最看重的是...'）"
  },
  "behavior_profile": {
    "tone_style": "（总结的语气风格）",
    "emotion_summary": "（【用你的语气】总结TA的整体情绪，例如：'我感觉TA最近...'）",
    "response_patterns": "（总结的回应模式）"
  },
  "emotion_schema": {
    "triggers": { 
        "positive": [${listInstruction}],
        "negative": [${listInstruction}]
    },
    "comfort_zone": "（总结的舒适区描述）",
    "stress_signals": [${listInstruction}]
  },
  "personality_core": {
    "observed_traits": [${listInstruction}],
    "interaction_style": "（总结的互动风格）",
    "summary": "（你的核心总结：请站在全局角度，概括TA的本质和你对TA的根本看法。不要写成'今天他很开心'这种短期状态。）"
  },
  "observed_changes": [
    ${changesInstruction}
  ]
}`;

          const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
              body: JSON.stringify({
                  model: apiConfig.model,
                  messages: [{ role: "user", content: prompt }],
                  max_tokens: 4000, 
                  temperature: 0.5
              })
          });

          if (!response.ok) throw new Error('API Request Failed');
          const data = await response.json();
          let content = data.choices[0].message.content;
          
          content = content.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed: UserImpression = JSON.parse(content);
          
          handleChange('impression', parsed);
          addToast(isInitialGeneration ? '印象档案已生成' : '印象档案已更新', 'success');

      } catch (e: any) {
          console.error(e);
          addToast(`生成失败: ${e.message}`, 'error');
      } finally {
          setIsGeneratingImpression(false);
      }
  };

  const confirmDeleteCharacter = () => {
      if (deleteConfirmTarget) {
          deleteCharacter(deleteConfirmTarget);
          setDeleteConfirmTarget(null);
          addToast('连接已断开', 'success');
      }
  };

  // --- Character Card Import/Export ---

  const handleExportCard = () => {
      if (!formData) return;
      
      const { 
          id, memories, refinedMemories, activeMemoryMonths, impression, 
          ...cardProps 
      } = formData;

      const exportData: CharacterExportData = {
          ...cardProps,
          version: 1,
          type: 'sully_character_card'
      };

      // Check if bubble style is custom and embed it
      if (formData.bubbleStyle) {
          const customTheme = customThemes.find(t => t.id === formData.bubbleStyle);
          if (customTheme) {
              exportData.embeddedTheme = customTheme;
          }
      }

      const json = JSON.stringify(exportData, null, 2);
      
      // Web Download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${formData.name}_Card.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addToast('角色卡已生成并下载', 'success');
  };

  const handleImportCard = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const json = ev.target?.result as string;
              const data: CharacterExportData = JSON.parse(json);
              
              if (data.type !== 'sully_character_card') {
                  throw new Error('无效的角色卡文件');
              }

              // Restore Custom Theme if Embedded
              if (data.embeddedTheme) {
                  // Save theme first
                  // Check if theme with ID exists, maybe replace or ignore
                  const exists = customThemes.some(t => t.id === data.embeddedTheme!.id);
                  if (!exists) {
                      addCustomTheme(data.embeddedTheme);
                  }
              }

              const newChar: CharacterProfile = {
                  ...data,
                  id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Generate new unique ID
                  memories: [],
                  refinedMemories: {},
                  activeMemoryMonths: [],
                  embeddedTheme: undefined // Clean up key
              } as CharacterProfile;

              await DB.saveCharacter(newChar);
              // Trigger refresh via context action which updates state
              addCharacter(); // This adds a dummy character which forces re-render of list
              // A bit hacky: better to reload the list directly or addCharacter accepting params
              // Since context addCharacter is naive, let's just create it via DB then reload page or rely on DB sync
              // Actually, we can just update the characters list directly via state in context, but we don't have that exposed cleanly
              // Simplest way: Reload page or invoke a no-op update
              setTimeout(() => window.location.reload(), 500); 
              
              addToast(`角色 ${newChar.name} 导入成功`, 'success');

          } catch (err: any) {
              console.error(err);
              addToast(err.message || '导入失败', 'error');
          } finally {
              if (cardImportRef.current) cardImportRef.current.value = '';
          }
      };
      reader.readAsText(file);
  };

  return (
    <div className="h-full w-full bg-slate-50/30 font-light relative">
       {view === 'list' ? (
           <div className="flex flex-col h-full animate-fade-in">
               <div className="px-6 pt-12 pb-4 shrink-0 flex items-center justify-between">
                   <div><h1 className="text-2xl font-light text-slate-800 tracking-tight">神经链接</h1><p className="text-xs text-slate-400 mt-1">已建立 {characters.length} 个角色连接</p></div>
                   <div className="flex gap-2">
                        {/* Import Button */}
                        <button onClick={() => cardImportRef.current?.click()} className="p-2 rounded-full bg-white/40 hover:bg-white/80 transition-colors text-slate-600" title="导入角色卡">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                            </svg>
                        </button>
                        <input type="file" ref={cardImportRef} className="hidden" accept=".json" onChange={handleImportCard} />
                        
                        <button onClick={closeApp} className="p-2 rounded-full bg-white/40 hover:bg-white/80 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
                   </div>
               </div>
               <div className="flex-1 overflow-y-auto px-5 pb-20 no-scrollbar space-y-3">
                   {characters.map(char => (
                       <CharacterCard 
                           key={char.id} 
                           char={char} 
                           onClick={() => { setEditingId(char.id); setView('detail'); }} 
                           onDelete={(e) => { 
                               e.stopPropagation(); 
                               setDeleteConfirmTarget(char.id); 
                           }} 
                       />
                   ))}
                   <button onClick={addCharacter} className="w-full py-4 rounded-3xl border border-dashed border-slate-300 text-slate-400 text-sm hover:bg-white/30 transition-all flex items-center justify-center gap-2">
                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>新建链接
                   </button>
               </div>
           </div>
       ) : formData && (
           <div className="flex flex-col h-full animate-fade-in bg-slate-50/50 relative">
               <div className="h-28 bg-gradient-to-b from-white/90 to-transparent backdrop-blur-sm flex flex-col justify-end px-5 pb-2 shrink-0 z-40 sticky top-0">
                   <div className="flex justify-between items-center mb-3">
                       <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-white/60 flex items-center gap-1 text-slate-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg><span className="text-sm font-medium">列表</span></button>
                       <button onClick={() => { setActiveCharacterId(formData.id); openApp(AppID.Chat); }} className="text-xs px-3 py-1.5 bg-primary text-white rounded-full font-bold shadow-sm shadow-primary/30 flex items-center gap-1 active:scale-95 transition-transform"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926H16.5a.75.75 0 0 1 0 1.5H3.693l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" /></svg>发消息</button>
                   </div>
                   <div className="flex gap-6 text-sm font-medium text-slate-400 pl-1">
                       <button onClick={() => setDetailTab('identity')} className={`pb-2 transition-colors relative ${detailTab === 'identity' ? 'text-slate-800' : ''}`}>设定{detailTab === 'identity' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-full"></div>}</button>
                       <button onClick={() => setDetailTab('memory')} className={`pb-2 transition-colors relative ${detailTab === 'memory' ? 'text-slate-800' : ''}`}>记忆 ({(formData.memories || []).length}){detailTab === 'memory' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-full"></div>}</button>
                       <button onClick={() => setDetailTab('impression')} className={`pb-2 transition-colors relative ${detailTab === 'impression' ? 'text-slate-800' : ''}`}>印象{detailTab === 'impression' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-full"></div>}</button>
                   </div>
               </div>
               <div className="flex-1 overflow-y-auto p-5 no-scrollbar pb-10">
                   {detailTab === 'identity' && (
                       <div className="space-y-6 animate-fade-in">
                           <div className="flex items-center gap-5">
                               <div className="relative group cursor-pointer w-24 h-24 shrink-0" onClick={() => fileInputRef.current?.click()}>
                                   <div className="w-full h-full rounded-[2rem] shadow-md bg-white border-4 border-white overflow-hidden relative"><img src={formData.avatar} className={`w-full h-full object-cover ${isCompressing ? 'opacity-50 blur-sm' : ''}`} alt="A" /></div>
                                   <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                               </div>
                               <div className="flex-1 space-y-3">
                                   <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} className="w-full bg-transparent py-1 text-xl font-medium text-slate-800 border-b border-slate-200" placeholder="名称" />
                                   <input value={formData.description} onChange={(e) => handleChange('description', e.target.value)} className="w-full bg-transparent py-1 text-sm text-slate-500 border-b border-slate-200" placeholder="描述" />
                               </div>
                           </div>
                           
                           <div>
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">核心指令 (System Prompt)</label>
                               <textarea value={formData.systemPrompt} onChange={(e) => handleChange('systemPrompt', e.target.value)} className="w-full h-40 bg-white rounded-3xl p-5 text-sm shadow-sm resize-none focus:ring-1 focus:ring-primary/20 transition-all" placeholder="设定..." />
                           </div>

                           <div>
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">世界观 / 设定补充 (Worldview & Lore)</label>
                               <textarea 
                                    value={formData.worldview || ''} 
                                    onChange={(e) => handleChange('worldview', e.target.value)} 
                                    className="w-full h-40 bg-white rounded-3xl p-5 text-sm shadow-sm resize-none focus:ring-1 focus:ring-primary/20 transition-all" 
                                    placeholder="在这个世界里，魔法是存在的..." 
                                />
                           </div>

                           {/* Export Card Button */}
                           <div className="pt-4">
                               <button 
                                   onClick={handleExportCard}
                                   className="w-full py-4 bg-slate-800 text-white rounded-2xl text-xs font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-slate-700 active:scale-95 transition-all"
                               >
                                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                       <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                                   </svg>
                                   分享 / 导出角色卡
                               </button>
                               <p className="text-[10px] text-slate-400 text-center mt-2">导出内容不包含记忆库和聊天记录</p>
                           </div>
                       </div>
                   )}
                   
                   {detailTab === 'memory' && (
                       <div className="space-y-4 animate-fade-in">
                           <div className="flex justify-center gap-2 mb-4">
                               <button onClick={() => setShowBatchModal(true)} className="px-4 py-2 bg-white rounded-full text-xs font-semibold text-slate-500 shadow-sm border border-slate-100">批量总结 (Auto-Journal)</button>
                               <button onClick={() => setShowImportModal(true)} className="px-4 py-2 bg-white rounded-full text-xs font-semibold text-slate-500 shadow-sm border border-slate-100">导入/清洗</button>
                               <button onClick={handleExportPreview} className="px-4 py-2 bg-white rounded-full text-xs font-semibold text-slate-500 shadow-sm border border-slate-100">备份</button>
                           </div>
                           <MemoryArchivist 
                               memories={formData.memories || []} 
                               refinedMemories={formData.refinedMemories || {}} 
                               activeMemoryMonths={formData.activeMemoryMonths || []}
                               onRefine={handleRefineMonth}
                               onDeleteMemories={handleDeleteMemories}
                               onUpdateMemory={handleUpdateMemory}
                               onToggleActiveMonth={handleToggleActiveMonth}
                           />
                       </div>
                   )}

                   {detailTab === 'impression' && (
                       <ImpressionPanel 
                           impression={formData.impression}
                           isGenerating={isGeneratingImpression}
                           onGenerate={handleGenerateImpression}
                           onUpdateImpression={(newImp) => handleChange('impression', newImp)}
                       />
                   )}
               </div>
           </div>
       )}
       
       <Modal isOpen={showImportModal} title="记忆导入/清洗" onClose={() => setShowImportModal(false)} footer={<><button onClick={() => setShowImportModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl">取消</button><button onClick={handleImportMemories} disabled={isProcessingMemory} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg shadow-primary/30 flex items-center justify-center gap-2">{isProcessingMemory && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}{isProcessingMemory ? '处理中...' : '开始执行'}</button></>}>
           <div className="space-y-3"><div className="text-xs text-slate-400 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">AI 将自动整理乱序文本为记忆档案。</div>{importStatus && <div className="text-xs text-primary font-medium">{importStatus}</div>}<textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="在此粘贴文本..." className="w-full h-32 bg-slate-100 border-none rounded-2xl px-4 py-3 text-sm text-slate-700 resize-none focus:ring-2 focus:ring-primary/20 transition-all"/></div>
       </Modal>

       <Modal isOpen={showBatchModal} title="自动日记生成" onClose={() => setShowBatchModal(false)} footer={
           isBatchProcessing ? 
           <div className="w-full py-3 bg-slate-100 text-primary font-bold rounded-2xl text-center flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>{batchProgress}</div> :
           <button onClick={handleBatchSummarize} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">开始生成</button>
       }>
           <div className="space-y-3">
               <p className="text-xs text-slate-400">将遍历所有聊天记录，按天生成日记风格的记忆总结。</p>
               <div className="flex gap-2">
                   <div className="flex-1"><label className="text-[10px] uppercase text-slate-400 font-bold">开始日期 (可选)</label><input type="date" value={batchRange.start} onChange={e => setBatchRange({...batchRange, start: e.target.value})} className="w-full bg-slate-100 rounded-xl px-3 py-2 text-xs" /></div>
                   <div className="flex-1"><label className="text-[10px] uppercase text-slate-400 font-bold">结束日期 (可选)</label><input type="date" value={batchRange.end} onChange={e => setBatchRange({...batchRange, end: e.target.value})} className="w-full bg-slate-100 rounded-xl px-3 py-2 text-xs" /></div>
               </div>
           </div>
       </Modal>

       <Modal isOpen={showExportModal} title="导出文本" onClose={() => setShowExportModal(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => { navigator.clipboard.writeText(exportText); addToast('已复制', 'success'); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">复制全文</button>{Capacitor.isNativePlatform() ? (<button onClick={handleNativeShare} className="flex-1 py-3 bg-slate-800 text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" /></svg>文件分享</button>) : (<button onClick={handleWebFileDownload} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>下载文本</button>)}</div>}>
           <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 space-y-2"><div className="text-[10px] text-slate-400">已自动复制到剪贴板。如果分享失败，请直接手动复制。</div><textarea value={exportText} readOnly className="w-full h-40 bg-transparent border-none text-[10px] font-mono text-slate-600 resize-none focus:ring-0 leading-relaxed select-all" onClick={(e) => e.currentTarget.select()}/></div>
       </Modal>

        {/* Delete Confirmation Modal */}
        <Modal 
            isOpen={!!deleteConfirmTarget} 
            title="断开连接" 
            onClose={() => setDeleteConfirmTarget(null)} 
            footer={<div className="flex gap-2 w-full"><button onClick={() => setDeleteConfirmTarget(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">保留</button><button onClick={confirmDeleteCharacter} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认断开</button></div>}
        >
            <div className="flex flex-col items-center gap-3 py-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                <p className="text-sm text-slate-600 text-center leading-relaxed">
                    确定要删除与该角色的所有连接吗？<br/>
                    <span className="text-xs text-red-400 font-bold">该操作不可恢复，记忆将被清空。</span>
                </p>
            </div>
        </Modal>
    </div>
  );
};
export default Character;