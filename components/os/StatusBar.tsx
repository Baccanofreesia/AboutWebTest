
import React, { useState, useEffect } from 'react';
import { useOS } from '../../context/OSContext';

// --- Battery & Network hooks (Browser APIs, future: Android SDK via Capacitor) ---

const useBattery = () => {
  const [battery, setBattery] = useState({ level: 0.85, charging: false, supported: false });

  useEffect(() => {
    let bm: any = null;
    const update = (b: any) => setBattery({ level: b.level, charging: b.charging, supported: true });

    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((b: any) => {
        bm = b;
        update(b);
        b.addEventListener('levelchange', () => update(b));
        b.addEventListener('chargingchange', () => update(b));
      }).catch(() => { });
    }
    return () => {
      if (bm) {
        bm.removeEventListener('levelchange', () => { });
        bm.removeEventListener('chargingchange', () => { });
      }
    };
  }, []);
  return battery;
};

const useNetwork = () => {
  const [signal, setSignal] = useState(4); // 1-4 bars, default full

  useEffect(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return;

    const calc = () => {
      const dl = conn.downlink ?? 10; // Mbps
      if (dl >= 10) setSignal(4);
      else if (dl >= 5) setSignal(3);
      else if (dl >= 1) setSignal(2);
      else setSignal(1);
    };
    calc();
    conn.addEventListener('change', calc);
    return () => conn.removeEventListener('change', calc);
  }, []);
  return signal;
};

// --- WiFi Icon with variable signal bars ---
const WifiIcon: React.FC<{ bars: number }> = ({ bars }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
    {/* Arc 4 (outermost) */}
    {bars >= 4 && <path d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" />}
    {bars < 4 && <path d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" opacity={0.2} />}
    {/* Arc 3 */}
    {bars >= 3 && <path d="M4.553 11.325c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" />}
    {bars < 3 && <path d="M4.553 11.325c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" opacity={0.2} />}
    {/* Arc 2 */}
    {bars >= 2 && <path d="M7.757 14.507a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" />}
    {bars < 2 && <path d="M7.757 14.507a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Z" opacity={0.2} />}
    {/* Dot (always on) */}
    <path d="M10.939 17.689a1.5 1.5 0 0 1 2.122 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0l-.53-.53a.75.75 0 0 1 0-1.06Z" />
  </svg>
);

const StatusBar: React.FC = () => {
  const { virtualTime } = useOS();
  const battery = useBattery();
  const wifiBars = useNetwork();

  const format = (n: number) => n.toString().padStart(2, '0');
  const pct = Math.round(battery.level * 100);

  return (
    <div className="h-10 w-full flex justify-between items-center px-6 text-xs font-semibold z-50 absolute top-0 left-0 bg-transparent mix-blend-difference text-white pointer-events-none transition-colors duration-500">
      <div className="w-1/3">
        <span>{format(virtualTime.hours)}:{format(virtualTime.minutes)}</span>
      </div>
      <div className="w-1/3 flex justify-center">
        {/* Notch Area spacer */}
      </div>
      <div className="w-1/3 flex justify-end gap-2 items-center">
        <WifiIcon bars={wifiBars} />
        <div className="flex items-center gap-1">
          <span className="text-[10px]">{pct}%</span>
          <div className="w-5 h-2.5 border border-current rounded-[2px] p-[1px] relative opacity-80">
            <div className="h-full bg-current rounded-[1px] transition-all duration-500" style={{ width: `${pct}%` }}></div>
            {/* Charging bolt */}
            {battery.charging && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-2 h-2 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-sm">
                <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .914-.143Z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;

