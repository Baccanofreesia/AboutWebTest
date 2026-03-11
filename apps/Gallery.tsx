
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { fsBridge } from '../utils/fsBridge';
import Modal from '../components/os/Modal';
import { DB } from '../utils/db';

type AlbumInfo = {
    name: string;
    path: string;
    count: number;
    updatedAt: number;
    coverPath?: string;
};

type PhotoFile = {
    name: string;
    path: string;
    size: number;
    updatedAt: number;
    album: string;
};

type PendingUploadItem = {
    id: string;
    file: File;
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];

const toRelPath = (absolutePath: string) => absolutePath.replace(/^\/+/, '');

const extOf = (name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
};

const isImageName = (name: string) => IMAGE_EXTS.includes(extOf(name));
const isVideoName = (name: string) => VIDEO_EXTS.includes(extOf(name));
const isMediaName = (name: string) => isImageName(name) || isVideoName(name);

const mimeFromName = (name: string) => {
    const ext = extOf(name);
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    if (ext === '.mp4') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.mkv') return 'video/x-matroska';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.avi') return 'video/x-msvideo';
    if (ext === '.m4v') return 'video/mp4';
    return 'image/jpeg';
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const data = String(reader.result || '');
        const base64 = data.includes(',') ? data.split(',')[1] : data;
        if (!base64) reject(new Error('图片编码失败'));
        else resolve(base64);
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
});

const Gallery: React.FC = () => {
    const { closeApp, apiConfig, addToast } = useOS();
    const galleryRootPath = apiConfig.galleryWorkspacePath?.trim() || '';
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;

    const [albums, setAlbums] = useState<AlbumInfo[]>([]);
    const [photos, setPhotos] = useState<PhotoFile[]>([]);
    const [activeAlbum, setActiveAlbum] = useState<string>('all');
    const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
    const [selectedPhoto, setSelectedPhoto] = useState<PhotoFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [visibleCount, setVisibleCount] = useState(60);

    const [showCreateAlbum, setShowCreateAlbum] = useState(false);
    const [newAlbumName, setNewAlbumName] = useState('');
    const [showRenameAlbum, setShowRenameAlbum] = useState<AlbumInfo | null>(null);
    const [renamingAlbumName, setRenamingAlbumName] = useState('');
    const [showRenamePhoto, setShowRenamePhoto] = useState<PhotoFile | null>(null);
    const [renamingPhotoName, setRenamingPhotoName] = useState('');
    const [showMovePhoto, setShowMovePhoto] = useState<PhotoFile | null>(null);
    const [moveTargetAlbum, setMoveTargetAlbum] = useState<string>('root');
    const [imageDetailMap, setImageDetailMap] = useState<Record<string, string>>({});
    const [showUploadDetailModal, setShowUploadDetailModal] = useState(false);
    const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);
    const [uploadDetails, setUploadDetails] = useState<Record<string, string>>({});
    const [isSubmittingUpload, setIsSubmittingUpload] = useState(false);
    const [showEditDetailPhoto, setShowEditDetailPhoto] = useState<PhotoFile | null>(null);
    const [editingDetail, setEditingDetail] = useState('');
    const selectedVideoRef = useRef<HTMLVideoElement | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const previewMapRef = useRef<Record<string, string>>({});
    const addToastRef = useRef(addToast);

    useEffect(() => {
        previewMapRef.current = previewMap;
    }, [previewMap]);

    useEffect(() => {
        addToastRef.current = addToast;
    }, [addToast]);

    const loadPreview = useCallback(async (file: PhotoFile) => {
        if (!galleryRootPath) return;
        if (previewMapRef.current[file.path] !== undefined) return;
        try {
            const base64 = await fsBridge.readFileBase64(galleryRootPath, toRelPath(file.path), allowGlobal);
            const dataUrl = `data:${mimeFromName(file.name)};base64,${base64}`;
            setPreviewMap(prev => {
                if (prev[file.path] !== undefined) return prev;
                return { ...prev, [file.path]: dataUrl };
            });
        } catch {
            setPreviewMap(prev => {
                if (prev[file.path] !== undefined) return prev;
                return { ...prev, [file.path]: '' };
            });
        }
    }, [allowGlobal, galleryRootPath]);

    const getImageDetail = useCallback((fileName: string) => {
        return imageDetailMap[fileName.trim().toLowerCase()] || '';
    }, [imageDetailMap]);

    const scanGallery = useCallback(async () => {
        if (!galleryRootPath) {
            setAlbums([]);
            setPhotos([]);
            setSelectedPhoto(null);
            return;
        }

        setIsLoading(true);
        try {
            const rootItems = await fsBridge.readDir(galleryRootPath, '/', allowGlobal);
            const rootFiles = rootItems.filter(i => i.type === 'file' && isMediaName(i.name));
            const rootPhotos: PhotoFile[] = rootFiles.map(f => ({
                name: f.name,
                path: `/${f.name}`,
                size: f.size || 0,
                updatedAt: f.updatedAt || Date.now(),
                album: '最近项目'
            }));

            const folderItems = rootItems.filter(i => i.type === 'folder');
            const albumResults = await Promise.all(folderItems.map(async (folder) => {
                const dirPath = `/${folder.name}/`;
                const items = await fsBridge.readDir(galleryRootPath, dirPath, allowGlobal);
                const imageItems = items.filter(i => i.type === 'file' && isMediaName(i.name));
                const mapped: PhotoFile[] = imageItems.map(f => ({
                    name: f.name,
                    path: `${dirPath}${f.name}`,
                    size: f.size || 0,
                    updatedAt: f.updatedAt || Date.now(),
                    album: folder.name
                }));
                const sorted = [...mapped].sort((a, b) => b.updatedAt - a.updatedAt);
                const album: AlbumInfo = {
                    name: folder.name,
                    path: dirPath,
                    count: mapped.length,
                    updatedAt: folder.updatedAt || Date.now(),
                    coverPath: sorted[0]?.path
                };
                return { album, mapped };
            }));

            const albumList = albumResults.map(i => i.album).sort((a, b) => b.updatedAt - a.updatedAt);
            const albumPhotos = albumResults.flatMap(i => i.mapped);
            const allPhotos = [...rootPhotos, ...albumPhotos].sort((a, b) => b.updatedAt - a.updatedAt);
            const imageDetails = await DB.getImageDetails().catch(() => []);
            const nextDetailMap: Record<string, string> = {};
            imageDetails.forEach(d => {
                const key = d.fileName.trim().toLowerCase();
                if (!key) return;
                nextDetailMap[key] = (d.detail || '').trim().slice(0, 30);
            });

            setPreviewMap(prev => {
                Object.values(prev).forEach(v => {
                    if (v.startsWith('blob:')) URL.revokeObjectURL(v);
                });
                return {};
            });
            setAlbums(albumList);
            setPhotos(allPhotos);
            setImageDetailMap(nextDetailMap);
            setVisibleCount(60);
        } catch (e: any) {
            addToastRef.current(`相册扫描失败: ${e.message || e}`, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [allowGlobal, galleryRootPath]);

    useEffect(() => {
        scanGallery();
    }, [scanGallery]);

    useEffect(() => {
        return () => {
            Object.values(previewMapRef.current).forEach(v => {
                if (v.startsWith('blob:')) URL.revokeObjectURL(v);
            });
        };
    }, []);

    const filteredPhotos = useMemo(() => {
        if (activeAlbum === 'all') return photos;
        if (activeAlbum === 'root') return photos.filter(p => p.path.split('/').filter(Boolean).length === 1);
        return photos.filter(p => p.album === activeAlbum);
    }, [activeAlbum, photos]);

    const visiblePhotos = useMemo(() => filteredPhotos.slice(0, visibleCount), [filteredPhotos, visibleCount]);

    const uploadTargetPath = useMemo(() => {
        if (activeAlbum === 'all' || activeAlbum === 'root') return '/';
        return `/${activeAlbum}/`;
    }, [activeAlbum]);

    useEffect(() => {
        visiblePhotos.forEach(p => {
            if (previewMapRef.current[p.path] === undefined) {
                loadPreview(p);
            }
        });
        albums.forEach(a => {
            if (!a.coverPath) return;
            const file = photos.find(p => p.path === a.coverPath);
            if (file && previewMapRef.current[file.path] === undefined) {
                loadPreview(file);
            }
        });
    }, [albums, loadPreview, photos, visiblePhotos]);

    const handleCreateAlbum = async () => {
        const raw = newAlbumName.trim();
        if (!galleryRootPath) return;
        if (!raw) {
            addToast('请输入相册名称', 'error');
            return;
        }
        const clean = raw.replace(/[\\/:*?"<>|]/g, '_');
        try {
            await fsBridge.createFolder(galleryRootPath, toRelPath(`/${clean}/`), allowGlobal);
            setShowCreateAlbum(false);
            setNewAlbumName('');
            addToast('相册已创建', 'success');
            await scanGallery();
        } catch (e: any) {
            addToast(`创建失败: ${e.message || e}`, 'error');
        }
    };

    const handleDeleteAlbum = async (album: AlbumInfo) => {
        if (!galleryRootPath) return;
        try {
            await fsBridge.deleteFile(galleryRootPath, toRelPath(album.path), allowGlobal);
            if (activeAlbum === album.name) setActiveAlbum('all');
            addToast('相册已删除', 'info');
            await scanGallery();
        } catch (e: any) {
            addToast(`删除失败: ${e.message || e}`, 'error');
        }
    };

    const handleRenameAlbum = async () => {
        if (!galleryRootPath || !showRenameAlbum) return;
        const raw = renamingAlbumName.trim();
        if (!raw) {
            addToast('请输入新名称', 'error');
            return;
        }
        const clean = raw.replace(/[\\/:*?"<>|]/g, '_');
        try {
            await fsBridge.renameFile(
                galleryRootPath,
                toRelPath(showRenameAlbum.path),
                toRelPath(`/${clean}/`),
                allowGlobal
            );
            if (activeAlbum === showRenameAlbum.name) setActiveAlbum(clean);
            setShowRenameAlbum(null);
            setRenamingAlbumName('');
            addToast('相册已重命名', 'success');
            await scanGallery();
        } catch (e: any) {
            addToast(`重命名失败: ${e.message || e}`, 'error');
        }
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
        if (files.length === 0) return;
        const items: PendingUploadItem[] = files.map((file, idx) => ({ id: `${file.name}__${idx}__${Date.now()}`, file }));
        const initialDetails: Record<string, string> = {};
        items.forEach(item => {
            initialDetails[item.id] = '';
        });
        setPendingUploads(items);
        setUploadDetails(initialDetails);
        setShowUploadDetailModal(true);
    };

    const handleConfirmUpload = async () => {
        if (!galleryRootPath || pendingUploads.length === 0) return;
        for (const item of pendingUploads) {
            const detail = (uploadDetails[item.id] || '').trim();
            if (!detail) {
                addToast('请填写每张图片的详情', 'error');
                return;
            }
            if (detail.length > 30) {
                addToast('图片详情需不超过30字', 'error');
                return;
            }
        }

        setIsSubmittingUpload(true);
        try {
            const existingNames = new Set(photos.map(p => p.name.trim().toLowerCase()));
            let saved = 0;
            let dedupSkipped = 0;
            for (const item of pendingUploads) {
                const base64 = await fileToBase64(item.file);
                const safeName = item.file.name.replace(/[\\/:*?"<>|]/g, '_');
                const normalized = safeName.trim().toLowerCase();
                if (existingNames.has(normalized)) {
                    dedupSkipped++;
                    continue;
                }
                const targetPath = `${uploadTargetPath}${safeName}`;
                await fsBridge.writeFileBase64(galleryRootPath, toRelPath(targetPath), base64, allowGlobal);
                await DB.saveImageDetail({
                    fileName: safeName,
                    detail: (uploadDetails[item.id] || '').trim().slice(0, 30),
                    source: 'user',
                    relatedPath: targetPath
                });
                existingNames.add(normalized);
                saved++;
            }
            addToast(`已导入 ${saved} 个媒体文件${dedupSkipped > 0 ? `（去重 ${dedupSkipped}）` : ''}`, 'success');
            setShowUploadDetailModal(false);
            setPendingUploads([]);
            setUploadDetails({});
            await scanGallery();
        } catch (err: any) {
            addToast(`导入失败: ${err.message || err}`, 'error');
        } finally {
            setIsSubmittingUpload(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeletePhoto = async (photo: PhotoFile) => {
        if (!galleryRootPath) return;
        try {
            await fsBridge.deleteFile(galleryRootPath, toRelPath(photo.path), allowGlobal);
            if (selectedPhoto?.path === photo.path) setSelectedPhoto(null);
            addToast('媒体文件已删除', 'info');
            await scanGallery();
        } catch (e: any) {
            addToast(`删除失败: ${e.message || e}`, 'error');
        }
    };

    const handleRenamePhoto = async () => {
        if (!galleryRootPath || !showRenamePhoto) return;
        const raw = renamingPhotoName.trim();
        if (!raw) {
            addToast('请输入新文件名', 'error');
            return;
        }
        const ext = extOf(showRenamePhoto.name);
        const noExt = raw.replace(/\.[^/.]+$/, '');
        const safe = `${noExt.replace(/[\\/:*?"<>|]/g, '_')}${ext}`;
        const dir = showRenamePhoto.path.slice(0, showRenamePhoto.path.lastIndexOf('/') + 1);
        const nextPath = `${dir}${safe}`;
        try {
            await fsBridge.renameFile(
                galleryRootPath,
                toRelPath(showRenamePhoto.path),
                toRelPath(nextPath),
                allowGlobal
            );
            setShowRenamePhoto(null);
            setRenamingPhotoName('');
            addToast('媒体文件已重命名', 'success');
            await scanGallery();
        } catch (e: any) {
            addToast(`重命名失败: ${e.message || e}`, 'error');
        }
    };

    const handleMovePhoto = async () => {
        if (!galleryRootPath || !showMovePhoto) return;
        const dir = showMovePhoto.path.slice(0, showMovePhoto.path.lastIndexOf('/') + 1);
        const targetDir = moveTargetAlbum === 'root' ? '/' : `/${moveTargetAlbum}/`;
        if (dir === targetDir) {
            setShowMovePhoto(null);
            addToast('媒体文件已在当前相册中', 'info');
            return;
        }

        const targetName = showMovePhoto.name;
        const ext = extOf(targetName);
        const base = targetName.replace(/\.[^/.]+$/, '');
        const targetPath = `${targetDir}${targetName}`;

        try {
            await fsBridge.renameFile(
                galleryRootPath,
                toRelPath(showMovePhoto.path),
                toRelPath(targetPath),
                allowGlobal
            );
        } catch {
            const conflictPath = `${targetDir}${base}-${Date.now()}${ext}`;
            await fsBridge.renameFile(
                galleryRootPath,
                toRelPath(showMovePhoto.path),
                toRelPath(conflictPath),
                allowGlobal
            );
        }

        setShowMovePhoto(null);
        if (selectedPhoto?.path === showMovePhoto.path) setSelectedPhoto(null);
        addToast('媒体文件已移动', 'success');
        await scanGallery();
    };

    const handleSaveDetail = async () => {
        if (!showEditDetailPhoto) return;
        const detail = editingDetail.trim();
        if (!detail) {
            addToast('媒体详情不能为空', 'error');
            return;
        }
        if (detail.length > 30) {
            addToast('媒体详情需不超过30字', 'error');
            return;
        }
        try {
            await DB.saveImageDetail({
                fileName: showEditDetailPhoto.name,
                detail,
                source: 'user',
                relatedPath: showEditDetailPhoto.path
            });
            setImageDetailMap(prev => ({ ...prev, [showEditDetailPhoto.name.trim().toLowerCase()]: detail }));
            setShowEditDetailPhoto(null);
            setEditingDetail('');
            addToast('媒体详情已更新', 'success');
        } catch (e: any) {
            addToast(`更新失败: ${e.message || e}`, 'error');
        }
    };

    const coverSrc = (album: AlbumInfo) => (album.coverPath ? previewMap[album.coverPath] : undefined);

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col">
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-xl font-medium text-slate-700 tracking-wide">相册</h1>
                        <p className="text-[10px] text-slate-400 truncate">{galleryRootPath || '未配置相册实体路径'}</p>
                    </div>
                    <button onClick={scanGallery} className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 font-bold">刷新</button>
                </div>
            </div>

            {!galleryRootPath ? (
                <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4 text-slate-400">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">🖼️</div>
                    <p className="text-sm leading-relaxed">请先在设置中配置「实体相册路径」，Gallery 将直接映射该目录做增删改查与预览。</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
                    <div className="px-4 pt-4 pb-3">
                        <div className="flex gap-2 mb-3">
                            <button onClick={() => setShowCreateAlbum(true)} className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold">新建相册</button>
                            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 rounded-xl bg-violet-500 text-white text-xs font-bold">导入媒体</button>
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple onChange={handleUpload} className="hidden" />
                        <p className="text-[10px] text-slate-400">手动上传媒体需填写详情（30字内），聊天新图详情由 Agent 自动生成。</p>
                    </div>

                    <div className="px-4">
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">相册集</h2>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setActiveAlbum('all')} className={`rounded-2xl border p-3 text-left ${activeAlbum === 'all' ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}>
                                <div className="text-sm font-bold text-slate-700">全部照片</div>
                                <div className="text-[11px] text-slate-400 mt-1">{photos.length} 张</div>
                            </button>
                            <button onClick={() => setActiveAlbum('root')} className={`rounded-2xl border p-3 text-left ${activeAlbum === 'root' ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}>
                                <div className="text-sm font-bold text-slate-700">最近项目</div>
                                <div className="text-[11px] text-slate-400 mt-1">{photos.filter(p => p.path.split('/').filter(Boolean).length === 1).length} 张</div>
                            </button>
                            {albums.map(album => (
                                <div key={album.path} className={`rounded-2xl border p-3 ${activeAlbum === album.name ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}>
                                    <button onClick={() => setActiveAlbum(album.name)} className="w-full text-left">
                                        <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 mb-2 flex items-center justify-center p-1.5">
                                            {coverSrc(album) ? (
                                                <img src={coverSrc(album)} className="w-full h-full object-contain" onLoad={() => { }} />
                                            ) : (
                                                <span className="text-2xl">📁</span>
                                            )}
                                        </div>
                                        <div className="text-sm font-bold text-slate-700 truncate">{album.name}</div>
                                        <div className="text-[11px] text-slate-400 mt-1">{album.count} 张</div>
                                    </button>
                                    <div className="mt-2 flex gap-1">
                                        <button onClick={() => { setShowRenameAlbum(album); setRenamingAlbumName(album.name); }} className="flex-1 text-[10px] py-1.5 rounded-lg bg-slate-100 text-slate-600 font-bold">重命名</button>
                                        <button onClick={() => handleDeleteAlbum(album)} className="flex-1 text-[10px] py-1.5 rounded-lg bg-red-50 text-red-500 font-bold">删除</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="px-4 pt-5">
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">媒体预览</h2>
                        {isLoading ? (
                            <div className="h-28 flex items-center justify-center text-slate-400 text-sm">正在扫描相册目录...</div>
                        ) : filteredPhotos.length === 0 ? (
                            <div className="h-28 flex items-center justify-center text-slate-400 text-sm">暂无媒体</div>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-2 bg-white rounded-2xl border border-slate-200 p-2">
                                    {visiblePhotos.map(photo => (
                                        <button
                                            key={photo.path}
                                            onClick={async () => {
                                                await loadPreview(photo);
                                                setSelectedPhoto(photo);
                                            }}
                                            className="aspect-square bg-slate-100 relative rounded-xl overflow-hidden border border-slate-200/80"
                                        >
                                            {previewMap[photo.path] ? (
                                                <div className="w-full h-full p-1.5 bg-gradient-to-b from-slate-50 to-slate-100">
                                                    {isVideoName(photo.name) ? (
                                                        <div className="w-full h-full relative rounded-lg overflow-hidden">
                                                            <video src={previewMap[photo.path]} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="w-7 h-7 rounded-full bg-black/35 flex items-center justify-center">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white"><path d="M8.28 5.22A.75.75 0 0 0 7 5.75v12.5a.75.75 0 0 0 1.28.53l9.25-6.25a.75.75 0 0 0 0-1.06L8.28 5.22Z" /></svg>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <img src={previewMap[photo.path]} className="w-full h-full object-contain" loading="lazy" />
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">🖼️</div>
                                            )}
                                            {getImageDetail(photo.name) && (
                                                <div className="absolute left-1 right-1 bottom-1 px-1.5 py-0.5 bg-black/45 text-white text-[10px] rounded truncate">
                                                    {getImageDetail(photo.name)}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                {filteredPhotos.length > visibleCount && (
                                    <button onClick={() => setVisibleCount(v => v + 60)} className="w-full mt-2 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">
                                        加载更多 ({filteredPhotos.length - visibleCount})
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            <Modal
                isOpen={showCreateAlbum}
                title="新建相册"
                onClose={() => setShowCreateAlbum(false)}
                footer={
                    <>
                        <button onClick={() => setShowCreateAlbum(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={handleCreateAlbum} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">创建</button>
                    </>
                }
            >
                <input
                    value={newAlbumName}
                    onChange={e => setNewAlbumName(e.target.value)}
                    placeholder="输入相册名称"
                    className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                />
            </Modal>

            <Modal
                isOpen={!!showRenameAlbum}
                title="重命名相册"
                onClose={() => setShowRenameAlbum(null)}
                footer={
                    <>
                        <button onClick={() => setShowRenameAlbum(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={handleRenameAlbum} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button>
                    </>
                }
            >
                <input
                    value={renamingAlbumName}
                    onChange={e => setRenamingAlbumName(e.target.value)}
                    placeholder="输入新名称"
                    className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                />
            </Modal>

            <Modal
                isOpen={!!showRenamePhoto}
                title="重命名图片"
                onClose={() => setShowRenamePhoto(null)}
                footer={
                    <>
                        <button onClick={() => setShowRenamePhoto(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={handleRenamePhoto} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button>
                    </>
                }
            >
                <input
                    value={renamingPhotoName}
                    onChange={e => setRenamingPhotoName(e.target.value)}
                    placeholder="输入新文件名"
                    className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm"
                />
            </Modal>

            <Modal
                isOpen={!!selectedPhoto}
                title={selectedPhoto?.name || '预览'}
                onClose={() => setSelectedPhoto(null)}
                footer={
                    <>
                        <button onClick={() => selectedPhoto && handleDeletePhoto(selectedPhoto)} className="flex-1 py-3 bg-red-50 text-red-500 font-bold rounded-2xl">删除</button>
                        <button onClick={() => {
                            if (!selectedPhoto) return;
                            setShowMovePhoto(selectedPhoto);
                            setMoveTargetAlbum(selectedPhoto.path.split('/').filter(Boolean).length === 1 ? 'root' : selectedPhoto.album);
                        }} className="flex-1 py-3 bg-violet-50 text-violet-600 font-bold rounded-2xl">移动</button>
                        <button onClick={() => {
                            if (!selectedPhoto) return;
                            setShowRenamePhoto(selectedPhoto);
                            setRenamingPhotoName(selectedPhoto.name.replace(/\.[^/.]+$/, ''));
                            setSelectedPhoto(null);
                        }} className="flex-1 py-3 bg-slate-100 rounded-2xl">重命名</button>
                    </>
                }
            >
                <div className="rounded-2xl overflow-hidden bg-black/90">
                    {selectedPhoto && previewMap[selectedPhoto.path] ? (
                        isVideoName(selectedPhoto.name) ? (
                            <video
                                ref={selectedVideoRef}
                                src={previewMap[selectedPhoto.path]}
                                controls
                                className="w-full max-h-[55vh] object-contain mx-auto"
                                onClick={(e) => {
                                    const v = e.currentTarget;
                                    if (v.paused) v.play();
                                    else v.pause();
                                }}
                            />
                        ) : (
                            <img src={previewMap[selectedPhoto.path]} className="w-full max-h-[55vh] object-contain mx-auto" />
                        )
                    ) : (
                        <div className="h-56 flex items-center justify-center text-white/50">预览加载中...</div>
                    )}
                </div>
                {selectedPhoto && (
                    <div className="mt-2 space-y-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-[10px] text-slate-400 mb-1">媒体详情</div>
                            <div className="text-xs text-slate-600 leading-relaxed">{getImageDetail(selectedPhoto.name) || '暂无详情，建议补充方便后续检索。'}</div>
                            <button
                                onClick={() => {
                                    setShowEditDetailPhoto(selectedPhoto);
                                    setEditingDetail(getImageDetail(selectedPhoto.name));
                                }}
                                className="mt-2 text-[10px] px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600"
                            >
                                编辑详情
                            </button>
                        </div>
                        <div className="text-[11px] text-slate-400">
                            <div>路径: {selectedPhoto.path}</div>
                            <div>大小: {Math.round(selectedPhoto.size / 1024)} KB</div>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={!!showMovePhoto}
                title="移动到相册"
                onClose={() => setShowMovePhoto(null)}
                footer={
                    <>
                        <button onClick={() => setShowMovePhoto(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={handleMovePhoto} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">确认移动</button>
                    </>
                }
            >
                <div className="space-y-2">
                    <button
                        onClick={() => setMoveTargetAlbum('root')}
                        className={`w-full p-3 rounded-xl border text-left ${moveTargetAlbum === 'root' ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'}`}
                    >
                        <div className="text-sm font-bold text-slate-700">最近项目（根目录）</div>
                        <div className="text-[11px] text-slate-400 mt-1">不归入具体相册集</div>
                    </button>
                    {albums.map(a => (
                        <button
                            key={`move-${a.path}`}
                            onClick={() => setMoveTargetAlbum(a.name)}
                            className={`w-full p-3 rounded-xl border text-left ${moveTargetAlbum === a.name ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'}`}
                        >
                            <div className="text-sm font-bold text-slate-700">{a.name}</div>
                            <div className="text-[11px] text-slate-400 mt-1">{a.count} 张</div>
                        </button>
                    ))}
                    {albums.length === 0 && (
                        <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
                            还没有相册集，请先在顶部创建相册。
                        </div>
                    )}
                </div>
            </Modal>

            <Modal
                isOpen={showUploadDetailModal}
                title="填写媒体详情"
                onClose={() => {
                    if (isSubmittingUpload) return;
                    setShowUploadDetailModal(false);
                    setPendingUploads([]);
                    setUploadDetails({});
                }}
                footer={
                    <>
                        <button
                            onClick={() => {
                                if (isSubmittingUpload) return;
                                setShowUploadDetailModal(false);
                                setPendingUploads([]);
                                setUploadDetails({});
                            }}
                            className="flex-1 py-3 bg-slate-100 rounded-2xl"
                        >
                            取消
                        </button>
                        <button onClick={handleConfirmUpload} disabled={isSubmittingUpload} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">
                            {isSubmittingUpload ? '导入中...' : '确认导入'}
                        </button>
                    </>
                }
            >
                <div className="space-y-3 max-h-[48vh] overflow-y-auto no-scrollbar pr-1">
                    <div className="text-[11px] text-slate-400">每个媒体文件都需要填写详情（不超过30字）。</div>
                    {pendingUploads.map(item => (
                        <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-bold text-slate-700 truncate mb-2">{item.file.name}</div>
                            <input
                                value={uploadDetails[item.id] || ''}
                                onChange={e => setUploadDetails(prev => ({ ...prev, [item.id]: e.target.value.slice(0, 30) }))}
                                placeholder="例如：海边夕阳风景、黑猫侧脸"
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs"
                            />
                            <div className="text-[10px] text-slate-400 mt-1 text-right">{(uploadDetails[item.id] || '').length}/30</div>
                        </div>
                    ))}
                </div>
            </Modal>

            <Modal
                isOpen={!!showEditDetailPhoto}
                title="编辑媒体详情"
                onClose={() => setShowEditDetailPhoto(null)}
                footer={
                    <>
                        <button onClick={() => setShowEditDetailPhoto(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                        <button onClick={handleSaveDetail} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button>
                    </>
                }
            >
                <textarea
                    value={editingDetail}
                    onChange={e => setEditingDetail(e.target.value.slice(0, 30))}
                    placeholder="输入媒体详情，不超过30字"
                    className="w-full h-24 bg-slate-100 rounded-2xl p-3 resize-none text-sm"
                />
                <div className="text-[10px] text-slate-400 mt-1 text-right">{editingDetail.length}/30</div>
            </Modal>
        </div>
    );
};

export default Gallery;
