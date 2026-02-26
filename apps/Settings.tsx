
import React, { useState, useRef, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Modal from '../components/os/Modal';

const Settings: React.FC = () => {
  const { 
      apiConfig, updateApiConfig, closeApp, availableModels, setAvailableModels, 
      exportSystem, importSystem, addToast, resetSystem,
      apiPresets, addApiPreset, removeApiPreset 
  } = useOS();
  
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localModel, setLocalModel] = useState(apiConfig.model);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  
  // UI States
  const [showModelModal, setShowModelModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  
  const [exportContent, setExportContent] = useState('');
  
  const [statusMsg, setStatusMsg] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  // Auto-save draft configs locally to prevent loss during typing
  useEffect(() => {
      setLocalUrl(apiConfig.baseUrl);
      setLocalKey(apiConfig.apiKey);
      setLocalModel(apiConfig.model);
  }, [apiConfig]);

  const loadPreset = (preset: typeof apiPresets[0]) => {
      setLocalUrl(preset.config.baseUrl);
      setLocalKey(preset.config.apiKey);
      setLocalModel(preset.config.model);
      addToast(`已加载配置: ${preset.name}`, 'info');
  };

  const handleSavePreset = () => {
      if (!newPresetName.trim()) {
          addToast('请输入预设名称', 'error');
          return;
      }
      addApiPreset(newPresetName, { baseUrl: localUrl, apiKey: localKey, model: localModel });
      setNewPresetName('');
      setShowPresetModal(false);
      addToast('预设已保存', 'success');
  };

  const handleSaveApi = () => {
    updateApiConfig({ 
      apiKey: localKey, 
      baseUrl: localUrl, 
      model: localModel
    });
    setStatusMsg('配置已保存');
    setTimeout(() => setStatusMsg(''), 2000);
  };

  const fetchModels = async () => {
    if (!localUrl) { setStatusMsg('请先填写 URL'); return; }
    setIsLoadingModels(true);
    setStatusMsg('正在连接...');
    try {
        const baseUrl = localUrl.replace(/\/+$/, '');
        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        // Support various API response formats
        const list = data.data || data.models || [];
        if (Array.isArray(list)) {
            const models = list.map((m: any) => m.id || m);
            setAvailableModels(models);
            if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
            setStatusMsg(`获取到 ${models.length} 个模型`);
            setShowModelModal(true); // Open selector immediately
        } else { setStatusMsg('格式不兼容'); }
    } catch (error: any) {
        console.error(error);
        setStatusMsg('连接失败');
    } finally {
        setIsLoadingModels(false);
    }
  };

  // Browser download helper
  const webDownload = (content: string, filename: string) => {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExport = async (mode: 'data' | 'media') => {
      try {
          let msg = '打包中...';
          if (mode === 'data') msg = '正在导出数据 (包含配置)...';
          if (mode === 'media') msg = '正在打包相册与素材...';
          
          addToast(msg, 'info');
          
          // Delay to allow toast to render before heavy sync operation blocks thread
          setTimeout(async () => {
              try {
                const json = await exportSystem(mode);
                setExportContent(json);
                setShowExportModal(true); 

                // Native Share Handling
                if (Capacitor.isNativePlatform()) {
                    const fileName = `Sully_${mode}_${new Date().toISOString().slice(0,10)}.json`;
                    try {
                        await Filesystem.writeFile({
                            path: fileName,
                            data: json,
                            directory: Directory.Cache, 
                            encoding: Encoding.UTF8,
                        });
                        const uriResult = await Filesystem.getUri({
                            directory: Directory.Cache,
                            path: fileName,
                        });
                        await Share.share({
                            title: `Sully Backup (${mode})`,
                            files: [uriResult.uri],
                        });
                    } catch (nativeErr) {
                        console.log("Native share skipped/failed", nativeErr);
                    }
                } else {
                     // Auto-copy to clipboard on web
                    try {
                        await navigator.clipboard.writeText(json);
                        addToast('已自动复制到剪贴板', 'success');
                    } catch (e) { console.error('Clipboard failed', e); }
                }

              } catch (e: any) {
                  addToast(`导出失败: ${e.message}`, 'error');
              }
          }, 100);
          
      } catch (e: any) {
          addToast(`导出错误: ${e.message}`, 'error');
      }
  };

  const handleWebFileDownload = () => {
      const fileName = `Sully_Backup_${new Date().toISOString().slice(0,10)}.json`;
      webDownload(exportContent, fileName);
      addToast('已触发浏览器下载', 'success');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
          const json = ev.target?.result as string;
          if (importInputRef.current) importInputRef.current.value = '';

          if (!json) {
              addToast('文件内容为空', 'error');
              return;
          }

          try {
              addToast('正在解析数据...', 'info');
              await importSystem(json);
          } catch (err: any) {
              console.error(err);
              addToast(err.message || '恢复失败', 'error');
          }
      };

      reader.onerror = () => {
          addToast(`读取文件失败`, 'error');
          if (importInputRef.current) importInputRef.current.value = '';
      };

      reader.readAsText(file);
  };

  const confirmReset = () => {
      resetSystem();
      setShowResetConfirm(false);
  };

  return (
    <div className="h-full w-full bg-slate-50/50 flex flex-col font-light">
      {/* Header */}
      <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-2 w-full">
            <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <h1 className="text-xl font-medium text-slate-700 tracking-wide">系统设置</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar pb-20">
        
        {/* 数据备份区域 */}
        <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-blue-100 rounded-xl text-blue-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
                </div>
                <h2 className="text-sm font-semibold text-slate-600 tracking-wider">备份与恢复</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mb-3">
                <button onClick={() => handleExport('data')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 px-1.5 py-0.5 bg-blue-100 text-[9px] text-blue-600 rounded-bl-lg font-bold">含配置</div>
                    <div className="p-2 bg-blue-50 rounded-full text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg></div>
                    <span>数据备份</span>
                </button>
                 <button onClick={() => handleExport('media')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2">
                    <div className="p-2 bg-pink-50 rounded-full text-pink-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg></div>
                    <span>相册/素材备份</span>
                </button>
            </div>

            <div className="grid grid-cols-1 gap-3 mb-4">
                 <div onClick={() => importInputRef.current?.click()} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 cursor-pointer hover:bg-emerald-50 hover:border-emerald-200">
                    <div className="p-2 bg-emerald-100 rounded-full text-emerald-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></div>
                    <span>导入/恢复备份</span>
                </div>
                <input type="file" ref={importInputRef} className="hidden" accept=".json" onChange={handleImport} />
            </div>
            
            <p className="text-[10px] text-slate-400 px-1 mb-4 leading-relaxed">
                • <b>数据备份</b>: 包含角色、聊天、设置、API密钥和预设。体积小，推荐日常使用。<br/>
                • <b>相册备份</b>: 仅包含相册图片、壁纸等大型素材。<br/>
                • 请妥善保管包含 API 密钥的备份文件。
            </p>
            
            <button onClick={() => setShowResetConfirm(true)} className="w-full py-3 bg-red-50 border border-red-100 text-red-500 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                格式化系统 (出厂设置)
            </button>
        </section>

        {/* AI 连接设置区域 */}
        <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
             <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-emerald-100/50 rounded-xl text-emerald-600">
                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                    </div>
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">API 配置</h2>
                </div>
                <button onClick={() => setShowPresetModal(true)} className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">
                    保存为预设
                </button>
            </div>

            {/* Presets List */}
            {apiPresets.length > 0 && (
                <div className="mb-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">我的预设 (Presets)</label>
                    <div className="flex gap-2 flex-wrap">
                        {apiPresets.map(preset => (
                            <div key={preset.id} className="flex items-center bg-white border border-slate-200 rounded-lg pl-3 pr-1 py-1 shadow-sm">
                                <span onClick={() => loadPreset(preset)} className="text-xs font-medium text-slate-600 cursor-pointer hover:text-primary mr-2">{preset.name}</span>
                                <button onClick={() => removeApiPreset(preset.id)} className="p-1 rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            <div className="space-y-4">
                <div className="group">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                    <input type="text" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="https://..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
                </div>

                <div className="group">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Key</label>
                    <input type="password" value={localKey} onChange={(e) => setLocalKey(e.target.value)} placeholder="sk-..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
                </div>

                <div className="pt-2">
                     <div className="flex justify-between items-center mb-1.5 pl-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                        <button onClick={fetchModels} disabled={isLoadingModels} className="text-[10px] text-primary font-bold">{isLoadingModels ? 'Fetching...' : '刷新模型列表'}</button>
                    </div>
                    
                    <button 
                        onClick={() => setShowModelModal(true)}
                        className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center active:bg-white transition-all shadow-sm"
                    >
                        <span className="truncate font-mono">{localModel || 'Select Model...'}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                    </button>
                </div>
                
                <button onClick={handleSaveApi} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-primary/20 bg-primary active:scale-95 transition-all mt-2">
                    {statusMsg || '保存配置'}
                </button>
            </div>
        </section>

        <div className="text-center text-[10px] text-slate-300 pb-8 font-mono tracking-widest uppercase">
            v1.4 (Simplified)
        </div>
      </div>

      {/* 模型选择 Modal */}
      <Modal isOpen={showModelModal} title="选择模型" onClose={() => setShowModelModal(false)}>
        <div className="max-h-[50vh] overflow-y-auto no-scrollbar space-y-2 p-1">
            {availableModels.length > 0 ? availableModels.map(m => (
                <button key={m} onClick={() => { setLocalModel(m); setShowModelModal(false); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono flex justify-between items-center ${m === localModel ? 'bg-primary/10 text-primary font-bold ring-1 ring-primary/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                    <span className="truncate">{m}</span>
                    {m === localModel && <div className="w-2 h-2 rounded-full bg-primary"></div>}
                </button>
            )) : <div className="text-center text-slate-400 py-8 text-xs">列表为空，请先点击“刷新模型列表”</div>}
        </div>
      </Modal>

      {/* Preset Name Modal */}
      <Modal isOpen={showPresetModal} title="保存预设" onClose={() => setShowPresetModal(false)} footer={<button onClick={handleSavePreset} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存</button>}>
          <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase">预设名称 (例如: DeepSeek)</label>
              <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} className="w-full bg-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-primary" autoFocus placeholder="Name..." />
          </div>
      </Modal>

      {/* 强制导出 Modal */}
      <Modal isOpen={showExportModal} title="备份数据" onClose={() => setShowExportModal(false)} footer={
          <div className="flex gap-2 w-full">
               <button onClick={() => { navigator.clipboard.writeText(exportContent); addToast('已复制', 'success'); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">复制 JSON</button>
               {Capacitor.isNativePlatform() ? (
                   <div className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
                       <span>已尝试唤起分享</span>
                   </div>
               ) : (
                   <button onClick={handleWebFileDownload} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                        下载文件
                   </button>
               )}
          </div>
      }>
          <div className="space-y-2">
              <p className="text-[10px] text-slate-500">数据已生成。如果自动分享未触发，请点击下方按钮。</p>
              <textarea value={exportContent} readOnly className="w-full h-40 bg-slate-100 rounded-xl p-3 text-[10px] font-mono text-slate-500 resize-none focus:outline-none" onClick={(e) => e.currentTarget.select()} />
          </div>
      </Modal>

      {/* 确认重置 Modal */}
      <Modal
          isOpen={showResetConfirm}
          title="系统警告"
          onClose={() => setShowResetConfirm(false)}
          footer={
              <div className="flex gap-2 w-full">
                  <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button>
                  <button onClick={confirmReset} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认格式化</button>
              </div>
          }
      >
          <div className="flex flex-col items-center gap-3 py-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <p className="text-center text-sm text-slate-600 font-medium">
                  这将<span className="text-red-500 font-bold">永久删除</span>所有角色、聊天记录和设置，且无法恢复！
              </p>
          </div>
      </Modal>

    </div>
  );
};

export default Settings;
