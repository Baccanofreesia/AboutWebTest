
import React from 'react';
import { useOS } from '../../context/OSContext';

const StatusBar: React.FC = () => {
  const { virtualTime, theme } = useOS();
  
  // Format numbers to have leading zeros
  const format = (n: number) => n.toString().padStart(2, '0');

  // Use content color from theme
  const textColor = theme.contentColor || '#ffffff';

  return (
    <div 
        className="h-10 w-full flex justify-between items-center px-6 text-xs font-semibold z-50 absolute top-0 left-0 bg-transparent transition-colors duration-500"
        style={{ color: textColor }}
    >
      <div className="w-1/3">
        <span>{format(virtualTime.hours)}:{format(virtualTime.minutes)}</span>
      </div>
      <div className="w-1/3 flex justify-center">
        {/* Notch Area spacer */}
      </div>
      <div className="w-1/3 flex justify-end gap-2 items-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.204 3.182a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182a1.5 1.5 0 0 1 2.122 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0l-.53-.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
        <div className="flex items-center gap-1">
          <span className="text-[10px]">85%</span>
          <div className="w-5 h-2.5 border border-current rounded-[2px] p-[1px] relative opacity-80">
            <div className="h-full w-[85%] bg-current rounded-[1px]"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
