
import React, { useState, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { OSTheme } from '../types';
import { INSTALLED_APPS, Icons } from '../constants';
import { processImage } from '../utils/file';

const Appearance: React.FC = () => {
  const { theme, updateTheme, closeApp, setCustomIcon, customIcons, addToast } = useOS();
  const [activeTab, setActiveTab] = useState<'theme' | 'icons'>('theme');
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  const THEME_PRESETS: { name: string, config: Partial<OSTheme>, color: string }[] = [
      { name: 'Indigo', config: { hue: 245, saturation: 25, lightness: 65, contentColor: '#ffffff' }, color: 'hsl(245, 25%, 65%)' },
      { name: 'Sakura', config: { hue: 350, saturation: 70, lightness: 80, contentColor: '#334155' }, color: 'hsl(350, 70%, 80%)' },
      { name: 'Cyber', config: { hue: 170, saturation: 100, lightness: 45, contentColor: '#ffffff' }, color: 'hsl(170, 100%, 45%)' },
      { name: 'Noir', config: { hue: 0, saturation: 0, lightness: 20, contentColor: '#ffffff' }, color: 'hsl(0, 0%, 20%)' },
      { name: 'Sunset', config: { hue: 20, saturation: 90, lightness: 60, contentColor: '#ffffff' }, color: 'hsl(20, 90%, 60%)' },
  ];

  const handleWallpaperUpload = async (file: File) => {
      try {
          addToast('正在处理壁纸...', 'info');
          const dataUrl = await processImage(file);
          updateTheme({ wallpaper: dataUrl });
          addToast('壁纸更新成功', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const handleIconUpload = async (file: File) => {
      if (!selectedAppId) return;
      try {
          const dataUrl = await processImage(file);
          setCustomIcon(selectedAppId, dataUrl);
          addToast('应用图标已更新', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  return (
    <div className="h-full w-full bg-slate-50 flex flex-col font-light">
      <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-2 w-full">
            <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <h1 className="text-xl font-medium text-slate-700 tracking-wide">外观定制</h1>
        </div>
      </div>

      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20">
          <button onClick={() => setActiveTab('theme')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'theme' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>系统主题</button>
          <button onClick={() => setActiveTab('icons')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'icons' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>应用图标</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        {activeTab === 'theme' ? (
            <>
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Preset Themes</h2>
                    <div className="flex gap-3 mb-6 overflow-x-auto no-scrollbar pb-1">
                        {THEME_PRESETS.map(preset => (
                            <button 
                                key={preset.name}
                                onClick={() => updateTheme(preset.config)}
                                className="flex flex-col items-center gap-1.5 shrink-0 group"
                            >
                                <div className="w-10 h-10 rounded-full shadow-sm border-2 border-white ring-1 ring-black/5 transition-transform group-active:scale-95" style={{ backgroundColor: preset.color }}></div>
                                <span className="text-[10px] text-slate-500 font-medium">{preset.name}</span>
                            </button>
                        ))}
                    </div>

                    <div className="space-y-5">
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Hue</span><span>{theme.hue}°</span>
                            </div>
                            <input type="range" min="0" max="360" value={theme.hue} onChange={(e) => updateTheme({ hue: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                            <div className="h-2 w-full rounded-full mt-3 opacity-50" style={{ background: `linear-gradient(to right, hsl(0, 50%, 80%), hsl(60, 50%, 80%), hsl(120, 50%, 80%), hsl(180, 50%, 80%), hsl(240, 50%, 80%), hsl(300, 50%, 80%), hsl(360, 50%, 80%))`}}></div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Saturation</span><span>{theme.saturation}%</span>
                            </div>
                            <input type="range" min="0" max="100" value={theme.saturation} onChange={(e) => updateTheme({ saturation: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Text/Widget Color</span>
                            </div>
                            <div className="flex gap-4 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#ffffff' })}
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#ffffff' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#ffffff' }}
                                />
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#334155' })} // Slate-700
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#334155' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#334155' }}
                                />
                                <div className="h-6 w-px bg-slate-200 mx-1"></div>
                                <input 
                                    type="color" 
                                    value={theme.contentColor || '#ffffff'} 
                                    onChange={(e) => updateTheme({ contentColor: e.target.value })}
                                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent p-0" 
                                />
                                <span className="text-xs text-slate-400 font-mono">{theme.contentColor}</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Wallpaper</h2>
                    <div className="aspect-[9/16] w-1/2 mx-auto bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-4 group cursor-pointer" onClick={() => wallpaperInputRef.current?.click()}>
                         <img src={theme.wallpaper} className="w-full h-full object-cover" />
                         <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                             <span className="text-white text-xs font-bold bg-black/20 px-3 py-1 rounded-full backdrop-blur-md">更换壁纸</span>
                         </div>
                    </div>
                    <input type="file" ref={wallpaperInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWallpaperUpload(e.target.files[0])} />
                    <p className="text-center text-[10px] text-slate-400">点击预览图上传新壁纸</p>
                </section>
            </>
        ) : (
            <div className="grid grid-cols-3 gap-4">
                {INSTALLED_APPS.map(app => {
                    const Icon = Icons[app.icon];
                    const customUrl = customIcons[app.id];
                    return (
                        <div key={app.id} className="flex flex-col items-center gap-2">
                             <div 
                                className="w-16 h-16 rounded-2xl shadow-sm bg-slate-200 overflow-hidden relative group cursor-pointer"
                                onClick={() => { setSelectedAppId(app.id); iconInputRef.current?.click(); }}
                             >
                                 {customUrl ? (
                                     <img src={customUrl} className="w-full h-full object-cover" />
                                 ) : (
                                     <div className={`w-full h-full ${app.color} flex items-center justify-center text-white`}>
                                         <Icon className="w-8 h-8" />
                                     </div>
                                 )}
                                 <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                 </div>
                             </div>
                             <span className="text-[10px] text-slate-500 font-medium">{app.name}</span>
                             {customUrl && (
                                 <button onClick={() => setCustomIcon(app.id, undefined)} className="text-[10px] text-red-400">重置</button>
                             )}
                        </div>
                    );
                })}
                <input type="file" ref={iconInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleIconUpload(e.target.files[0])} />
            </div>
        )}
      </div>
    </div>
  );
};

export default Appearance;
