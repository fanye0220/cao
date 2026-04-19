import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, RefreshCw, Eye, X } from 'lucide-react';

interface TarotCardDrawProps {
    characters: any[];
    onComplete: () => void;
    onJump?: (char: any) => void;
    onRedraw?: () => void;
    theme: 'light' | 'dark';
}

export function TarotCardDraw({ characters, onComplete, onJump, onRedraw, theme }: TarotCardDrawProps) {
    const [isShuffling, setIsShuffling] = useState(true);
    
    useEffect(() => {
        setIsShuffling(true);
        const timer = setTimeout(() => {
            setIsShuffling(false);
        }, 1500);
        return () => clearTimeout(timer);
    }, [characters]);

    if (!characters || characters.length === 0) return null;

    const isMultiple = characters.length > 1;
    const isLight = theme === 'light';

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className={`w-full max-w-[320px] rounded-[24px] shadow-2xl overflow-hidden flex flex-col ${isLight ? 'bg-[#f4f5f9]' : 'bg-[#1a1b1e] border border-white/10'}`}
            >
                {/* Header */}
                <motion.div layout="position" className="relative pt-5 pb-2 px-6 text-center">
                    <h2 className={`font-bold text-base ${isLight ? 'text-slate-800' : 'text-white'}`}>
                        {isShuffling ? (isMultiple ? '为您挑选档案中...' : '每日抽卡中...') : (isMultiple ? '推荐的档案' : '今日抽卡结果')}
                    </h2>
                    {/* Close button in top right if we want, or rely on bottom actions */}
                </motion.div>

                {/* Content Area */}
                <div className="p-4 pt-2 flex-1 flex flex-col items-center justify-center min-h-[200px]">
                    <AnimatePresence mode="wait">
                        {isShuffling ? (
                            <motion.div
                                key="shuffling"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                                className="flex flex-col items-center w-full"
                            >
                                {/* 3 Cards Shuffling Animation similar to video */}
                                <div className="relative w-48 h-64 mb-6 flex items-center justify-center">
                                    {[0, 1, 2].map((i) => (
                                        <motion.div
                                            key={i}
                                            animate={{ 
                                                rotate: [-8 + i * 8, 0, -8 + i * 8],
                                                y: [0, -15, 0]
                                            }}
                                            transition={{
                                                duration: 1.5,
                                                repeat: Infinity,
                                                ease: "easeInOut",
                                                delay: i * 0.2
                                            }}
                                            className={`absolute w-36 h-48 rounded-2xl shadow-lg border 
                                                ${isLight ? 'bg-gradient-to-tr from-blue-100 to-indigo-50 border-blue-200' : 'bg-gradient-to-tr from-blue-900/40 to-indigo-900/20 border-blue-800/50'}
                                                ${i === 0 ? '-translate-x-8 rotate-[-8deg]' : i === 1 ? 'z-10' : 'translate-x-8 rotate-[8deg]'}`}
                                        />
                                    ))}
                                </div>
                                <div className={`text-sm font-medium flex items-center gap-2 ${isLight ? 'text-blue-600' : 'text-blue-400'}`}>
                                    <Sparkles size={16} className="animate-pulse" />
                                    <span>抽取中...</span>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="result"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                                className="w-full flex flex-col gap-4"
                            >
                                <div className={`text-sm text-center mb-2 font-medium ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                                    {isMultiple ? '为您推荐了以下档案' : '今日抽中了这份档案'}
                                </div>
                                
                                <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto px-1 custom-scrollbar">
                                    {characters.map((char, index) => (
                                        <div key={char.id + index} className={`flex flex-col overflow-hidden rounded-3xl shadow-sm border ${isLight ? 'bg-white border-slate-200' : 'bg-[#2a2b30] border-white/10'}`}>
                                            <div className="w-full aspect-[4/5] relative bg-gray-900 overflow-hidden shrink-0">
                                                <img 
                                                    src={char.avatarUrl || `https://picsum.photos/seed/${char.id}/400/400`} 
                                                    alt={char.name} 
                                                    className="w-full h-full object-cover" 
                                                />
                                                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
                                            </div>
                                            <div className="flex-col flex min-w-0 p-4 pt-3">
                                                <h3 className={`font-bold truncate text-lg mb-1 leading-tight ${isLight ? 'text-slate-800' : 'text-white'}`}>{char.name}</h3>
                                                {char.recommendReason && !isMultiple && (
                                                    <p className={`text-[11px] opacity-80 mb-2 line-clamp-2 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>{char.recommendReason}</p>
                                                )}
                                                <div className="flex flex-wrap gap-1.5 mt-auto">
                                                    {(char.tags || []).slice(0, 3).map((tag: string) => (
                                                        <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${isLight ? 'bg-blue-50 text-blue-700' : 'bg-white/10 text-gray-300'}`}>
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    {(!char.tags || char.tags.length === 0) && (
                                                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${isLight ? 'bg-slate-100 text-slate-600' : 'bg-white/10 text-gray-300'}`}>未分类</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Actions */}
                <AnimatePresence>
                    {!isShuffling && (
                        <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-4 pt-2 flex flex-col gap-2 overflow-hidden"
                        >
                            {!isMultiple && onRedraw && (
                                <button 
                                    onClick={onRedraw} 
                                    disabled={isShuffling}
                                    className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors
                                        ${isLight ? 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-sm' : 'bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10'}`}
                                >
                                    <RefreshCw size={16} />
                                    重新抽取档案
                                </button>
                            )}
                            
                            <button 
                                onClick={() => {
                                    if (onJump && !isMultiple) {
                                        onJump(characters[0]);
                                    } else {
                                        onComplete();
                                    }
                                }} 
                                disabled={isShuffling}
                                className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-colors
                                    ${isLight ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/20' : 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/20'}`}
                            >
                                {!isMultiple && onJump ? <Eye size={16} /> : null}
                                {!isMultiple && onJump ? '跳转查看' : '确定'}
                            </button>
                            
                            {!isMultiple && onJump && (
                                <button 
                                    onClick={onComplete} 
                                    disabled={isShuffling}
                                    className={`w-full py-3 rounded-xl font-medium text-sm transition-colors
                                        ${isLight ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                                >
                                    取消
                                </button>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}
