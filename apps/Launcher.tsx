import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import AppIcon from '../components/os/AppIcon';
import { DB } from '../utils/db';
import { CharacterProfile, AppConfig } from '../types';
import { motion, AnimatePresence } from 'framer-motion';

const APPS_PER_PAGE = 20;
const GRID_COLS = 4;
const LONG_PRESS_MS = 500;
const EDGE_ZONE_PX = 56;
const EDGE_FLIP_MS = 650;

const chunk = <T,>(arr: T[], n: number): T[][] => {
    if (arr.length === 0) return [[]];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
};

const Launcher: React.FC = () => {
    const { openApp, virtualTime, characters, activeCharacterId, theme, lastMsgTimestamp, isDataLoaded } = useOS();
    const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
    const [lastMessage, setLastMessage] = useState('');

    const [dynamicApps, setDynamicApps] = useState<AppConfig[]>([]);
    const [appPages, setAppPages] = useState<string[][]>([[]]);
    const [previewPages, setPreviewPages] = useState<string[][] | null>(null);

    const [currentPage, setCurrentPage] = useState(0);
    const [containerW, setContainerW] = useState<number>(window.innerWidth);

    const [isEditMode, setIsEditMode] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
    const [showGhostPage, setShowGhostPage] = useState(false);
    const [isOverGhostPage, setIsOverGhostPage] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const bootedRef = useRef(false);
    const hasLoadedLayoutRef = useRef(false);
    const initializedRef = useRef(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressStart = useRef<[number, number]>([0, 0]);
    const longPressMoved = useRef(false);
    const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gridRefs = useRef<(HTMLDivElement | null)[]>([]);

    const appPagesRef = useRef<string[][]>([[]]);
    const draggingIdRef = useRef<string | null>(null);
    const currentPageRef = useRef(0);
    const showGhostRef = useRef(false);
    const isOverGhostRef = useRef(false);
    const previewPagesRef = useRef<string[][] | null>(null);
    const dropTargetPageRef = useRef(0);

    useEffect(() => { appPagesRef.current = appPages; }, [appPages]);
    useEffect(() => { draggingIdRef.current = draggingId; }, [draggingId]);
    useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
    useEffect(() => { showGhostRef.current = showGhostPage; }, [showGhostPage]);
    useEffect(() => { isOverGhostRef.current = isOverGhostPage; }, [isOverGhostPage]);
    useEffect(() => { previewPagesRef.current = previewPages; }, [previewPages]);

    useEffect(() => {
        const updateWidth = () => {
            const measured = scrollRef.current?.clientWidth ?? window.innerWidth;
            setContainerW(measured || window.innerWidth);
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, []);

    useEffect(() => {
        const loadDynamicApps = async () => {
            try {
                const agentModules = (import.meta as any).glob('./agent_apps/*.tsx');
                const apps: AppConfig[] = [];
                for (const path in agentModules) {
                    const fileName = path.split('/').pop()?.replace('.tsx', '');
                    if (fileName) {
                        apps.push({
                            id: fileName as any,
                            name: fileName,
                            icon: 'Browser',
                            color: 'bg-gradient-to-br from-indigo-500 to-purple-600'
                        });
                    }
                }
                setDynamicApps(apps);
            } catch (e) {
                console.error('Failed to load agent apps', e);
            }
        };
        loadDynamicApps();
    }, []);

    useEffect(() => {
        const allApps = [...INSTALLED_APPS.filter(app => !DOCK_APPS.includes(app.id as any)), ...dynamicApps];
        const allIds = allApps.map(a => a.id);

        const normalizePages = (pages: string[][]) => {
            const cleaned = pages.map(page => page.filter(id => allIds.includes(id as any)));
            const nonEmpty = cleaned.filter(page => page.length > 0);
            if (nonEmpty.length === 0) return [[]];
            return nonEmpty;
        };

        if (!initializedRef.current) {
            let pages: string[][] = [[]];
            const savedLayout = localStorage.getItem('sully_app_layout');
            if (savedLayout) {
                try {
                    const parsed = JSON.parse(savedLayout);
                    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
                        pages = parsed as string[][];
                    } else if (Array.isArray(parsed)) {
                        pages = chunk(parsed as string[], APPS_PER_PAGE);
                    }
                } catch {
                    pages = [[]];
                }
            } else if (allIds.length > 0) {
                pages = chunk(allIds, APPS_PER_PAGE);
            }

            pages = normalizePages(pages);
            const existing = pages.flat();
            const missing = allIds.filter(id => !existing.includes(id));
            if (missing.length > 0) {
                const next = pages.map(page => [...page]);
                next[next.length - 1].push(...missing);
                pages = next;
            }
            setAppPages(pages);
            hasLoadedLayoutRef.current = true;
            initializedRef.current = true;
        } else {
            setAppPages(prev => {
                const normalized = normalizePages(prev);
                const existing = normalized.flat();
                const missing = allIds.filter(id => !existing.includes(id));
                if (missing.length === 0) return normalized;
                const next = normalized.map(page => [...page]);
                next[next.length - 1].push(...missing);
                return next;
            });
        }

        if (!bootedRef.current) {
            bootedRef.current = true;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (scrollRef.current) {
                        scrollRef.current.scrollLeft = 0;
                    }
                    setCurrentPage(0);
                });
            });
        }
    }, [dynamicApps]);

    useEffect(() => {
        if (!hasLoadedLayoutRef.current) return;
        const normalized = appPages.filter(page => page.length > 0);
        localStorage.setItem('sully_app_layout', JSON.stringify(normalized.length > 0 ? normalized : [[]]));
    }, [appPages]);

    const persistLayoutNow = useCallback((pages: string[][]) => {
        const normalized = pages.filter(page => page.length > 0);
        const finalPages = normalized.length > 0 ? normalized : [[]];
        appPagesRef.current = finalPages;
        localStorage.setItem('sully_app_layout', JSON.stringify(finalPages));
    }, []);

    useEffect(() => {
        if (!isDataLoaded || characters.length === 0) return;
        const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
        setWidgetChar(targetChar);
        const loadMsg = async () => {
            const msgs = await DB.getMessagesByCharId(targetChar.id);
            if (msgs.length > 0) {
                const last = msgs.filter(m => m.role !== 'system').pop();
                if (last) {
                    setLastMessage(last.content.replace(/\[.*?\]/g, '').trim() || (last.type === 'image' ? '[图片]' : last.type === 'video' ? '[视频]' : '[消息]'));
                } else {
                    setLastMessage(targetChar.description || 'System Ready.');
                }
            } else {
                setLastMessage(targetChar.description || 'System Ready.');
            }
        };
        loadMsg();
    }, [characters, activeCharacterId, lastMsgTimestamp, isDataLoaded]);

    const displayPages = previewPages ?? appPages;
    const totalDots = displayPages.length + 1 + (showGhostPage ? 1 : 0);

    const slotIndexAt = useCallback((clientX: number, clientY: number, gridEl: HTMLDivElement, itemCount: number) => {
        const rect = gridEl.getBoundingClientRect();
        const colW = rect.width / GRID_COLS;
        const rowH = colW * 1.4;
        const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((clientX - rect.left) / colW)));
        const row = Math.max(0, Math.floor((clientY - rect.top) / rowH));
        return Math.min(row * GRID_COLS + col, itemCount);
    }, []);

    const computePreview = useCallback((clientX: number, clientY: number, pageIdx: number) => {
        const id = draggingIdRef.current;
        if (!id) return;
        const base = appPagesRef.current.map(page => page.filter(appId => appId !== id));
        while (base.length <= pageIdx) {
            base.push([]);
        }
        const gridEl = gridRefs.current[pageIdx];
        if (!gridEl) return;
        const slotIdx = slotIndexAt(clientX, clientY, gridEl, base[pageIdx].length);
        const next = base.map(page => [...page]);
        next[pageIdx].splice(slotIdx, 0, id);
        setPreviewPages(next);
        dropTargetPageRef.current = pageIdx;
    }, [slotIndexAt]);

    const clearLongPress = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const clearEdgeTimer = useCallback(() => {
        if (edgeTimer.current) {
            clearTimeout(edgeTimer.current);
            edgeTimer.current = null;
        }
    }, []);

    const endDrag = useCallback(() => {
        clearEdgeTimer();
        let finalPage = currentPageRef.current;
        if (showGhostRef.current && isOverGhostRef.current && draggingIdRef.current) {
            const id = draggingIdRef.current;
            const base = appPagesRef.current.map(page => page.filter(appId => appId !== id)).filter(page => page.length > 0);
            const next = base.length > 0 ? base : [[]];
            next.push([id]);
            persistLayoutNow(next);
            setAppPages(next);
            finalPage = Math.max(0, next.length - 1);
        } else if (previewPagesRef.current) {
            const normalized = previewPagesRef.current.filter(page => page.length > 0);
            const next = normalized.length > 0 ? normalized : [[]];
            persistLayoutNow(next);
            setAppPages(next);
            finalPage = Math.max(0, Math.min(dropTargetPageRef.current, next.length - 1));
        }
        setPreviewPages(null);
        setDraggingId(null);
        setGhostPos(null);
        setShowGhostPage(false);
        setIsOverGhostPage(false);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const scroll = scrollRef.current;
                if (!scroll || containerW <= 0) return;
                const targetLeft = finalPage * containerW;
                scroll.scrollTo({ left: targetLeft, behavior: 'auto' });
                setCurrentPage(finalPage);
            });
        });
    }, [clearEdgeTimer, persistLayoutNow]);

    const startDrag = useCallback((id: string, x: number, y: number) => {
        setIsEditMode(true);
        setDraggingId(id);
        setGhostPos({ x, y });
        setPreviewPages(null);
        dropTargetPageRef.current = currentPageRef.current;
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent, appId: string) => {
        longPressStart.current = [e.clientX, e.clientY];
        longPressMoved.current = false;
        if (isEditMode) {
            startDrag(appId, e.clientX, e.clientY);
            return;
        }
        longPressTimer.current = setTimeout(() => {
            if (!longPressMoved.current) {
                startDrag(appId, longPressStart.current[0], longPressStart.current[1]);
            }
        }, LONG_PRESS_MS);
    }, [isEditMode, startDrag]);

    const onPointerMovePre = useCallback((e: React.PointerEvent) => {
        if (!longPressTimer.current) return;
        if (Math.hypot(e.clientX - longPressStart.current[0], e.clientY - longPressStart.current[1]) > 8) {
            longPressMoved.current = true;
            clearLongPress();
        }
    }, [clearLongPress]);

    useEffect(() => {
        if (!draggingId) return;

        const totalAppPages = () => Math.max(1, appPagesRef.current.length);

        const onMove = (e: PointerEvent) => {
            setGhostPos({ x: e.clientX, y: e.clientY });
            const nearRight = e.clientX > window.innerWidth - EDGE_ZONE_PX;
            const nearLeft = e.clientX < EDGE_ZONE_PX;

            if ((nearRight || nearLeft) && !edgeTimer.current) {
                edgeTimer.current = setTimeout(() => {
                    edgeTimer.current = null;
                    const scroll = scrollRef.current;
                    if (!scroll) return;
                    const pg = currentPageRef.current;
                    if (nearRight) {
                        const maxAppPage = totalAppPages() - 1;
                        if (pg >= maxAppPage && !showGhostRef.current) {
                            setShowGhostPage(true);
                            setTimeout(() => {
                                scroll.scrollTo({ left: (pg + 1) * containerW, behavior: 'smooth' });
                            }, 40);
                        } else {
                            const target = Math.min(pg + 1, maxAppPage);
                            scroll.scrollTo({ left: target * containerW, behavior: 'smooth' });
                        }
                    } else {
                        const target = Math.max(0, pg - 1);
                        scroll.scrollTo({ left: target * containerW, behavior: 'smooth' });
                    }
                }, EDGE_FLIP_MS);
            } else if (!nearRight && !nearLeft) {
                clearEdgeTimer();
            }

            const scroll = scrollRef.current;
            if (!scroll || containerW === 0) return;
            const pg = Math.round(scroll.scrollLeft / containerW);
            const overGhost = showGhostRef.current && (pg >= totalAppPages() || nearRight);
            if (isOverGhostRef.current !== overGhost) {
                setIsOverGhostPage(overGhost);
            }
            if (overGhost) {
                dropTargetPageRef.current = totalAppPages();
                return;
            }
            const targetPage = Math.max(0, Math.min(pg, totalAppPages() - 1));
            computePreview(e.clientX, e.clientY, targetPage);
        };

        const onVisibility = () => {
            if (document.hidden) {
                endDrag();
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        window.addEventListener('blur', endDrag);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
            window.removeEventListener('blur', endDrag);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [draggingId, computePreview, clearEdgeTimer, endDrag, containerW]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const width = containerW || e.currentTarget.clientWidth || 1;
        const index = Math.round(e.currentTarget.scrollLeft / width);
        if (index !== currentPage) {
            setCurrentPage(index);
        }
    }, [containerW, currentPage]);

    const handleShellTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isEditMode || draggingIdRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-app-icon="true"]')) return;
        persistLayoutNow(appPagesRef.current);
        setIsEditMode(false);
    }, [isEditMode, persistLayoutNow]);

    const removeApp = useCallback((appId: string) => {
        setAppPages(prev => {
            const next = prev.map(page => page.filter(id => id !== appId)).filter(page => page.length > 0);
            const finalPages = next.length > 0 ? next : [[]];
            persistLayoutNow(finalPages);
            return finalPages;
        });
    }, [persistLayoutNow]);

    const allApps = useMemo(() => [...INSTALLED_APPS, ...dynamicApps], [dynamicApps]);
    const getApp = useCallback((id: string) => allApps.find(a => a.id === id), [allApps]);

    const now = new Date();
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate().toString().padStart(2, '0');
    const contentColor = theme.contentColor || '#ffffff';
    const safeTop = 'env(safe-area-inset-top, 0px)';

    return (
        <div
            className="h-full w-full flex flex-col relative z-10 animate-fade-in overflow-hidden font-sans select-none"
            onClick={handleShellTap}
        >
            <div className="absolute inset-0 pointer-events-none">
                <div
                    className="absolute inset-0 opacity-10"
                    style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '100px 100px' }}
                />
                <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl" />
            </div>

            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
            >
                {displayPages.map((pageApps, pIdx) => (
                    <div
                        key={`page-${pIdx}`}
                        className="h-full flex-shrink-0 snap-center flex flex-col px-6 pb-8"
                        style={{ width: containerW, minWidth: containerW, paddingTop: pIdx === 0 ? `calc(${safeTop} + 0.65rem)` : `calc(${safeTop} + 0.8rem)` }}
                    >
                        {pIdx === 0 && (
                            <>
                                <div className="flex flex-col mb-6 mt-6 relative" style={{ color: contentColor }}>
                                    <div className="flex items-end gap-4">
                                        <div className="text-[clamp(4.4rem,18vw,6.5rem)] leading-[0.85] font-bold tracking-tighter drop-shadow-2xl font-sans" style={{ color: contentColor }}>
                                            {virtualTime.hours.toString().padStart(2, '0')}
                                            <span className="opacity-40 font-light mx-1">:</span>
                                            {virtualTime.minutes.toString().padStart(2, '0')}
                                        </div>
                                        <div className="flex flex-col justify-end pb-3 opacity-90">
                                            <div className="text-[clamp(1.45rem,5vw,1.9rem)] font-bold tracking-tight">{dayName}</div>
                                            <div className="text-xs sm:text-sm font-medium opacity-80 tracking-widest">{monthName} . {dateNum}</div>
                                        </div>
                                    </div>
                                    <div className="mt-4 ml-1 flex items-center gap-2">
                                        <div className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border border-white/10" style={{ color: contentColor }}>
                                            System Ready
                                        </div>
                                        <div className="h-px w-20 bg-gradient-to-r from-current to-transparent opacity-40" />
                                    </div>
                                    <div className="mt-8 mb-4" onClick={() => { if (!isEditMode) openApp('chat' as any); }}>
                                        <div className="relative h-28 w-full overflow-hidden rounded-[1.5rem] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl cursor-pointer">
                                            <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-white/5 to-transparent skew-x-12" />
                                            <div className="absolute inset-0 flex items-center p-4 gap-4">
                                                <div className="w-20 h-20 shrink-0 rounded-2xl overflow-hidden shadow-lg border-2 border-white/20 bg-slate-800">
                                                    {(widgetChar?.displayAvatar || widgetChar?.avatar) && <img src={widgetChar?.displayAvatar || widgetChar?.avatar} className="w-full h-full object-cover" alt="char" />}
                                                </div>
                                                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-lg font-bold text-white truncate">{widgetChar?.name || 'NO SIGNAL'}</h3>
                                                        <div className="px-1.5 py-0.5 bg-white/20 rounded text-[9px] font-bold text-white uppercase">Active</div>
                                                    </div>
                                                    <div className="text-xs text-white/80 line-clamp-2">{lastMessage}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {pIdx > 0 && <div className="h-24" />}

                        <div className="flex-1" ref={(el) => { gridRefs.current[pIdx] = el; }}>
                            {pageApps.length === 0 ? (
                                <div className="h-[220px] rounded-3xl border border-dashed border-white/25 bg-white/5" />
                            ) : (
                                <div className="grid grid-cols-4 gap-y-6 gap-x-2 place-items-center">
                                    {pageApps.map((appId) => {
                                        const app = getApp(appId);
                                        if (!app) return null;
                                        const isDragging = appId === draggingId;
                                        return (
                                            <motion.div
                                                key={appId}
                                                layout
                                                layoutId={appId}
                                                className="relative touch-none"
                                                data-app-icon="true"
                                                style={{ opacity: isDragging ? 0 : 1 }}
                                                animate={isEditMode && !isDragging ? {
                                                    rotate: [0, -1.5, 1.5, -1.5, 1.5, 0],
                                                    transition: { repeat: Infinity, duration: 0.38 }
                                                } : { rotate: 0 }}
                                                onPointerDown={(e) => onPointerDown(e, appId)}
                                                onPointerMove={onPointerMovePre}
                                                onPointerUp={clearLongPress}
                                            >
                                                <AppIcon
                                                    app={app}
                                                    onClick={() => {
                                                        if (!isEditMode && !draggingId) openApp(app.id);
                                                    }}
                                                />
                                                {isEditMode && (
                                                    <button
                                                        className="absolute -top-1 -right-1 w-5 h-5 bg-black/60 backdrop-blur border border-white/30 rounded-full flex items-center justify-center text-white text-[10px] z-20"
                                                        onPointerDown={(e) => e.stopPropagation()}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeApp(appId);
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                <AnimatePresence>
                    {showGhostPage && (
                        <motion.div
                            key="ghost-page"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full flex-shrink-0 snap-center flex items-center justify-center"
                            style={{ width: containerW, minWidth: containerW }}
                        >
                            <motion.div
                                className="w-36 h-36 rounded-3xl border-2 border-dashed border-white/40 flex flex-col items-center justify-center gap-2"
                                style={{ background: 'rgba(255,255,255,0.05)' }}
                                animate={isOverGhostPage ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                                transition={isOverGhostPage ? { repeat: Infinity, duration: 0.9 } : { duration: 0.2 }}
                            >
                                <span className="text-5xl font-thin text-white/40">+</span>
                                <span className="text-[9px] tracking-widest uppercase text-white/35">New Page</span>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="h-full flex-shrink-0 snap-center flex flex-col px-6 pt-24 pb-8 space-y-6" style={{ width: containerW, minWidth: containerW }}>
                    <div className="bg-white/10 backdrop-blur-2xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                        <h3 className="text-xl font-bold tracking-widest text-white mb-4">{monthName} {now.getFullYear()}</h3>
                        <div className="grid grid-cols-7 gap-y-3 text-center text-white/40 text-[10px] font-bold mb-2">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => <div key={`${d}-${idx}`}>{d}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-y-2 text-center">
                            {Array.from({ length: 31 }, (_, i) => (
                                <div key={i} className={`h-8 w-8 flex items-center justify-center rounded-full text-xs mx-auto ${i + 1 === now.getDate() ? 'bg-white text-black font-bold' : 'text-white/60'}`}>
                                    {i + 1}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-white/10 backdrop-blur-2xl rounded-3xl p-5 border border-white/20 flex-1 flex flex-col">
                        <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-4">Behavior Logs</h3>
                        <p className="text-white/30 text-xs text-center py-10 italic">No recent system alerts.</p>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-24 left-0 w-full flex justify-center gap-1.5 pointer-events-none">
                {Array.from({ length: totalDots }).map((_, i) => (
                    <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${currentPage === i ? 'bg-white w-4' : 'bg-white/35 w-1.5'}`} />
                ))}
            </div>

            <AnimatePresence>
                {ghostPos && draggingId && (() => {
                    const app = getApp(draggingId);
                    if (!app) return null;
                    return (
                        <motion.div
                            key="ghost-icon"
                            className="fixed z-50 pointer-events-none"
                            initial={{ scale: 1 }}
                            animate={{ scale: 1.15 }}
                            exit={{ scale: 1, opacity: 0 }}
                            style={{
                                left: ghostPos.x - 30,
                                top: ghostPos.y - 30,
                                filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.55))',
                                willChange: 'left, top'
                            }}
                        >
                            <AppIcon app={app} onClick={() => { }} />
                        </motion.div>
                    );
                })()}
            </AnimatePresence>

            {isEditMode && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 text-[10px] tracking-widest uppercase text-white/65 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-3 py-1 pointer-events-none">
                    Tap empty area to save
                </div>
            )}

            <div className={`mt-auto pt-4 flex justify-center w-full px-4 mb-4 relative z-20 transition-all duration-200 ${isEditMode ? 'opacity-40 scale-95 pointer-events-none' : ''}`}>
                <div className="bg-white/10 backdrop-blur-2xl rounded-3xl border border-white/20 shadow-2xl px-4 py-3 flex gap-4 items-center">
                    {DOCK_APPS.map(id => {
                        const app = INSTALLED_APPS.find(a => a.id === id);
                        return app ? <AppIcon key={app.id} app={app} onClick={() => openApp(app.id)} variant="dock" /> : null;
                    })}
                </div>
            </div>
        </div>
    );
};

export default Launcher;
