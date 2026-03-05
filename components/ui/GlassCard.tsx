import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  onClick?: () => void;
  theme?: 'dark' | 'light';
}

const GlassCard: React.FC<GlassCardProps> = ({ 
  children, 
  className = "", 
  hoverEffect = false,
  onClick,
  theme = 'dark'
}) => {
  const bgClass = theme === 'light' 
    ? 'bg-white/60 border-white/40 text-slate-800 shadow-md' 
    : 'bg-glass-100 border-glass-border text-white shadow-lg';

  const hoverClass = theme === 'light'
    ? 'hover:bg-white/80 hover:scale-[1.02] hover:shadow-xl'
    : 'hover:bg-glass-200 hover:scale-[1.02] hover:shadow-xl';

  return (
    <div 
      onClick={onClick}
      className={`
        relative overflow-hidden
        backdrop-blur-md 
        border
        rounded-2xl
        transition-all duration-300 ease-out
        ${bgClass}
        ${hoverEffect ? `${hoverClass} cursor-pointer` : ''}
        ${className}
      `}
    >
      {/* Glossy shine effect - subtle change based on theme */}
      <div className={`absolute top-0 left-0 w-full h-full pointer-events-none ${theme === 'light' ? 'bg-gradient-to-br from-white/40 to-transparent' : 'bg-gradient-to-br from-white/10 to-transparent'}`} />
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};

export default GlassCard;