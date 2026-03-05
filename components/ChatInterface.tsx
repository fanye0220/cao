import React, { useState, useEffect, useRef } from 'react';
import { Character, Message, Theme } from '../types';
import GlassCard from './ui/GlassCard';
import { streamChatResponse } from '../services/geminiService';
import { Send, ArrowLeft, RefreshCw, Zap } from 'lucide-react';

interface ChatInterfaceProps {
  character: Character;
  onBack: () => void;
  theme: Theme;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ character, onBack, theme }) => {
  // Retrieve session or init new one
  const getInitialMessages = (): Message[] => {
    try {
      const saved = localStorage.getItem(`chat_${character.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error("Failed to parse chat history", e);
    }
    return [{
      id: 'init',
      role: 'model',
      content: character.firstMessage,
      timestamp: Date.now()
    }];
  };

  const [messages, setMessages] = useState<Message[]>(getInitialMessages);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Save to local storage whenever messages change
  useEffect(() => {
    localStorage.setItem(`chat_${character.id}`, JSON.stringify(messages));
    scrollToBottom();
  }, [messages, character.id]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const handleSend = async (textOverride?: string) => {
    const textToSend = textOverride || input;
    if (!textToSend.trim() || isTyping) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };

    // Optimistically add user message
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    
    if (!textOverride) setInput('');
    setIsTyping(true);

    // Create a placeholder for the AI response
    const aiMsgId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'model',
      content: '', // Start empty
      timestamp: Date.now()
    }]);

    try {
      // Pass the history BEFORE the new message, because sendMessageStream will send the new message
      // If we pass newMessages, the model sees the message twice (once in history, once as new input)
      const stream = streamChatResponse(character, messages, textToSend);
      
      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        setMessages(prev => prev.map(m => 
          m.id === aiMsgId ? { ...m, content: fullText } : m
        ));
        scrollToBottom();
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => prev.map(m => 
        m.id === aiMsgId ? { ...m, content: "[Error: Connection failed. Please check your API key.]" } : m
      ));
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearChat = () => {
    if(window.confirm("确定要开始新的对话吗？这将清除当前历史记录。")) {
       setMessages([{
        id: crypto.randomUUID(),
        role: 'model',
        content: character.firstMessage,
        timestamp: Date.now()
      }]);
    }
  };

  const textColor = theme === 'light' ? 'text-slate-800' : 'text-white';
  const subTextColor = theme === 'light' ? 'text-slate-500' : 'text-blue-200';
  const headerBtnClass = theme === 'light' ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-white/10 text-white';

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      {/* Header */}
      <GlassCard theme={theme} className="p-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 rounded-full transition-colors ${headerBtnClass}`}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
             <div className={`w-10 h-10 rounded-full overflow-hidden border ${theme === 'light' ? 'border-slate-300' : 'border-white/30'}`}>
                <img 
                  src={character.avatarUrl} 
                  alt={character.name} 
                  className="w-full h-full object-cover"
                />
             </div>
             <div>
               <h3 className={`font-bold text-lg leading-none ${textColor}`}>{character.name}</h3>
               <span className={`text-xs ${subTextColor}`}>Online</span>
             </div>
          </div>
        </div>
        <div className="flex gap-2">
            <button onClick={handleClearChat} className={`p-2 transition-colors ${theme === 'light' ? 'text-slate-400 hover:text-red-500' : 'text-white/50 hover:text-red-300'}`} title="重置对话">
                <RefreshCw size={20} />
            </button>
        </div>
      </GlassCard>

      {/* Messages Area */}
      <GlassCard theme={theme} className={`flex-1 min-h-0 flex flex-col p-0 backdrop-blur-sm ${theme === 'light' ? 'bg-white/40' : 'bg-glass-100/50'}`}>
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth"
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            
            let bubbleClass = '';
            if (isUser) {
                bubbleClass = theme === 'light' 
                    ? 'bg-blue-500 text-white border-blue-600/20' 
                    : 'bg-blue-600/60 text-white border-blue-400/30';
            } else {
                bubbleClass = theme === 'light'
                    ? 'bg-white text-slate-800 border-slate-200 shadow-sm'
                    : 'bg-white/10 text-white border-white/10';
            }

            return (
              <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`
                  max-w-[80%] md:max-w-[70%] 
                  rounded-2xl p-4 
                  border
                  ${isUser ? `rounded-tr-sm ${bubbleClass}` : `rounded-tl-sm ${bubbleClass}`}
                `}>
                  {!isUser && (
                     <div className={`text-xs mb-1 font-bold opacity-75 ${theme === 'light' ? 'text-blue-600' : 'text-blue-200'}`}>{character.name}</div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })}
          {isTyping && (
             <div className="flex justify-start animate-pulse">
                <div className={`rounded-2xl p-3 px-6 rounded-tl-sm border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-white/5 border-white/5'}`}>
                   <div className="flex gap-1">
                     <span className={`w-2 h-2 rounded-full ${theme === 'light' ? 'bg-slate-400' : 'bg-white/50'}`}></span>
                     <span className={`w-2 h-2 rounded-full ${theme === 'light' ? 'bg-slate-400' : 'bg-white/50'}`}></span>
                     <span className={`w-2 h-2 rounded-full ${theme === 'light' ? 'bg-slate-400' : 'bg-white/50'}`}></span>
                   </div>
                </div>
             </div>
          )}
        </div>

        {/* QR Actions & Input Area */}
        <div className={`p-4 border-t ${theme === 'light' ? 'border-slate-200 bg-slate-50/50' : 'border-white/10 bg-black/10'}`}>
          
          {/* QR Quick Actions */}
          {character.qrList && character.qrList.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-3 custom-scrollbar mb-1">
              {character.qrList.map((qr) => (
                <button
                  key={qr.id}
                  onClick={() => handleSend(qr.message)}
                  disabled={isTyping}
                  className={`
                    whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border backdrop-blur-sm transition-all flex items-center gap-1
                    ${theme === 'light' 
                      ? 'bg-white border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 shadow-sm' 
                      : 'bg-blue-500/10 border-blue-400/30 text-blue-200 hover:bg-blue-500/30 hover:text-white'}
                  `}
                >
                  <Zap size={10} />
                  {qr.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2">
            <textarea 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={`发送消息给 ${character.name}...`}
              className={`w-full border rounded-xl px-4 py-3 focus:outline-none resize-none max-h-32 min-h-[50px] custom-scrollbar transition-colors
                 ${theme === 'light'
                   ? 'bg-white border-slate-300 text-slate-800 focus:border-blue-400 placeholder-slate-400' 
                   : 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:bg-white/10 focus:border-blue-400/30'}
              `}
              rows={1}
            />
            <button 
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className={`p-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg
                ${theme === 'light' 
                  ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                  : 'bg-blue-500/80 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]'}
              `}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

export default ChatInterface;