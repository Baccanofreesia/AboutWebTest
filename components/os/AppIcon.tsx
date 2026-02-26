
import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { useOS } from '../../context/OSContext';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

const AppIcon: React.FC<AppIconProps> = ({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];

  // Standard sizes
  const sizeClasses = size === 'lg' ? 'w-[4.5rem] h-[4.5rem]' : 'w-[4rem] h-[4rem]';

  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group relative"
    >
      {/* Container: Glass Prism with internal glow */}
      <div className={`${sizeClasses} relative flex items-center justify-center 
        bg-white/10 backdrop-blur-xl rounded-[1.2rem]
        border-t border-l border-white/40 border-b border-r border-white/10
        shadow-[0_8px_16px_rgba(0,0,0,0.2)]
        transition-all duration-300
        group-hover:bg-white/20 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] group-hover:border-white/60
        group-active:scale-95
      `}>
        
        {/* Shine effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent rounded-[1.2rem] opacity-0 group-hover:opacity-100 transition-opacity"></div>

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.2rem]" alt={app.name} />
        ) : (
            <div className="w-[50%] h-[50%] text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)] opacity-90 group-hover:opacity-100 transition-opacity">
                 <IconComponent className="w-full h-full" />
            </div>
        )}
      </div>
      
      {!hideLabel && (
        <span className={`text-[10px] font-bold text-white tracking-widest uppercase opacity-80 group-hover:opacity-100 text-shadow-md transition-opacity ${variant === 'dock' ? 'hidden' : 'block'}`}>
          {app.name}
        </span>
      )}
    </button>
  );
};

export default AppIcon;
