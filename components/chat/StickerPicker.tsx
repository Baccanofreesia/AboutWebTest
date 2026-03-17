import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StickerParser, StickerItem } from '../../utils/stickerParser';
import { fsBridge } from '../../utils/fsBridge';

// ── Local image loader hook ──
const useLocalSrc = (url: string, workspaceRootPath: string) => {
    const [src, setSrc] = useState<string>('');
    useEffect(() => {
        if (!url) { setSrc(''); return; }
        if (!url.startsWith('local://')) { setSrc(url); return; }
        if (!workspaceRootPath) { setSrc(''); return; }
        setSrc(''); // reset on url change
        const relPath = url.replace('local://', '');
        const ext = relPath.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
                : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
                    : 'image/png';
        fsBridge.readFileBase64(workspaceRootPath, relPath, true)
            .then(base64 => setSrc(`data:${mime};base64,${base64}`))
            .catch(() => setSrc(''));
    }, [url, workspaceRootPath]);
    return src;
};

// ── Single sticker thumbnail (hook 不能在循环里调用，抽成子组件) ──
const StickerThumb: React.FC<{
    item: StickerItem;
    workspaceRootPath: string;
    onSelect: (item: StickerItem) => void;
    onDeleteFav?: (item: StickerItem) => void;
    onDeleteItem?: (item: StickerItem) => void;
    onCacheUpdate?: (item: StickerItem) => void;
}> = ({ item, workspaceRootPath, onSelect, onDeleteFav, onDeleteItem, onCacheUpdate }) => {
    const src = useLocalSrc(item.url, workspaceRootPath);
    const canDeleteFav = !!onDeleteFav && item.category === '收藏';
    const canDeleteItem = !!onDeleteItem && item.category !== '收藏';
    return (
        <div className="flex flex-col gap-1.5 items-center">
            <button
                onClick={() => onSelect(item)}
                className="aspect-square w-full bg-white rounded-xl p-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-slate-100 hover:border-primary/40 active:scale-95 transition-all relative group/btn"
            >
                {src ? (
                    <img src={src} className="w-full h-full object-contain pointer-events-none" alt={item.name} loading="lazy" />
                ) : (
                    <div className="w-full h-full rounded-lg bg-slate-100 animate-pulse" />
                )}
                {(canDeleteFav || canDeleteItem) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canDeleteFav) {
                                onDeleteFav?.(item);
                                onCacheUpdate?.(item);
                            } else if (canDeleteItem) {
                                onDeleteItem?.(item);
                            }
                        }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/40 backdrop-blur-md text-white rounded-full hidden group-hover/btn:flex items-center justify-center hover:bg-red-500 transition-colors"
                    >
                        <span className="text-[12px] leading-none">×</span>
                    </button>
                )}
            </button>
            <span className="text-[10px] text-slate-400 font-medium truncate w-full text-center px-0.5">{item.name}</span>
        </div>
    );
};

// ── Add by URL modal ──
const AddByUrlModal: React.FC<{
    workspaceRootPath: string;
    onSuccess: () => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error') => void;
}> = ({ workspaceRootPath, onSuccess, onClose, addToast }) => {
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAdd = async () => {
        const trimUrl = url.trim();
        const trimName = name.trim();
        if (!trimUrl) { addToast('请输入图片 URL', 'error'); return; }
        if (!trimName) { addToast('请输入表情名称', 'error'); return; }
        setLoading(true);
        try {
            const ok = await StickerParser.favoriteSticker(workspaceRootPath, trimName, trimUrl, true);
            if (ok) {
                addToast(`"${trimName}" 已加入收藏`, 'success');
                onSuccess();
                onClose();
            } else {
                addToast('下载失败，请检查 URL 是否可访问', 'error');
            }
        } catch (e) {
            addToast(e instanceof Error ? e.message : '下载失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-t-2xl">
            <div className="bg-white rounded-2xl shadow-xl p-5 mx-4 w-full max-w-sm flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[15px]">通过 URL 添加收藏</span>
                    <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors text-lg leading-none">×</button>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-slate-500">图片 URL</label>
                    <input
                        type="url"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://example.com/sticker.gif"
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-primary/50 focus:bg-white transition-all"
                        autoFocus
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-slate-500">表情名称</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="例如：委屈猫猫"
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-primary/50 focus:bg-white transition-all"
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                </div>

                <div className="flex gap-2 pt-1">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 transition-colors">
                        取消
                    </button>
                    <button
                        onClick={handleAdd}
                        disabled={loading}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                下载中
                            </>
                        ) : '确认添加'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Main component ──
interface StickerPickerProps {
    workspaceRootPath: string;
    onSelect: (item: StickerItem) => void;
    onDeleteFav?: (item: StickerItem) => void;
    addToast: (msg: string, type: 'success' | 'error') => void;
}

const StickerPicker: React.FC<StickerPickerProps> = ({ workspaceRootPath, onSelect, onDeleteFav, addToast }) => {
    const [categories, setCategories] = useState<string[]>(['收藏']);
    const [activeCategory, setActiveCategory] = useState<string>('收藏');
    const [cache, setCache] = useState<Record<string, StickerItem[]>>({});
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddUrl, setShowAddUrl] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cacheRef = useRef<Record<string, StickerItem[]>>({});
    const activeCategoryRef = useRef(activeCategory);
    const categoryUpdatedAtRef = useRef<Record<string, number>>({});

    useEffect(() => { activeCategoryRef.current = activeCategory; }, [activeCategory]);
    useEffect(() => { cacheRef.current = cache; }, [cache]);

    const refreshCategories = useCallback(async () => {
        if (!workspaceRootPath) return;
        try {
            const cats = await StickerParser.listCategories(workspaceRootPath);
            const finalCats = ['收藏', ...cats.filter(c => c !== '收藏')];
            setCategories(finalCats);
            if (!finalCats.includes(activeCategoryRef.current)) setActiveCategory('收藏');
        } catch { }
    }, [workspaceRootPath]);

    useEffect(() => {
        refreshCategories();
        const timer = setInterval(refreshCategories, 3000);
        return () => clearInterval(timer);
    }, [refreshCategories]);

    const getCategoryUpdatedAt = useCallback(async (cat: string) => {
        if (!workspaceRootPath || cat === '收藏') return null;
        try {
            const items = await fsBridge.readDir(workspaceRootPath, 'stickers/', true);
            const file = items.find(i => i.type === 'file' && i.name === `${cat}.txt`);
            return file?.updatedAt || null;
        } catch {
            return null;
        }
    }, [workspaceRootPath]);

    const loadCategory = useCallback(async (cat: string, opts?: { force?: boolean; resetSearch?: boolean }) => {
        const force = !!opts?.force;
        const resetSearch = opts?.resetSearch !== false;
        setActiveCategory(cat);
        if (resetSearch) setSearchQuery(''); // 切 tab 时清搜索
        if (!force && cacheRef.current[cat]) return;
        setLoading(true);
        try {
            const set = await StickerParser.loadStickerSet(workspaceRootPath, cat);
            setCache(prev => {
                const next = { ...prev, [cat]: set.items };
                cacheRef.current = next;
                return next;
            });
            const updatedAt = await getCategoryUpdatedAt(cat);
            if (updatedAt) categoryUpdatedAtRef.current[cat] = updatedAt;
        } finally {
            setLoading(false);
        }
    }, [workspaceRootPath, getCategoryUpdatedAt]);

    useEffect(() => {
        loadCategory('收藏');
    }, [workspaceRootPath]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !workspaceRootPath) return;
        setLoading(true);
        try {
            const content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = reject;
                reader.readAsText(file);
            });
            await StickerParser.normalizeAndSave(workspaceRootPath, file.name, content);
            await new Promise(r => setTimeout(r, 200));
            const newCatName = file.name.replace(/\.[^/.]+$/, '');
            addToast(`分类 "${newCatName}" 导入成功`, 'success');
            setCache({});
            cacheRef.current = {};
            refreshCategories();
            await loadCategory(newCatName);
        } catch (err) {
            addToast(err instanceof Error ? err.message : '导入失败', 'error');
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteCategory = async (e: React.MouseEvent, cat: string) => {
        e.stopPropagation();
        if (cat === '收藏') return;
        if (!window.confirm(`确定要删除表情分类 "${cat}" 吗？此操作不可撤销。`)) return;
        const success = await StickerParser.deleteCategory(workspaceRootPath, cat);
        if (success) {
            setCategories(prev => prev.filter(c => c !== cat));
            setCache(prev => {
                const next = { ...prev };
                delete next[cat];
                cacheRef.current = next;
                return next;
            });
            if (activeCategoryRef.current === cat) await loadCategory('收藏');
        }
    };

    const handleDeleteSticker = useCallback(async (item: StickerItem) => {
        if (!workspaceRootPath) return;
        if (item.category === '收藏') return;
        if (!window.confirm(`确定要删除表情包 "${item.name}" 吗？该操作会同步移除分类文件中的这一行。`)) return;
        const success = await StickerParser.deleteStickerItem(workspaceRootPath, item.category, item.url);
        if (success) {
            addToast('表情包已删除', 'success');
            setCache(prev => {
                const items = prev[item.category] || [];
                const nextItems = items.filter(i => i.url !== item.url);
                const next = { ...prev, [item.category]: nextItems };
                cacheRef.current = next;
                return next;
            });
        } else {
            addToast('删除失败', 'error');
        }
    }, [workspaceRootPath, addToast]);

    useEffect(() => {
        if (!workspaceRootPath) return;
        const timer = setInterval(async () => {
            const cat = activeCategoryRef.current;
            if (!cat || cat === '收藏') return;
            const updatedAt = await getCategoryUpdatedAt(cat);
            if (!updatedAt) return;
            const prev = categoryUpdatedAtRef.current[cat] || 0;
            if (updatedAt > prev) {
                categoryUpdatedAtRef.current[cat] = updatedAt;
                await loadCategory(cat, { force: true, resetSearch: false });
            }
        }, 3000);
        return () => clearInterval(timer);
    }, [workspaceRootPath, getCategoryUpdatedAt, loadCategory]);

    // 搜索过滤 — 在当前 tab 的缓存里做关键词匹配
    const allItems = cache[activeCategory] || [];
    const currentItems = searchQuery.trim()
        ? allItems.filter(item =>
            item.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : allItems;

    const showEmpty = !loading && currentItems.length === 0;

    return (
        <div className="flex flex-col h-full bg-white/95 backdrop-blur-2xl relative">
            <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.doc,.docx,.md" onChange={handleImport} />

            {/* URL 添加弹窗 */}
            {showAddUrl && (
                <AddByUrlModal
                    workspaceRootPath={workspaceRootPath}
                    onClose={() => setShowAddUrl(false)}
                    addToast={addToast}
                    onSuccess={() => {
                        // 清收藏缓存，强制重新加载
                        setCache(prev => {
                            const next = { ...prev };
                            delete next['收藏'];
                            cacheRef.current = next;
                            return next;
                        });
                        loadCategory('收藏');
                    }}
                />
            )}

            {/* 搜索框 */}
            <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-400 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={`搜索「${activeCategory === '收藏' ? '收藏' : activeCategory}」中的表情…`}
                        className="flex-1 bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center text-white text-[10px] leading-none shrink-0">×</button>
                    )}
                </div>
            </div>

            {/* Sticker Grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-3 no-scrollbar min-h-0 bg-slate-50/50">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="w-8 h-8 border-[3px] border-primary/20 border-t-primary rounded-full animate-spin" />
                    </div>
                ) : showEmpty ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-70 pt-8">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shadow-inner">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
                            </svg>
                        </div>
                        <span className="text-xs font-bold tracking-tight">
                            {searchQuery ? `没有匹配"${searchQuery}"的表情` : activeCategory === '收藏' ? '收藏夹空空如也' : '该分类暂无有效表情链接'}
                        </span>
                    </div>
                ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {/* 收藏 tab 第一格：+ 按钮 */}
                        {activeCategory === '收藏' && !searchQuery && (
                            <div className="flex flex-col gap-1.5 items-center">
                                <button
                                    onClick={() => setShowAddUrl(true)}
                                    className="aspect-square w-full bg-white rounded-xl border-2 border-dashed border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-95 transition-all flex items-center justify-center group/add"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-slate-300 group-hover/add:text-primary transition-colors">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                    </svg>
                                </button>
                                <span className="text-[10px] text-slate-300 font-medium">添加</span>
                            </div>
                        )}

                        {currentItems.map((item, idx) => (
                            <StickerThumb
                                key={`${item.category}-${idx}`}
                                item={item}
                                workspaceRootPath={workspaceRootPath}
                                onSelect={onSelect}
                                onDeleteFav={onDeleteFav}
                                onDeleteItem={handleDeleteSticker}
                                onCacheUpdate={(deleted) => {
                                    setCache(prev => {
                                        const next = { ...prev, '收藏': prev['收藏']?.filter(i => i.url !== deleted.url) ?? [] };
                                        cacheRef.current = next;
                                        return next;
                                    });
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Tab Bar */}
            <div className="h-[52px] border-t border-slate-200/50 bg-white flex items-center px-1 relative z-10 shrink-0">
                <div className="flex flex-1 items-center h-full overflow-x-auto no-scrollbar gap-0.5 px-1">
                    {/* Import Button */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-primary active:scale-90 transition-all"
                        title="导入表情包"
                    >
                        <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-100/50 shadow-sm hover:shadow-md hover:border-primary/20 transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                        </div>
                    </button>

                    {categories.map(cat => (
                        <div key={cat} className="relative flex-shrink-0 group/tab">
                            <button
                                onClick={() => loadCategory(cat)}
                                className={`min-w-[56px] px-3 h-11 rounded-lg transition-all flex items-center justify-center ${activeCategory === cat ? 'bg-slate-100/80 text-primary' : 'text-slate-400 hover:bg-slate-50'
                                    }`}
                            >
                                <span className={`text-[13px] font-bold tracking-tight whitespace-nowrap transition-transform ${activeCategory === cat ? 'scale-105' : 'scale-100 opacity-80'
                                    }`}>
                                    {cat === '收藏' ? '❤️' : cat}
                                </span>
                                {activeCategory === cat && (
                                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                                )}
                            </button>
                            {cat !== '收藏' && (
                                <button
                                    onClick={(e) => handleDeleteCategory(e, cat)}
                                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-200 text-slate-500 hidden group-hover/tab:flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors border border-white z-10 leading-none text-[10px]"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                <div className="absolute right-1 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
            </div>
        </div>
    );
};

export default StickerPicker;
