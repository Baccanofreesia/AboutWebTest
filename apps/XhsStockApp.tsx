import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { XhsStockImage } from '../types';
import ConfirmDialog from '../components/os/ConfirmDialog';
import Modal from '../components/os/Modal';
import { fsBridge } from '../utils/fsBridge';
import { processImage } from '../utils/file';

type PickerPhoto = {
    name: string;
    path: string;
    album: string;
    updatedAt: number;
};

type PendingUpload = {
    dataUrl: string;
    safeName: string;
    detail: string;
    tags: string;
};

const XhsStockApp: React.FC = () => {
    const { closeApp, addToast, apiConfig } = useOS();
    const [images, setImages] = useState<XhsStockImage[]>([]);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean; title: string; message: string;
        variant: 'danger' | 'warning' | 'info'; onConfirm: () => void;
    } | null>(null);
    const [filterTag, setFilterTag] = useState<string | null>(null);
    const [showPicker, setShowPicker] = useState(false);
    const [pickerPhotos, setPickerPhotos] = useState<PickerPhoto[]>([]);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerSelectedPath, setPickerSelectedPath] = useState('');
    const [galleryPreviewMap, setGalleryPreviewMap] = useState<Record<string, string>>({});
    const [stockTags, setStockTags] = useState('');
    const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const galleryRootPath = apiConfig.galleryWorkspacePath?.trim() || '';
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;

    const extOf = (name: string) => {
        const idx = name.lastIndexOf('.');
        return idx >= 0 ? name.slice(idx).toLowerCase() : '';
    };
    const isImageName = (name: string) => ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extOf(name));
    const mimeByName = (name: string) => {
        const ext = extOf(name);
        if (ext === '.png') return 'image/png';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        if (ext === '.bmp') return 'image/bmp';
        return 'image/jpeg';
    };
    const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
    const toRelPath = (absolutePath: string) => absolutePath.replace(/^\/+/, '');

    const loadImages = useCallback(async () => {
        const imgs = await DB.getXhsStockImages();
        setImages(imgs.sort((a, b) => b.addedAt - a.addedAt));
    }, []);

    const ensurePreview = useCallback(async (paths: string[]) => {
        if (!galleryRootPath || paths.length === 0) return;
        const targets = paths.filter(p => !galleryPreviewMap[p]).slice(0, 24);
        if (targets.length === 0) return;
        const list = await Promise.all(targets.map(async p => {
            try {
                const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(p), allowGlobal);
                return [p, `data:${mimeByName(p)};base64,${base64}`] as const;
            } catch {
                return [p, ''] as const;
            }
        }));
        setGalleryPreviewMap(prev => {
            const next = { ...prev };
            list.forEach(([path, dataUrl]) => {
                if (!next[path]) next[path] = dataUrl;
            });
            return next;
        });
    }, [allowGlobal, galleryPreviewMap, galleryRootPath]);

    
    useEffect(() => { loadImages(); }, [loadImages]);
    useEffect(() => {
        if (!showPicker || pickerPhotos.length === 0) return;
        const targets = pickerPhotos.slice(0, 24).map(p => p.path);
        ensurePreview(targets);
    }, [ensurePreview, pickerPhotos, showPicker]);
    useEffect(() => {
        if (!galleryRootPath || images.length === 0) return;
        const targets = images
            .filter(img => img.url.startsWith('gallery://'))
            .map(img => img.url.replace('gallery://', ''));
        ensurePreview(targets);
    }, [ensurePreview, galleryRootPath, images]);

    const allTags = Array.from(new Set(images.flatMap(img => img.tags))).sort();

    const filteredImages = filterTag
        ? images.filter(img => img.tags.includes(filterTag))
        : images;

    const resolveStockSrc = (img: XhsStockImage) => {
        if (img.url.startsWith('gallery://')) {
            const path = img.url.replace('gallery://', '');
            return galleryPreviewMap[path] || '';
        }
        return img.url;
    };

    const parseTags = (raw: string) =>
        raw.split(/[,\\uFF0C\\s#]+/).map(t => t.trim()).filter(Boolean);

    const collectGalleryPhotos = useCallback(async (): Promise<PickerPhoto[]> => {
        if (!galleryRootPath) return [];
        const rootItems = await fsBridge.readDir(galleryRootPath, '/', allowGlobal);
        const rootFiles = rootItems
            .filter(i => i.type === 'file' && isImageName(i.name))
            .map(i => ({ name: i.name, path: `/${i.name}`, album: '最近项目', updatedAt: i.updatedAt || Date.now() }));
        const folders = rootItems.filter(i => i.type === 'folder');
        const nested = await Promise.all(folders.map(async f => {
            const dirPath = `/${f.name}/`;
            const items = await fsBridge.readDir(galleryRootPath, dirPath, allowGlobal);
            return items
                .filter(i => i.type === 'file' && isImageName(i.name))
                .map(i => ({ name: i.name, path: `${dirPath}${i.name}`, album: f.name, updatedAt: i.updatedAt || Date.now() }));
        }));
        return [...rootFiles, ...nested.flat()].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allowGlobal, galleryRootPath]);

    const loadPicker = useCallback(async () => {
        setPickerSelectedPath('');
        setStockTags('');
        if (!galleryRootPath) {
            setPickerPhotos([]);
            return;
        }
        setPickerLoading(true);
        try {
            setPickerPhotos(await collectGalleryPhotos());
        } catch (e: any) {
            addToast(`读取相册失败: ${e.message || e}`, 'error');
        } finally {
            setPickerLoading(false);
        }
    }, [addToast, collectGalleryPhotos, galleryRootPath]);

    const openPicker = async () => {
        if (!galleryRootPath) {
            addToast('请先在设置中配置相册路径', 'error');
            return;
        }
        setShowPicker(true);
        await loadPicker();
    };

    const joinGalleryPath = (path: string) => {
        const root = galleryRootPath.replace(/\/+$/, '');
        return root ? `${root}${path}` : path;
    };

    const addStockImage = async (url: string, tagsInput: string, localPath?: string) => {
        const tags = parseTags(tagsInput);
        if (tags.length === 0) {
            addToast('至少填写一个标签', 'error');
            return;
        }
        if (images.some(img => img.url === url)) {
            addToast('该图片已在小红书图库中', 'info');
            return;
        }
        const img: XhsStockImage = {
            id: `xhs_stock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            url,
            localPath,
            tags,
            addedAt: Date.now(),
            usedCount: 0,
        };
        await DB.saveXhsStockImage(img);
        await loadImages();
        setStockTags('');
        setPickerSelectedPath('');
        addToast('图片已入库', 'success');
    };

    const handlePickFromGallery = async () => {
        if (!pickerSelectedPath) {
            addToast('请选择一张相册图片', 'error');
            return;
        }
        const url = `gallery://${pickerSelectedPath}`;
        const absPath = joinGalleryPath(pickerSelectedPath);
        await addStockImage(url, stockTags, absPath);
    };

    const handleLocalUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        if (!galleryRootPath) {
            addToast('请先在设置中配置相册路径', 'error');
            return;
        }
        try {
            const safeName = sanitizeName(file.name || `xhs_${Date.now()}.jpg`);
            const photos = await collectGalleryPhotos();
            const duplicate = photos.find(p => p.name.trim().toLowerCase() === safeName.trim().toLowerCase());
            if (duplicate) {
                setPickerSelectedPath(duplicate.path);
                const url = `gallery://${duplicate.path}`;
                const absPath = joinGalleryPath(duplicate.path);
                await addStockImage(url, stockTags, absPath);
                return;
            }
            const dataUrl = await processImage(file, { maxWidth: 1280, quality: 0.78, forceJpeg: true });
            setPendingUpload({ dataUrl, safeName, detail: '', tags: stockTags });
        } catch (err: any) {
            addToast(err.message || '上传失败', 'error');
        }
    }, [addStockImage, addToast, collectGalleryPhotos, galleryRootPath, joinGalleryPath, sanitizeName, stockTags]);

    const confirmPendingUpload = useCallback(async () => {
        if (!pendingUpload) return;
        const detail = pendingUpload.detail.trim();
        const tags = parseTags(pendingUpload.tags);
        if (!detail) {
            addToast('请填写图片详情', 'error');
            return;
        }
        if (tags.length === 0) {
            addToast('至少填写一个标签', 'error');
            return;
        }
        if (!galleryRootPath) {
            addToast('未配置相册路径', 'error');
            return;
        }
        try {
            const relPath = `/${pendingUpload.safeName}`;
            const base64 = pendingUpload.dataUrl.includes(',') ? pendingUpload.dataUrl.split(',')[1] : pendingUpload.dataUrl;
            await fsBridge.writeFileBase64(galleryRootPath, toRelPath(relPath), base64, allowGlobal);
            await DB.saveImageDetail({
                fileName: pendingUpload.safeName,
                detail: detail.slice(0, 30),
                source: 'user',
                relatedPath: relPath
            });
            const absPath = joinGalleryPath(relPath);
            await addStockImage(`gallery://${relPath}`, pendingUpload.tags, absPath);
            setPendingUpload(null);
            await loadPicker();
        } catch (e: any) {
            addToast(e.message || '保存失败', 'error');
        }
    }, [addStockImage, addToast, allowGlobal, galleryRootPath, loadPicker, pendingUpload, parseTags]);

    const handleDelete = (img: XhsStockImage) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除图片',
            message: `确定删除这张图片吗？\n标签: ${img.tags.join(', ')}`,
            variant: 'danger',
            onConfirm: async () => {
                await DB.deleteXhsStockImage(img.id);
                await loadImages();
                addToast('已删除', 'success');
                setConfirmDialog(null);
            }
        });
    };

    const renderList = () => (
        <div className="flex-1 overflow-y-auto min-h-0">
            {allTags.length > 0 && (
                <div className="flex gap-1.5 px-4 py-3 overflow-x-auto no-scrollbar border-b border-slate-100">
                    <button
                        onClick={() => setFilterTag(null)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filterTag ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                    >
                        全部 ({images.length})
                    </button>
                    {allTags.map(tag => {
                        const count = images.filter(img => img.tags.includes(tag)).length;
                        return (
                            <button
                                key={tag}
                                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterTag === tag ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                            >
                                #{tag} ({count})
                            </button>
                        );
                    })}
                </div>
            )}

            {filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-14 h-14 opacity-40">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <span className="text-sm">还没有囤图</span>
                    <span className="text-xs text-slate-300">点右上角 + 添加图片</span>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-1 p-1">
                    {filteredImages.map(img => {
                        const src = resolveStockSrc(img);
                        return (
                            <div key={img.id} className="aspect-square bg-slate-100 relative overflow-hidden rounded-sm group">
                                {src ? (
                                    <img src={src} className="w-full h-full object-cover" loading="lazy" alt="" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">No Preview</div>
                                )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                                <div className="flex flex-wrap gap-0.5">
                                    {img.tags.slice(0, 3).map((tag, i) => (
                                        <span key={i} className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">#{tag}</span>
                                    ))}
                                </div>
                            </div>
                            {img.usedCount > 0 && (
                                <div className="absolute top-1 left-1 bg-red-500/80 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                                    x{img.usedCount}
                                </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3">
                                <div className="flex flex-wrap gap-0.5">
                                    {img.tags.slice(0, 2).map((tag, i) => (
                                        <span key={i} className="text-[8px] text-white/80">#{tag}</span>
                                    ))}
                                    {img.tags.length > 2 && <span className="text-[8px] text-white/50">+{img.tags.length - 2}</span>}
                                </div>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                                className="absolute top-1 right-1 w-6 h-6 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-3.5 h-3.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || ''}
                message={confirmDialog?.message || ''}
                variant={confirmDialog?.variant}
                confirmText="确认"
                onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))}
                onCancel={() => setConfirmDialog(null)}
            />

            <div className="h-20 bg-white/80 backdrop-blur-xl flex items-end pb-3 px-4 border-b border-slate-100/60 shrink-0 z-10 sticky top-0">
                <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-slate-800 ml-2 tracking-tight">
                    小红书图库
                </h1>
                <span className="text-xs text-slate-400 ml-2 font-mono">{images.length}</span>
                <div className="flex-1" />
                <button
                    onClick={openPicker}
                    className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md active:scale-90 transition-transform"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </button>
            </div>

            {renderList()}

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLocalUpload} className="hidden" />

            <Modal
                isOpen={showPicker}
                title="添加到小红书图库"
                onClose={() => setShowPicker(false)}
                footer={
                    <>
                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-3 bg-slate-100 rounded-2xl">本地上传</button>
                        <button onClick={handlePickFromGallery} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">添加所选</button>
                    </>
                }
            >
                {pickerLoading ? (
                    <div className="h-40 flex items-center justify-center text-sm text-slate-400">正在读取相册...</div>
                ) : pickerPhotos.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center text-sm text-slate-400 gap-3">
                        <span>相册暂无图片，先上传一张</span>
                        <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">上传图片</button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="text-[11px] text-slate-400">优先从相册选择，若没有再上传本地图片</div>
                        <div className="grid grid-cols-3 gap-2 max-h-[48vh] overflow-y-auto no-scrollbar pr-1">
                            {pickerPhotos.map(photo => {
                                const selected = pickerSelectedPath === photo.path;
                                const preview = galleryPreviewMap[photo.path];
                                return (
                                    <button
                                        key={photo.path}
                                        onClick={() => setPickerSelectedPath(photo.path)}
                                        className={`aspect-square rounded-xl border overflow-hidden relative ${selected ? 'border-red-500 ring-2 ring-red-500/30' : 'border-slate-200'}`}
                                    >
                                        {preview ? (
                                            <div className="w-full h-full p-1 bg-slate-100">
                                                <img src={preview} className="w-full h-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">No Preview</div>
                                        )}
                                        <div className="absolute left-1 right-1 bottom-1 px-1.5 py-0.5 bg-black/40 text-white text-[10px] rounded truncate">{photo.name}</div>
                                    </button>
                                );
                            })}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">标签 (空格/逗号分隔)</label>
                            <input
                                type="text"
                                value={stockTags}
                                onChange={e => setStockTags(e.target.value)}
                                placeholder="美食 咖啡 下午茶 #穿搭 #日常"
                                className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent placeholder:text-slate-300"
                            />
                            {stockTags && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {parseTags(stockTags).map((tag, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-red-50 text-red-500 text-xs rounded-full font-medium">#{tag}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={!!pendingUpload}
                title="填写图片详情"
                onClose={() => setPendingUpload(null)}
                footer={
                    <>
                        <button onClick={() => setPendingUpload(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={confirmPendingUpload} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">保存并入库</button>
                    </>
                }
            >
                <div className="space-y-3">
                    <input
                        value={pendingUpload?.detail || ''}
                        onChange={(e) => setPendingUpload(prev => prev ? { ...prev, detail: e.target.value.slice(0, 30) } : prev)}
                        placeholder="请输入图片详情（最多30字）"
                        className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                        maxLength={30}
                        autoFocus
                    />
                    <div className="text-[11px] text-slate-400 text-right">{(pendingUpload?.detail || '').length}/30</div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">标签 (空格/逗号分隔)</label>
                        <input
                            type="text"
                            value={pendingUpload?.tags || ''}
                            onChange={e => setPendingUpload(prev => prev ? { ...prev, tags: e.target.value } : prev)}
                            placeholder="美食 咖啡 下午茶 #穿搭 #日常"
                            className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent placeholder:text-slate-300"
                        />
                        {pendingUpload?.tags && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {parseTags(pendingUpload.tags).map((tag, i) => (
                                    <span key={i} className="px-2.5 py-1 bg-red-50 text-red-500 text-xs rounded-full font-medium">#{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default XhsStockApp;
