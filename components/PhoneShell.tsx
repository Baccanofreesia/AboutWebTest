
import React, { useEffect, ErrorInfo, useState, useRef } from 'react';
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
import ProfileOnboarding from './os/ProfileOnboarding';
import { needsProfileOnboarding } from '../utils/onboarding';
import CallOverlay from './chat/CallOverlay';

// --- Dynamic Agent Apps Registry ---
const agentModules = (import.meta as any).glob('../apps/agent_apps/*.tsx');
const AgentAppMap: Record<string, React.LazyExoticComponent<React.FC>> = {};
for (const path in agentModules) {
  const fileName = path.split('/').pop()?.replace('.tsx', '');
  if (fileName) {
    AgentAppMap[fileName] = React.lazy(agentModules[path] as any);
  }
}

// --- Agent App Error Boundary ---
class AgentErrorBoundary extends React.Component<{ appName: string, agentName?: string, onCloseApp: () => void, children: React.ReactNode }, { hasError: boolean, errorMessage: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Agent App [${this.props.appName}] crashed:`, error, errorInfo);
    const crashLog = `[系统: 你开发的 App "${this.props.appName}" 运行时发生了崩溃！请检查并使用 <create_app> 重新发布修复版本。]\n[报错信息]: ${error.message}\n[堆栈]: ${errorInfo.componentStack}`;
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
          <p className="text-xs text-slate-500 text-center mb-6">{this.props.agentName || 'Agent'} 已经收到崩溃报告，正在抢修中...</p>
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

// Lazy placeholder for CheckPhoneApp
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

const formatCallDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const PhoneShell: React.FC = () => {
  const { 
    theme, isLocked, unlock, activeApp, closeApp, virtualTime, isDataLoaded, toasts, apiConfig, agent, 
    suspendedCall, resumeCall,
    callState, callDirection, showCallOverlay, setShowCallOverlay, callBubbles, callElapsed, callActionsRef,
    callInput, callInputMode, callMicMuted, callMicActive, callVolumeLevel
  } = useOS();
  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [booting, setBooting] = useState(false);
  const [bootProgress, setBootProgress] = useState(0);
  const [lockBooting, setLockBooting] = useState(false);
  const [lockBootProgress, setLockBootProgress] = useState(0);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Capacitor Native Handling
  useEffect(() => {
    const initNative = async () => {
      try {
        await CapStatusBar.hide();
        const permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (e) { }
    };
    initNative();

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
      } catch (e) { }
    };

    setupBackButton();

    const handleAppDeployed = () => window.location.reload();
    window.addEventListener('agent_app_deployed', handleAppDeployed);

    return () => {
      CapApp.removeAllListeners().catch(() => { });
      window.removeEventListener('agent_app_deployed', handleAppDeployed);
    };
  }, [activeApp, isLocked, closeApp]);

  useEffect(() => {
    if (isLocked || !isDataLoaded) {
      setBooting(false);
      setBootProgress(0);
      return;
    }
    if (showOnboarding) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let completeTimeout: ReturnType<typeof setTimeout> | null = null;
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
    
    const run = async () => {
      const useOverlay = false;
      if (useOverlay) {
        setBooting(true);
        setBootProgress(8);
        let progress = 8;
        intervalId = setInterval(() => {
          progress = Math.min(88, progress + Math.max(1, Math.round((88 - progress) / 5)));
          setBootProgress(progress);
        }, 140);
        safetyTimeout = setTimeout(() => {
          if (cancelled) return;
          setBootProgress(100);
          setBooting(false);
          setShowOnboarding(true);
        }, 6000);
      } else {
        setBooting(false);
        setBootProgress(0);
      }
      try {
        const needs = await needsProfileOnboarding(apiConfig);
        if (cancelled) return;
        if (!needs) {
          if (intervalId) clearInterval(intervalId);
          if (safetyTimeout) clearTimeout(safetyTimeout);
          setShowOnboarding(false);
          setBooting(false);
          setBootProgress(0);
          return;
        }
        if (intervalId) clearInterval(intervalId);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (useOverlay) {
          setBootProgress(100);
          completeTimeout = setTimeout(() => {
            if (cancelled) return;
            setBooting(false);
            setShowOnboarding(true);
          }, 240);
        } else {
          setShowOnboarding(true);
        }
      } catch (e) {
        if (intervalId) clearInterval(intervalId);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (useOverlay) {
          setBootProgress(100);
          completeTimeout = setTimeout(() => {
            if (cancelled) return;
            setBooting(false);
            setShowOnboarding(true);
          }, 240);
        } else {
          setShowOnboarding(true);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (completeTimeout) clearTimeout(completeTimeout);
      if (safetyTimeout) clearTimeout(safetyTimeout);
    };
  }, [apiConfig, isDataLoaded, isLocked, showOnboarding]);

  const beginUnlock = () => {
    if (!isDataLoaded || lockBooting) return;
    setLockBooting(true);
    setLockBootProgress(8);
    const duration = 1000 + Math.round(Math.random() * 1000);
    const start = Date.now();
    if (unlockIntervalRef.current) clearInterval(unlockIntervalRef.current);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const ratio = Math.min(0.92, elapsed / duration);
      setLockBootProgress(Math.max(8, Math.round(ratio * 100)));
    }, 120);
    unlockTimerRef.current = setTimeout(() => {
      if (unlockIntervalRef.current) clearInterval(unlockIntervalRef.current);
      setLockBootProgress(100);
      setLockBooting(false);
      unlock();
    }, duration);
  };

  const getBgStyle = (wp: unknown) => {
    const safeWp = typeof wp === 'string' && wp.trim() ? wp : '#0f172a';
    const isUrl = safeWp.startsWith('http') || safeWp.startsWith('data:') || safeWp.startsWith('blob:');
    return isUrl ? `url(${safeWp})` : safeWp;
  };

  const bgImageValue = getBgStyle(theme.wallpaper);
  const contentColor = theme.contentColor || '#ffffff';

  if (isLocked) {
    return (
      <div
        onClick={beginUnlock}
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
        {!isDataLoaded && (
          <div className="absolute bottom-5 w-full flex justify-center">
            <div className="px-3 py-1.5 rounded-full text-[10px] tracking-widest uppercase bg-black/40 text-white/80 backdrop-blur-md border border-white/10">
              Syncing...
            </div>
          </div>
        )}
        {lockBooting && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-[82%] max-w-[340px] rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(16,16,16,0.85),rgba(8,8,8,0.9))] shadow-[0_0_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl px-6 py-6 text-white overflow-hidden">
              <div className="pointer-events-none absolute inset-0 opacity-[0.15] bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:16px_16px]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />
              <div className="flex items-center justify-between text-[10px] tracking-[0.35em] uppercase opacity-70">
                <span>Unlocking</span>
                <span className="tabular-nums">{lockBootProgress}%</span>
              </div>
              <div className="mt-2 text-lg font-semibold tracking-wide">准备进入</div>
              <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.35),rgba(255,255,255,0.85),rgba(255,255,255,0.35))] transition-all duration-150"
                  style={{ width: `${lockBootProgress}%` }}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/60">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                安全校验中
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const renderApp = () => {
    switch (activeApp) {
      case AppID.Settings: return <Settings />;
      case AppID.Chat: return null;
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
              <AgentErrorBoundary appName={activeApp as string} agentName={agent?.name} onCloseApp={closeApp}>
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
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{
          backgroundImage: bgImageValue,
          transform: activeApp !== AppID.Launcher ? 'scale(1.1)' : 'scale(1)',
          opacity: activeApp !== AppID.Launcher ? 0.6 : 1,
          filter: activeApp !== AppID.Launcher ? 'blur(10px)' : 'blur(0px)',
        }}
      />
      <div className={`absolute inset-0 transition-all duration-500 ${activeApp === AppID.Launcher ? 'bg-transparent' : 'bg-white/50 backdrop-blur-3xl'}`} />
      <div className="relative z-10 w-full h-full flex flex-col">
        <StatusBar />
        {/* Call Overlay (Global) */}
        <CallOverlay
          visible={showCallOverlay}
          callState={callState}
          callDirection={callDirection}
          callStatusLabel={callState === 'connected' ? '进行中' : (callState === 'dialing' || callState === 'ringing' ? '等待中' : '通话结束')}
          callStartedAt={0}
          callElapsed={callElapsed}
          charDisplayName={agent?.nickname || agent?.name || 'Agent'}
          charDisplayAvatar={agent?.displayAvatar || agent?.avatar || ''}
          callBubbles={callBubbles}
          callInputMode={callInputMode}
          callInput={callInput}
          callBusy={callState !== 'idle' && callState !== 'connected'}
          callMicMuted={callMicMuted}
          callMicActive={callMicActive}
          callVolumeLevel={callVolumeLevel}
          formatDuration={formatCallDuration}
          scrollRef={{ current: null } as any}
          onChangeInput={(val) => callActionsRef.current?.onChangeInput(val)}
          onSendText={() => callActionsRef.current?.onSendText()}
          onToggleInputMode={() => callActionsRef.current?.onToggleInputMode()}
          onToggleMute={() => callActionsRef.current?.onToggleMute()}
          onMinimize={() => setShowCallOverlay(false)}
          onCancelOutgoing={() => callActionsRef.current?.onHangup()}
          onAcceptIncoming={() => callActionsRef.current?.onAccept()}
          onDeclineIncoming={() => callActionsRef.current?.onHangup()}
          onHangup={() => callActionsRef.current?.onHangup()}
        />
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <div className={`absolute inset-0 ${activeApp === AppID.Chat ? 'z-20 flex flex-col' : 'z-0 hidden'}`}>
            <Chat />
          </div>
          {activeApp !== AppID.Chat && (
            <div className="absolute inset-0 z-20 flex flex-col">
              {renderApp()}
            </div>
          )}
        </div>
        <div className="absolute bottom-0 left-0 w-full h-6 flex justify-center items-end pb-2 z-50 pointer-events-none">
          <div className="w-32 h-1 bg-slate-900/10 rounded-full backdrop-blur-md"></div>
        </div>
      </div>
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
      {booting && null}
      <ProfileOnboarding
        isOpen={showOnboarding}
        onComplete={() => {
          localStorage.setItem('os_profile_setup_v1', 'true');
          setShowOnboarding(false);
        }}
      />
    </div>
  );
};

export default PhoneShell;
