

import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import AppIcon from '../components/os/AppIcon';
import { DB } from '../utils/db';
import { CharacterProfile, Anniversary } from '../types';

const Launcher: React.FC = () => {
  // Added lastMsgTimestamp to dependencies to trigger refresh on new message
  const { openApp, virtualTime, characters, activeCharacterId, theme, lastMsgTimestamp, isDataLoaded } = useOS();
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  
  // Widget Data
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const gridApps = useMemo(() => 
    INSTALLED_APPS.filter(app => !DOCK_APPS.includes(app.id)), 
    []
  );

  const dockAppsConfig = useMemo(() => 
    DOCK_APPS.map(id => INSTALLED_APPS.find(app => app.id === id)).filter(Boolean) as typeof INSTALLED_APPS,
    []
  );

  useEffect(() => {
      const loadData = async () => {
          if (characters.length === 0) return;
          const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          setWidgetChar(targetChar);

          try {
              const [msgs, annis] = await Promise.all([
                  DB.getMessagesByCharId(targetChar.id),
                  DB.getAllAnniversaries()
              ]);
              
              if (msgs.length > 0) {
                  // Only show message content if it's text/voice/etc, not internal system logs
                  const visibleMsgs = msgs.filter(m => m.role !== 'system');
                  if (visibleMsgs.length > 0) {
                      const last = visibleMsgs[visibleMsgs.length - 1];
                      // Clean up internal tags like [happy] for preview
                      const cleanContent = last.content.replace(/\[.*?\]/g, '').trim();
                      setLastMessage(cleanContent || (last.type === 'image' ? '[图片]' : '[消息]'));
                  } else {
                      setLastMessage(targetChar.description || "System Ready.");
                  }
              } else {
                  setLastMessage(targetChar.description || "System Ready.");
              }
              setAnniversaries(annis);
          } catch (e) {
              console.error(e);
          }
      };
      
      if (isDataLoaded) {
          loadData();
      }
  }, [characters, activeCharacterId, lastMsgTimestamp, isDataLoaded]);

  const handleScroll = () => {
      if (scrollContainerRef.current) {
          const width = scrollContainerRef.current.clientWidth;
          const scrollLeft = scrollContainerRef.current.scrollLeft;
          const index = Math.round(scrollLeft / width);
          setActivePageIndex(index);
      }
  };

  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  
  const now = new Date();
  const dayName = days[now.getDay()];
  const monthName = months[now.getMonth()];
  const dateNum = now.getDate().toString().padStart(2, '0');
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Calendar Logic
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay(); // 0 = Sun
  
  const totalDays = getDaysInMonth(currentYear, currentMonth);
  const startOffset = getFirstDayOfMonth(currentYear, currentMonth);
  
  const calendarDays = Array.from({ length: totalDays }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: startOffset }, () => null);

  const contentColor = theme.contentColor || '#ffffff';

  return (
    <div className="h-full w-full flex flex-col relative z-10 animate-fade-in overflow-hidden font-sans select-none">
      
      {/* --- Visual Elements (Decorative Background) --- */}
      <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 opacity-10" 
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '100px 100px' }} 
          />
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"></div>
      </div>

      {/* --- Scrollable Content Layer --- */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
      >
          
          {/* PAGE 1: APPS */}
          <div className="w-full flex-shrink-0 snap-center flex flex-col px-6 pt-12 pb-8">
            {/* 1. HERO HEADER */}
            <div className="flex flex-col mb-10 mt-6 relative" style={{ color: contentColor }}>
                 <div className="absolute -top-6 left-1 flex items-center gap-2">
                     <div className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border border-white/10" style={{ color: contentColor }}>
                         System Ready
                     </div>
                     <div className="h-[1px] w-20 bg-gradient-to-r from-current to-transparent opacity-40"></div>
                 </div>

                 <div className="flex items-end gap-4">
                     <div className="text-[6.5rem] leading-[0.85] font-bold tracking-tighter drop-shadow-2xl font-sans" style={{ color: contentColor }}>
                        {virtualTime.hours.toString().padStart(2, '0')}
                        <span className="opacity-40 font-light mx-1">:</span>
                        {virtualTime.minutes.toString().padStart(2, '0')}
                     </div>
                     <div className="flex flex-col justify-end pb-3 opacity-90" style={{ color: contentColor }}>
                         <div className="text-3xl font-bold tracking-tight">{dayName}</div>
                         <div className="text-sm font-medium opacity-80 tracking-widest">{monthName} . {dateNum}</div>
                     </div>
                 </div>
            </div>

            {/* 2. CHARACTER CARD */}
            <div className="mb-8 group">
                 <div 
                    className="relative h-28 w-full overflow-hidden rounded-[1.5rem] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl transition-all duration-300 group-hover:bg-white/15 group-hover:scale-[1.01] cursor-pointer"
                    onClick={() => openApp('chat' as any)}
                 >
                     <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-white/5 to-transparent skew-x-12"></div>
                     <div className="absolute inset-0 flex items-center p-4 gap-4">
                         <div className="w-20 h-20 shrink-0 rounded-2xl overflow-hidden shadow-lg border-2 border-white/20 relative bg-slate-800">
                             {widgetChar ? (
                                 <img src={widgetChar.avatar} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="char" />
                             ) : <div className="w-full h-full bg-white/10 animate-pulse"></div>}
                             <div className="absolute bottom-1 right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-black/20 shadow-sm"></div>
                         </div>

                         <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                             <div className="flex items-center gap-2">
                                 <h3 className="text-lg font-bold text-white tracking-wide drop-shadow-md truncate">
                                     {widgetChar?.name || 'NO SIGNAL'}
                                 </h3>
                                 <div className="px-1.5 py-0.5 bg-white/20 rounded text-[9px] font-bold text-white uppercase tracking-wider">Active</div>
                             </div>
                             
                             <div className="relative">
                                 <div className="text-xs text-white/80 line-clamp-2 font-medium leading-relaxed opacity-90 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white/40 mr-1 text-[10px]">▶</span>
                                    {lastMessage}
                                 </div>
                             </div>
                         </div>
                     </div>
                 </div>
            </div>

            {/* 3. APP GRID */}
            <div className="flex-1">
                 <div className="grid grid-cols-4 gap-y-6 gap-x-2 place-items-center">
                     {gridApps.map(app => (
                         <AppIcon key={app.id} app={app} onClick={() => openApp(app.id)} />
                     ))}
                 </div>
            </div>
          </div>

          {/* PAGE 2: WIDGETS */}
          <div className="w-full flex-shrink-0 snap-center flex flex-col px-6 pt-24 pb-8 space-y-6">
              
              {/* CALENDAR WIDGET */}
              <div className="bg-white/10 backdrop-blur-2xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                  <div className="flex justify-between items-center mb-4 text-white">
                      <h3 className="text-xl font-bold tracking-widest">{monthName} {currentYear}</h3>
                      <div onClick={() => openApp('schedule' as any)} className="bg-white/20 p-2 rounded-full cursor-pointer hover:bg-white/40 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-3 gap-x-1 text-center mb-2">
                      {['S','M','T','W','T','F','S'].map(d => <div key={d} className="text-[10px] font-bold text-white/40">{d}</div>)}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-2 gap-x-1 text-center">
                      {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                      {calendarDays.map(day => {
                          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isToday = day === now.getDate();
                          const hasEvent = anniversaries.some(a => a.date === dateStr);
                          
                          return (
                              <div key={day} className="flex flex-col items-center justify-center h-8 relative">
                                  <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium ${isToday ? 'bg-white text-black font-bold shadow-lg' : 'text-white/80'}`}>
                                      {day}
                                  </div>
                                  {hasEvent && <div className="w-1.5 h-1.5 bg-purple-400 rounded-full absolute bottom-0 shadow-sm border border-black/20"></div>}
                              </div>
                          );
                      })}
                  </div>
              </div>

              {/* UPCOMING EVENTS LIST */}
              <div className="bg-white/10 backdrop-blur-2xl rounded-3xl p-5 border border-white/20 shadow-2xl flex-1 overflow-hidden flex flex-col">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 bg-purple-400 rounded-full"></span> Upcoming Events
                  </h3>
                  <div className="space-y-3 overflow-y-auto no-scrollbar">
                      {anniversaries.length > 0 ? anniversaries.sort((a,b) => a.date.localeCompare(b.date)).slice(0, 5).map(anni => (
                          <div key={anni.id} className="flex items-center gap-3 p-3 bg-black/20 rounded-xl border border-white/5">
                              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex flex-col items-center justify-center text-purple-200 border border-purple-500/30">
                                  <span className="text-[9px] opacity-70">{anni.date.split('-')[1]}</span>
                                  <span className="text-sm font-bold leading-none">{anni.date.split('-')[2]}</span>
                              </div>
                              <div className="flex-1">
                                  <div className="text-white text-sm font-bold">{anni.title}</div>
                                  <div className="text-[10px] text-white/50">{characters.find(c => c.id === anni.charId)?.name}</div>
                              </div>
                          </div>
                      )) : (
                          <div className="text-center text-white/30 text-xs py-8">No upcoming events</div>
                      )}
                  </div>
              </div>

          </div>

      </div>

      {/* Page Indicators */}
      <div className="absolute bottom-24 left-0 w-full flex justify-center gap-2 pointer-events-none">
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${activePageIndex === 0 ? 'bg-white w-4' : 'bg-white/40'}`}></div>
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${activePageIndex === 1 ? 'bg-white w-4' : 'bg-white/40'}`}></div>
      </div>

      {/* 4. FLOATING DOCK (Capsule) */}
      <div className="mt-auto pt-4 flex justify-center w-full px-4 mb-4 relative z-20">
           {/* Reduced padding (px-6->4, py-4->3) and gap (gap-6->3) to fix mobile overflow */}
           <div className="bg-white/10 backdrop-blur-2xl rounded-3xl border border-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.3)] px-4 py-3 flex gap-3 sm:gap-6 items-center hover:bg-white/20 transition-colors mx-auto max-w-full justify-between overflow-x-auto no-scrollbar">
               {dockAppsConfig.map(app => (
                   <AppIcon key={app.id} app={app} onClick={() => openApp(app.id)} variant="dock" size="md" />
               ))}
           </div>
      </div>

    </div>
  );
};

export default Launcher;
