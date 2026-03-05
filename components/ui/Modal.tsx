import React from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  theme?: 'light' | 'dark';
  maxWidth?: string;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, theme = 'dark', maxWidth = 'max-w-lg' }) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div 
        className={`
          relative w-full ${maxWidth} rounded-2xl shadow-2xl overflow-hidden
          ${theme === 'light' 
            ? 'bg-white/90 text-slate-900 border border-white/20' 
            : 'bg-slate-900/90 text-slate-100 border border-white/10'}
          backdrop-blur-xl transition-all duration-300 transform scale-100
        `}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${theme === 'light' ? 'border-slate-200/50' : 'border-white/10'}`}>
          <h3 className="text-lg font-semibold">{title}</h3>
          <button 
            onClick={onClose}
            className={`p-1 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-slate-400'}`}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
