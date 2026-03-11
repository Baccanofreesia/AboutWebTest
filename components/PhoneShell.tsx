

import React, { useEffect, ErrorInfo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import StatusBar from './os/StatusBar';
import Launcher from '../apps/Launcher';
import Settings from '../apps/Settings';
import Chat from '../apps/Chat';
import ThemeMaker from '../apps/ThemeMaker';
import Appearance from '../apps/Appearance';
import CheckPhoneApp from '../apps/CheckPhoneApp';
import Gallery from '../apps/Gallery';
import DateApp from '../apps/DateApp';
import UserApp from '../apps/UserApp';
import JournalApp from '../apps/JournalApp';
import ScheduleApp from '../apps/ScheduleApp';
import StudyApp from '../apps/StudyApp';
import XhsFreeRoamApp from '../apps/XhsFreeRoamApp';
import MusicApp from '../apps/MusicApp';
import BrowserApp from '../apps/BrowserApp';
import { AppID } from '../types';
import { App as CapApp } from '@capacitor/app';
import { StatusBar as CapStatusBar } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';

// --- Dynamic Agent Apps Registry ---
const agentModules = (import.meta as any).glob('../apps/agent_apps/*.tsx');
const AgentAppMap: Record<string, React.LazyExoticComponent<React.FC>> = {};
for (const path in agentModules) {
  const fileName = path.split('/').pop()?.replace('.tsx', '');
  if (fileName) {
    AgentAppMap[fileName] = React.lazy(agentModules[path] as any);
  }
}
console.log("PhoneShell loaded AgentAppMap with keys:", Object.keys(AgentAppMap));

// --- Agent App Error Boundary ---
class AgentErrorBoundary extends React.Component<{ appName: string, onCloseApp: () => void, children: React.ReactNode }, { hasError: boolean, errorMessage: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Agent App [${this.props.appName}] crashed:`, error, errorInfo);

    // Silently report to DB so the Agent can see the crash log and auto-fix it
    const crashLog = `[系统: 你开发的 App "${this.props.appName}" 运行时发生了崩溃！请检查并使用 <create_app> 重新发布修复版本。]\n[报错信息]: ${error.message}\n[堆栈]: ${errorInfo.componentStack}`;

    // We don't have the active charId easily here since PhoneShell is global, 
    // but we can query the active char or simply broadcast to the chat system.
    // For now, we will save it to the DB attached to the currently active character if possible.
    // Alternatively, we save it with charId: localStorage.getItem('activeCharId') || '1'
    const activeCharId = localStorage.getItem('nova_active_char_id') || '1';

    DB.saveMessage({
      charId: activeCharId,
      role: 'system',
      type: 'text',
      content: crashLog
    }).catch(e => console.error("Failed to dump crash log to DB", e));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 bg-red-50 flex flex-col items-center justify-center p-6 z-50">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">{this.props.appName} 崩溃了</h2>
          <p className="text-xs text-slate-500 text-center mb-6">Nova 已经收到崩溃报告，正在抢修中...</p>
          <div className="bg-white p-3 rounded-lg border border-red-100 w-full max-h-32 overflow-y-auto mb-6">
            <pre className="text-[10px] text-red-500 font-mono whitespace-pre-wrap">{this.state.errorMessage}</pre>
          </div>
          <button onClick={this.props.onCloseApp} className="px-6 py-2 bg-slate-800 text-white rounded-full font-bold shadow-lg hover:scale-105 transition-transform active:scale-95">返回桌面</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Agent App Global Wrapper ---
const AgentAppWrapper: React.FC<{ appName: string, onClose: () => void, children: React.ReactNode }> = ({ appName, onClose, children }) => {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50 relative z-10 overflow-hidden animate-fade-in-up">
      {/* Universal Header */}
      <div className="h-16 flex items-center px-4 bg-white/90 backdrop-blur-xl border-b border-slate-200 shrink-0 pt-6 z-50">
        <button onClick={onClose} className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors active:scale-90 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5 text-slate-800"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <span className="ml-2 font-bold text-slate-800 text-lg tracking-tight truncate flex-1">{appName}</span>
      </div>
      {/* App Content */}
      <div className="flex-1 relative overflow-y-auto">
        {children}
      </div>
    </div>
  );
};

// Lazy placeholder for CheckPhoneApp (will be created in Phase 2.5)
const CheckPhonePlaceholder: React.FC = () => {
  const { closeApp } = useOS();
  return (
    <div className="h-full w-full bg-gradient-to-br from-violet-50 to-blue-50 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-6xl">📱</div>
      <h2 className="text-xl font-bold text-slate-700">查手机</h2>
      <p className="text-sm text-slate-500 text-center">Phone-in-Phone 功能开发中...</p>
      <button onClick={closeApp} className="mt-4 px-6 py-2 bg-slate-200 rounded-full text-sm font-bold text-slate-600 active:scale-95 transition-transform">
        返回
      </button>
    </div>
  );
};

const PhoneShell: React.FC = () => {
  const { theme, isLocked, unlock, activeApp, closeApp, virtualTime, isDataLoaded, toasts } = useOS();

  // Capacitor Native Handling
  useEffect(() => {
    const initNative = async () => {
      try {
        await CapStatusBar.hide();
        const permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (e) {
        // Likely running in browser, ignore
      }
    };
    initNative();

    // Handle Android Hardware Back Button
    const setupBackButton = async () => {
      try {
        await CapApp.removeAllListeners();
        CapApp.addListener('backButton', ({ canGoBack }) => {
          if (activeApp !== AppID.Launcher) {
            closeApp();
          } else if (!isLocked) {
            CapApp.exitApp();
          }
        });
      } catch (e) { console.log('Back button listener setup failed (not native)'); }
    };

    setupBackButton();

    // Listen for Agent App Deployment
    const handleAppDeployed = () => {
      console.log('New Agent App deployed, soft reloading to update Vite glob registry...');
      window.location.reload();
    };
    window.addEventListener('agent_app_deployed', handleAppDeployed);

    return () => {
      CapApp.removeAllListeners().catch(() => { });
      window.removeEventListener('agent_app_deployed', handleAppDeployed);
    };
  }, [activeApp, isLocked, closeApp]);

  if (!isDataLoaded) {
    return <div className="w-full h-full bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div></div>;
  }

  const getBgStyle = (wp: unknown) => {
    const safeWp = typeof wp === 'string' && wp.trim() ? wp : '#0f172a';
    const isUrl = safeWp.startsWith('http') || safeWp.startsWith('data:') || safeWp.startsWith('blob:');
    return isUrl ? `url(${safeWp})` : safeWp;
  };

  const bgImageValue = getBgStyle(theme.wallpaper);
  const contentColor = theme.contentColor || '#ffffff';

  // --- Lock Screen ---
  if (isLocked) {
    return (
      <div
        onClick={unlock}
        className="relative w-full h-full bg-cover bg-center cursor-pointer overflow-hidden group font-light select-none"
        style={{ backgroundImage: bgImageValue, color: contentColor }}
      >
        <div className="absolute inset-0 bg-black/5 backdrop-blur-sm transition-all group-hover:backdrop-blur-none group-hover:bg-transparent duration-700" />
        <div className="absolute top-24 w-full text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
          <div className="text-8xl tracking-tighter opacity-95 font-bold">
            {virtualTime.hours.toString().padStart(2, '0')}<span className="animate-pulse">:</span>{virtualTime.minutes.toString().padStart(2, '0')}
          </div>
          <div className="text-lg tracking-widest opacity-90 mt-2 uppercase text-xs font-bold">NovaClaw</div>
        </div>
        <div className="absolute bottom-12 w-full flex flex-col items-center gap-3 animate-pulse opacity-80 drop-shadow-md">
          <div className="w-1 h-8 rounded-full bg-gradient-to-b from-transparent to-current"></div>
          <span className="text-[10px] tracking-widest uppercase font-semibold">Tap to Unlock</span>
        </div>
      </div>
    );
  }

  // --- App Router ---
  const renderApp = () => {
    switch (activeApp) {
      case AppID.Settings: return <Settings />;
      case AppID.Chat: return null; // Chat is rendered separately to maintain background state
      case AppID.CheckPhone: return <CheckPhoneApp />;
      case AppID.ThemeMaker: return <ThemeMaker />;
      case AppID.Appearance: return <Appearance />;
      case AppID.Gallery: return <Gallery />;
      case AppID.Date: return <DateApp />;
      case AppID.User: return <UserApp />;
      case AppID.Journal: return <JournalApp />;
      case AppID.Schedule: return <ScheduleApp />;
      case AppID.Study: return <StudyApp />;
      case AppID.FreeRoam: return <XhsFreeRoamApp />;
      case AppID.Music: return <MusicApp />;
      case AppID.Browser: return <BrowserApp />;
      case AppID.Launcher:
      default:
        if (AgentAppMap[activeApp as string]) {
          const TargetAgentApp = AgentAppMap[activeApp as string];
          return (
            <React.Suspense fallback={<div className="flex w-full h-full items-center justify-center bg-slate-900"><div className="text-white/60 animate-pulse text-sm font-bold tracking-widest uppercase">Booting Agent App...</div></div>}>
              <AgentErrorBoundary appName={activeApp as string} onCloseApp={closeApp}>
                <AgentAppWrapper appName={activeApp as string} onClose={closeApp}>
                  <TargetAgentApp />
                </AgentAppWrapper>
              </AgentErrorBoundary>
            </React.Suspense>
          );
        }
        return <Launcher />;
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-gradient-to-br from-blue-100 via-violet-100 to-indigo-100 text-slate-900 font-sans select-none">
      {/* Wallpaper Layer */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{
          backgroundImage: bgImageValue,
          transform: activeApp !== AppID.Launcher ? 'scale(1.1)' : 'scale(1)',
          opacity: activeApp !== AppID.Launcher ? 0.6 : 1,
          filter: activeApp !== AppID.Launcher ? 'blur(10px)' : 'blur(0px)',
        }}
      />

      {/* App Background Overlay (Glass Effect) */}
      <div className={`absolute inset-0 transition-all duration-500 ${activeApp === AppID.Launcher ? 'bg-transparent' : 'bg-white/50 backdrop-blur-3xl'}`} />

      <div className="relative z-10 w-full h-full flex flex-col">
        <StatusBar />
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {/* Always mount Chat to keep AI engine running, hide when inactive */}
          <div className={`absolute inset-0 ${activeApp === AppID.Chat ? 'z-20 flex flex-col' : 'z-0 hidden'}`}>
            <Chat />
          </div>
          {/* Render other apps */}
          {activeApp !== AppID.Chat && (
            <div className="absolute inset-0 z-20 flex flex-col">
              {renderApp()}
            </div>
          )}
        </div>

        {/* Home Indicator */}
        <div className="absolute bottom-0 left-0 w-full h-6 flex justify-center items-end pb-2 z-50 pointer-events-none">
          <div className="w-32 h-1 bg-slate-900/10 rounded-full backdrop-blur-md"></div>
        </div>
      </div>

      {/* System Toasts */}
      <div className="absolute top-12 left-0 w-full flex flex-col items-center gap-2 pointer-events-none z-[60]">
        {toasts.map(toast => (
          <div key={toast.id} className="animate-fade-in bg-white/95 backdrop-blur-xl px-4 py-3 rounded-2xl shadow-xl border border-black/5 flex items-center gap-3 max-w-[85%] ring-1 ring-white/20">
            {toast.type === 'success' && <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0"></div>}
            {toast.type === 'error' && <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"></div>}
            {toast.type === 'info' && <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></div>}
            <span className="text-xs font-bold text-slate-800 truncate leading-none">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PhoneShell;
