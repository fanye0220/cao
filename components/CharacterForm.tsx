import React, { useState, useRef } from 'react';
import { Character, Theme } from '../types';
import GlassCard from './ui/GlassCard';
import Button from './ui/Button';
import { parseQrFile, exportCharacterData, exportQrData } from '../services/cardImportService';
import { X, User, MessageSquare, BookOpen, Upload, ExternalLink, FileJson, Book, Plus, Trash2, Tag, Save, RotateCcw, FileText, QrCode, Layers, Image as ImageIcon, Download, Pen, Eye, Maximize, Check, Info, UserPen, Smile, Map, MessageSquareQuote, Terminal, ScrollText } from 'lucide-react';

interface CharacterFormProps {
  initialData?: Character;
  onSave: (char: Character) => void;
  onCancel: () => void;
  onDelete?: (id: string, skipConfirm?: boolean) => void;
  theme: Theme;
}

const CharacterForm: React.FC<CharacterFormProps> = ({ initialData, onSave, onCancel, onDelete, theme }) => {
  const [formData, setFormData] = useState<Partial<Character>>(initialData || {
    name: '',
    description: '',
    personality: '',
    firstMessage: '',
    alternate_greetings: [],
    avatarUrl: `https://picsum.photos/seed/${Math.random()}/400/400`,
    scenario: '',
    character_book: { entries: [] },
    tags: [],
    qrList: [],
    originalFilename: '',
    sourceUrl: '',
    cardUrl: initialData?.cardUrl || initialData?.originalFilename || '',
    extra_qr_data: {}
  });
  
  const [qrFileName, setQrFileName] = useState<string>(initialData?.qrList && initialData.qrList.length > 0 ? 'imported_config.json' : '');
  
  // First Message Modal State
  const [showFirstMesModal, setShowFirstMesModal] = useState(false);
  const [viewingAltIndex, setViewingAltIndex] = useState(-1);
  const [firstMesPreview, setFirstMesPreview] = useState(false);
  
  // Edit Mode State
  const [isEditingFirstMes, setIsEditingFirstMes] = useState(false);
  const [tempFirstMes, setTempFirstMes] = useState('');

  // World Info Modal State
  const [showWorldInfoModal, setShowWorldInfoModal] = useState(false);
  const [viewingWorldInfoIndex, setViewingWorldInfoIndex] = useState(-1);
  const [isEditingWorldInfo, setIsEditingWorldInfo] = useState(false);
  const [tempWorldInfo, setTempWorldInfo] = useState<any>(null);

  // Reset edit mode when switching messages or closing modal
  React.useEffect(() => {
      setIsEditingFirstMes(false);
      setTempFirstMes('');
  }, [viewingAltIndex, showFirstMesModal]);

  React.useEffect(() => {
      setIsEditingWorldInfo(false);
      setTempWorldInfo(null);
  }, [viewingWorldInfoIndex, showWorldInfoModal]);

  // Helper to get/set current message in modal
  const getCurrentMessage = () => {
      if (viewingAltIndex === -1) return formData.firstMessage || '';
      return formData.alternate_greetings?.[viewingAltIndex] || '';
  };

  const updateCurrentMessage = (val: string) => {
      if (viewingAltIndex === -1) {
          setFormData(prev => ({ ...prev, firstMessage: val }));
      } else {
          const newGreetings = [...(formData.alternate_greetings || [])];
          newGreetings[viewingAltIndex] = val;
          setFormData(prev => ({ ...prev, alternate_greetings: newGreetings }));
      }
  };

  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

  // Handlers
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ 
          ...prev, 
          avatarUrl: URL.createObjectURL(file)
      }));
    }
  };

  const handleQrFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { list, raw } = await parseQrFile(file);
      setFormData(prev => ({ 
          ...prev, 
          qrList: list,
          extra_qr_data: raw, // Store raw data for export
          qrFileName: file.name
      }));
      alert(`成功绑定 ${list.length} 个 QR 动作!`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      if (qrFileInputRef.current) qrFileInputRef.current.value = '';
    }
  };

  const handleQrExport = () => {
      if (!formData.qrList || formData.qrList.length === 0) {
          alert("没有可导出的 QR 数据");
          return;
      }
      exportQrData(formData.qrList, formData.extra_qr_data, formData.qrFileName);
  };

  const handleClearQr = () => {
      if (confirm("确定要清除当前的 QR 配置吗？")) {
          setFormData(prev => ({
              ...prev,
              qrList: [],
              extra_qr_data: {},
              qrFileName: ''
          }));
      }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.currentTarget.value.trim();
      const currentTags = Array.isArray(formData.tags) ? formData.tags : [];
      if (val && !currentTags.includes(val)) {
        setFormData(prev => ({ ...prev, tags: [...currentTags, val] }));
        e.currentTarget.value = '';
      }
    }
  };

  const removeTag = (tag: string) => {
    const currentTags = Array.isArray(formData.tags) ? formData.tags : [];
    setFormData(prev => ({ ...prev, tags: currentTags.filter(t => t !== tag) }));
  };

  const handleAddAltGreeting = () => {
    setFormData(prev => ({ ...prev, alternate_greetings: [...(prev.alternate_greetings || []), ''] }));
  };

  const updateAltGreeting = (index: number, val: string) => {
    const newGreetings = [...(formData.alternate_greetings || [])];
    newGreetings[index] = val;
    setFormData(prev => ({ ...prev, alternate_greetings: newGreetings }));
  };

  const removeAltGreeting = (index: number) => {
    setFormData(prev => ({ ...prev, alternate_greetings: prev.alternate_greetings?.filter((_, i) => i !== index) }));
  };

  // World Info Handlers
  const handleAddWorldInfo = () => {
      const newEntry = { keys: [], content: '', name: 'New Entry', insertion_order: 50, case_sensitive: false };
      setFormData(prev => {
          const book = prev.character_book || { entries: [] };
          return { ...prev, character_book: { ...book, entries: [...(book.entries || []), newEntry] } };
      });
      setViewingWorldInfoIndex((formData.character_book?.entries?.length || 0));
      setTempWorldInfo(newEntry);
      setIsEditingWorldInfo(true);
  };

  const removeWorldInfo = (index: number) => {
      if (confirm('确定要删除这个世界书条目吗？')) {
          setFormData(prev => {
              const book = prev.character_book;
              if (!book) return prev;
              const newEntries = [...(book.entries || [])];
              newEntries.splice(index, 1);
              return { ...prev, character_book: { ...book, entries: newEntries } };
          });
          if (viewingWorldInfoIndex === index) setViewingWorldInfoIndex(-1);
          else if (viewingWorldInfoIndex > index) setViewingWorldInfoIndex(viewingWorldInfoIndex - 1);
      }
  };

  const updateWorldInfo = (index: number, entry: any) => {
      setFormData(prev => {
          const book = prev.character_book;
          if (!book) return prev;
          const newEntries = [...(book.entries || [])];
          newEntries[index] = entry;
          return { ...prev, character_book: { ...book, entries: newEntries } };
      });
  };

  // Check if any actual content has changed compared to initialData
  const hasContentChanged = (): boolean => {
      if (!initialData) return true; // New character

      const fieldsToCompare: (keyof Character)[] = [
          'name', 'description', 'personality', 'firstMessage', 'scenario',
          'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
          'creator', 'character_version', 'avatarUrl', 'sourceUrl', 'originalFilename'
      ];

      for (const field of fieldsToCompare) {
          if ((formData[field] || '') !== (initialData[field] || '')) {
              return true;
          }
      }

      // Deep compare arrays and objects
      if (JSON.stringify(formData.alternate_greetings || []) !== JSON.stringify(initialData.alternate_greetings || [])) return true;
      if (JSON.stringify(formData.tags || []) !== JSON.stringify(initialData.tags || [])) return true;
      if (JSON.stringify(formData.qrList || []) !== JSON.stringify(initialData.qrList || [])) return true;
      if (JSON.stringify(formData.character_book || {}) !== JSON.stringify(initialData.character_book || {})) return true;
      if (JSON.stringify(formData.extensions || {}) !== JSON.stringify(initialData.extensions || {})) return true;

      return false;
  };

  // Construct the full character object for saving/exporting
  const getFullCharacter = (): Character => {
      const changed = hasContentChanged();
      const now = Date.now();
      
      return {
          ...initialData,
          id: initialData?.id || crypto.randomUUID(),
          name: formData.name || "Unknown",
          description: formData.description || '',
          personality: formData.personality || '',
          firstMessage: formData.firstMessage || '',
          alternate_greetings: formData.alternate_greetings || [],
          avatarUrl: formData.avatarUrl!,
          scenario: formData.scenario || '',
          mes_example: formData.mes_example || '',
          creator_notes: formData.creator_notes || '',
          system_prompt: formData.system_prompt || '',
          post_history_instructions: formData.post_history_instructions || '',
          creator: formData.creator || '',
          character_version: formData.character_version || '',
          extensions: formData.extensions || {},
          character_book: formData.character_book,
          tags: formData.tags || [],
          qrList: formData.qrList || [],
          extra_qr_data: formData.extra_qr_data,
          qrFileName: formData.qrFileName,
          originalFilename: formData.originalFilename,
          sourceUrl: formData.sourceUrl || '',
          cardUrl: formData.cardUrl || '',
          updatedAt: changed ? now : (initialData?.updatedAt || now),
          importDate: initialData?.importDate || now,
          fileLastModified: changed ? now : (initialData?.fileLastModified || now)
      };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      setError("名字是必填项。");
      return;
    }
    onSave(getFullCharacter());
  };

  const handleExport = async (exportType: 'png' | 'json' | 'package') => {
      if (!formData.name) {
          setError("请先填写角色名称");
          return;
      }
      
      const char = getFullCharacter();
      
      let targetFormat: 'png' | 'json' = 'png';
      let forceZip = false;

      if (exportType === 'package') {
          // Determine format based on importFormat. Default to 'png' if unknown.
          targetFormat = (char.importFormat === 'json') ? 'json' : 'png';
          forceZip = true;
          
          if (!char.qrList || char.qrList.length === 0) {
              alert("没有绑定 QR 动作，无法打包。");
              return;
          }
      } else {
          targetFormat = exportType;
      }

      // Check if trying to export PNG from a JSON-imported character (or one without a proper avatar)
      if (targetFormat === 'png' && char.importFormat === 'json') {
          // Check if user has uploaded a new avatar (blob url) or still using placeholder
          if (formData.avatarUrl?.includes('picsum.photos')) {
               if (!window.confirm("该角色是通过 JSON 导入的，且似乎没有上传自定义头像（当前是随机占位图）。\n导出 PNG 会将数据嵌入到这张占位图中。\n\n确定要继续吗？建议先在编辑页面上传一张图片。")) {
                   return;
               }
          }
      }

      try {
          await exportCharacterData(char, targetFormat, forceZip);
      } catch (err: any) {
          setError(err.message);
      }
  };

  // Styles
  const labelColor = theme === 'light' ? 'text-slate-500 font-bold text-xs uppercase tracking-wider' : 'text-blue-200/70 font-bold text-xs uppercase tracking-wider';
  const inputBg = theme === 'light' ? 'bg-white/50 border-slate-200 text-slate-800 focus:border-blue-400 focus:bg-white' : 'bg-black/20 border-white/10 text-white focus:border-white/30 focus:bg-black/30';
  const sectionTitle = `text-lg font-bold flex items-center gap-2 mb-4 ${theme === 'light' ? 'text-slate-700' : 'text-white'}`;
  const dividerClass = theme === 'light' ? 'border-slate-200' : 'border-white/10';

  return (
    <div className="h-full w-full max-w-4xl mx-auto p-4 md:p-6 animate-fade-in flex flex-col relative">
       
       {/* Dynamic Background */}
       <div className="fixed inset-0 z-0 pointer-events-none">
           <div 
               className="absolute inset-0 bg-cover bg-center transition-all duration-700 opacity-80 scale-110"
               style={{ backgroundImage: `url(${formData.avatarUrl})` }}
           />
           <div className={`absolute inset-0 backdrop-blur-[40px] ${theme === 'light' ? 'bg-white/30' : 'bg-[#0f172a]/30'}`} />
           <div className={`absolute inset-0 ${theme === 'light' ? 'bg-gradient-to-b from-white/20 to-white/60' : 'bg-gradient-to-b from-black/10 to-[#0f172a]/60'}`} />
       </div>

       {/* Header Actions (Fixed relative to content) */}
       <div className="flex justify-end mb-4 shrink-0 relative z-50 gap-2">
           {initialData && onDelete && (
               <button 
                   onClick={() => {
                       if (window.confirm(`确定删除 ${formData.name || '此角色'} 吗?`)) {
                           onDelete(initialData.id, true);
                           onCancel(); // Return to list after delete
                       }
                   }}
                   className={`p-3 rounded-full backdrop-blur-md border transition-all duration-300 shadow-lg ${theme === 'light' ? 'bg-white/80 border-slate-300 hover:bg-red-50 text-red-500' : 'bg-black/20 border-white/10 hover:bg-red-500/20 text-red-400'}`}
                   title="删除角色"
               >
                   <Trash2 size={20} />
               </button>
           )}
           <button 
               onClick={handleSubmit} 
               className={`p-3 rounded-full backdrop-blur-md border transition-all duration-300 shadow-lg ${theme === 'light' ? 'bg-white/80 border-slate-300 hover:bg-white text-slate-500' : 'bg-black/20 border-white/10 hover:bg-black/40 text-gray-400'}`}
               title="保存并返回"
           >
               <X size={20} />
           </button>
       </div>

       {/* Main Scroll Container */}
       <div className="flex-1 overflow-y-auto custom-scrollbar pb-32 relative z-10">
          
          {/* 1. Identity Card (Avatar + Basic Info) */}
          <GlassCard theme={theme} className="p-6 mb-6 !bg-opacity-80">
             {/* Internal Header */}
             <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center gap-3">
                   <h2 className={`text-xl font-bold ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>
                       {formData.name ? '编辑角色' : '新建角色'}
                   </h2>
                 </div>
             </div>

             <div className="flex flex-col md:flex-row gap-8">
                 {/* Left: Avatar */}
                 <div className="shrink-0 flex flex-col items-center md:items-start gap-3 w-full md:w-auto">
                     <div className={`w-64 h-64 rounded-2xl overflow-hidden relative group shadow-2xl ${theme === 'light' ? 'bg-slate-200' : 'bg-black/40'}`}>
                        <img src={formData.avatarUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                        <div onClick={() => avatarInputRef.current?.click()} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer backdrop-blur-sm">
                            <Upload size={32} className="mb-2 opacity-90" /> 
                            <span className="font-bold text-sm">更换头像</span>
                        </div>
                     </div>
                     <input type="file" accept="image/*" className="hidden" ref={avatarInputRef} onChange={handleAvatarChange} />

                     <input 
                        value={formData.originalFilename || ''}
                        onChange={e => setFormData({...formData, originalFilename: e.target.value})}
                        placeholder="文件名"
                        className={`w-64 rounded-xl px-3 py-3 text-sm outline-none transition-all text-center ${inputBg}`}
                     />
                 </div>

                 {/* Right: Inputs */}
                 <div className="flex-1 space-y-5 w-full">
                    <div>
                        <label className={`block mb-2 ${labelColor}`}>角色名称 (NAME)</label>
                        <input 
                            value={formData.name} 
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className={`w-full rounded-xl px-4 py-3 text-lg font-bold outline-none transition-all ${inputBg}`}
                            placeholder="Unknown"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={`block mb-2 ${labelColor}`}>导入时间 (IMPORTED)</label>
                            <div className={`w-full rounded-xl px-4 py-3 text-sm font-mono opacity-80 truncate ${inputBg}`}>
                                {formData.importDate ? new Date(formData.importDate).toLocaleString() : 'Unknown'}
                            </div>
                        </div>
                        <div>
                            <label className={`block mb-2 ${labelColor}`}>本地修改时间 (MODIFIED)</label>
                            <div className={`w-full rounded-xl px-4 py-3 text-sm font-mono opacity-80 truncate ${inputBg}`}>
                                {formData.fileLastModified ? new Date(formData.fileLastModified).toLocaleString() : new Date().toLocaleString()}
                            </div>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={`block mb-2 ${labelColor}`}>标签 (TAGS)</label>
                            <div className={`w-full rounded-xl px-3 py-2 min-h-[46px] flex flex-wrap gap-2 transition-all ${inputBg}`}>
                                {(Array.isArray(formData.tags) ? formData.tags : []).map(tag => (
                                    <span key={tag} className="px-2 py-1 rounded-md bg-white/10 text-xs font-bold flex items-center gap-1 cursor-default border border-white/10">
                                        {tag}
                                        <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-400"><X size={10}/></button>
                                    </span>
                                ))}
                                <input 
                                    className="bg-transparent focus:outline-none text-sm min-w-[60px] px-1 py-1 flex-1"
                                    placeholder="+ Tag"
                                    onKeyDown={handleAddTag}
                                    onBlur={(e) => {
                                        const val = e.target.value.trim();
                                        const currentTags = Array.isArray(formData.tags) ? formData.tags : [];
                                        if (val && !currentTags.includes(val)) {
                                            setFormData(prev => ({ ...prev, tags: [...currentTags, val] }));
                                            e.target.value = '';
                                        }
                                    }}
                                />
                            </div>
                       </div>
                       <div>
                            <label className={`block mb-2 ${labelColor}`}>来源链接 (SOURCE)</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text"
                                    value={formData.sourceUrl}
                                    onChange={(e) => setFormData({...formData, sourceUrl: e.target.value})}
                                    placeholder="https://..."
                                    className={`flex-1 rounded-xl px-4 py-3 text-sm outline-none transition-all ${inputBg}`}
                                />
                                {formData.sourceUrl && (
                                    <a 
                                        href={formData.sourceUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className={`p-3 rounded-xl transition-colors flex items-center justify-center ${theme === 'light' ? 'bg-slate-200 hover:bg-slate-300 text-slate-600' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                                        title="打开链接"
                                    >
                                        <ExternalLink size={18} />
                                    </a>
                                )}
                            </div>
                       </div>
                    </div>
                 </div>
             </div>
          </GlassCard>

          {/* 1.5 Character Status Info (Editable if exists) */}
          {(formData.creator_notes || formData.system_prompt || formData.post_history_instructions || formData.scenario || formData.personality || formData.mes_example) && (
              <GlassCard theme={theme} className="p-6 mb-6 !bg-opacity-60">
                  <div className={sectionTitle}><Info size={20}/> 角色详细信息</div>
                  <div className="space-y-6">
                      {/* Creator Notes */}
                      {(formData.creator_notes || formData.extensions?.chub?.version) && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <UserPen className="w-3 h-3" /> 作者备注
                                  {formData.extensions?.chub?.version && (
                                      <span className="text-[10px] font-medium normal-case ml-1">v{formData.extensions.chub.version}</span>
                                  )}
                              </div>
                              <textarea 
                                  rows={3}
                                  value={formData.creator_notes || ''}
                                  onChange={e => setFormData({...formData, creator_notes: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all custom-scrollbar ${inputBg}`}
                                  placeholder="作者备注..."
                              />
                          </div>
                      )}

                      {/* Personality */}
                      {formData.personality && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <Smile className="w-3 h-3" /> 性格特征
                              </div>
                              <textarea 
                                  rows={4}
                                  value={formData.personality || ''}
                                  onChange={e => setFormData({...formData, personality: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all custom-scrollbar ${inputBg}`}
                                  placeholder="性格特征..."
                              />
                          </div>
                      )}

                      {/* Scenario */}
                      {formData.scenario && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <Map className="w-3 h-3" /> 场景设定
                              </div>
                              <textarea 
                                  rows={4}
                                  value={formData.scenario || ''}
                                  onChange={e => setFormData({...formData, scenario: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all custom-scrollbar ${inputBg}`}
                                  placeholder="场景设定..."
                              />
                          </div>
                      )}

                      {/* Message Examples */}
                      {formData.mes_example && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <MessageSquareQuote className="w-3 h-3" /> 对话示例
                              </div>
                              <textarea 
                                  rows={6}
                                  value={formData.mes_example || ''}
                                  onChange={e => setFormData({...formData, mes_example: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all font-mono custom-scrollbar ${inputBg}`}
                                  placeholder="对话示例..."
                              />
                          </div>
                      )}

                      {/* System Prompt */}
                      {formData.system_prompt && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <Terminal className="w-3 h-3" /> 系统提示词
                              </div>
                              <textarea 
                                  rows={4}
                                  value={formData.system_prompt || ''}
                                  onChange={e => setFormData({...formData, system_prompt: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all font-mono custom-scrollbar ${inputBg}`}
                                  placeholder="系统提示词..."
                              />
                          </div>
                      )}

                      {/* Post History Instructions */}
                      {formData.post_history_instructions && (
                          <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                  <ScrollText className="w-3 h-3" /> 历史记录指令
                              </div>
                              <textarea 
                                  rows={4}
                                  value={formData.post_history_instructions || ''}
                                  onChange={e => setFormData({...formData, post_history_instructions: e.target.value})}
                                  className={`w-full rounded-xl px-4 py-3 text-sm resize-y outline-none transition-all font-mono custom-scrollbar ${inputBg}`}
                                  placeholder="历史记录指令..."
                              />
                          </div>
                      )}
                  </div>
              </GlassCard>
          )}

          {/* 2. Details Card */}
          <GlassCard theme={theme} className="p-6 mb-6 !bg-opacity-60">
              <div className={sectionTitle}><BookOpen size={20}/> 详细设定</div>
              <div className="space-y-6">
                <div>
                    <label className={`block mb-2 ${labelColor}`}>简短描述 (DESCRIPTION)</label>
                    <textarea 
                        rows={3}
                        value={formData.description}
                        onChange={e => setFormData({...formData, description: e.target.value})}
                        className={`w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all ${inputBg}`}
                        placeholder="一句话描述..."
                    />
                </div>
              </div>
          </GlassCard>

          {/* 3. Conversation Card (First Message / QR / Alt Greetings) */}
          <GlassCard theme={theme} className="p-6 mb-6 !bg-opacity-60">
             
             {/* First Message Header with Full Screen Button */}
             <div className="flex justify-between items-center mb-4">
                <label className={`flex items-center gap-2 ${labelColor}`}>
                    <MessageSquare size={14}/> 开场白 (FIRST MESSAGE)
                </label>
                <button 
                    onClick={() => { setShowFirstMesModal(true); setViewingAltIndex(-1); }}
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors ${theme === 'light' ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'}`}
                >
                    <Maximize size={12}/> 全屏查看 / 编辑
                </button>
             </div>

             {/* First Message Content */}
             <div className={`w-full rounded-2xl p-6 mb-8 text-sm leading-relaxed relative group ${theme === 'light' ? 'bg-slate-50' : 'bg-white/5'}`}>
                <textarea 
                    rows={8}
                    value={formData.firstMessage}
                    onChange={e => setFormData({...formData, firstMessage: e.target.value})}
                    className="w-full bg-transparent outline-none resize-none custom-scrollbar"
                    placeholder="角色的第一句话..."
                />
                <div className="absolute bottom-2 right-4 text-xs opacity-40 pointer-events-none">
                    {formData.firstMessage?.length || 0} chars
                </div>
             </div>

             <div className={`border-t mb-8 ${dividerClass}`}></div>

             {/* Alternate Greetings */}
             <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                    <label className={`flex items-center gap-2 ${labelColor}`}>
                        <Layers size={14}/> 备选开场白 ({formData.alternate_greetings?.length || 0})
                    </label>
                    <button 
                        onClick={handleAddAltGreeting}
                        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${theme === 'light' ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}
                    >
                        <Plus size={14}/> 添加
                    </button>
                </div>
                
                <div className="space-y-4">
                    {formData.alternate_greetings?.map((msg, idx) => (
                        <div key={idx} className={`relative group p-4 rounded-xl transition-all ${theme === 'light' ? 'bg-white border border-slate-100 shadow-sm' : 'bg-white/5 border border-white/5 hover:bg-white/10'}`}>
                            <div className="flex justify-between items-start gap-3">
                                <span className={`text-[10px] font-bold uppercase tracking-widest opacity-50 mt-1 ${theme === 'light' ? 'text-slate-400' : 'text-blue-300'}`}>
                                    Alternate #{idx + 1}
                                </span>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            if(confirm('Use this greeting as the main First Message?')) {
                                                setFormData(prev => ({ ...prev, firstMessage: msg }));
                                            }
                                        }}
                                        className="p-1.5 text-blue-400 hover:text-blue-500 transition-colors rounded-md hover:bg-blue-500/10"
                                        title="Use as First Message"
                                    >
                                        <RotateCcw size={14}/>
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => removeAltGreeting(idx)}
                                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-md hover:bg-red-500/10"
                                        title="Remove"
                                    >
                                        <Trash2 size={14}/>
                                    </button>
                                </div>
                            </div>
                            <textarea 
                                rows={3}
                                value={msg}
                                onChange={e => updateAltGreeting(idx, e.target.value)}
                                className="w-full bg-transparent outline-none resize-none custom-scrollbar text-sm mt-2 leading-relaxed"
                                placeholder="输入备选开场白内容..."
                            />
                        </div>
                    ))}
                    {(!formData.alternate_greetings || formData.alternate_greetings.length === 0) && (
                        <div className={`text-center py-8 border border-dashed rounded-xl text-xs ${theme === 'light' ? 'border-slate-300 text-slate-400' : 'border-white/10 text-gray-500'}`}>
                            暂无备选开场白
                        </div>
                    )}
                </div>
             </div>

             <div className={`border-t mb-8 ${dividerClass}`}></div>

             {/* QR Section */}
             <div>
                  <div className="flex justify-between items-center mb-3">
                       <label className={`flex items-center gap-2 ${labelColor}`}>
                           <QrCode size={14}/> 快速回复按钮 (QUICK REPLIES)
                       </label>
                       <input type="file" accept=".json" className="hidden" ref={qrFileInputRef} onChange={handleQrFileImport} />
                  </div>
                  
                  <div className={`rounded-2xl border-2 border-dashed transition-all duration-300 ${
                      formData.qrList && formData.qrList.length > 0 
                        ? (theme === 'light' ? 'border-slate-300 bg-slate-50/50' : 'border-white/20 bg-white/5')
                        : (theme === 'light' ? 'border-slate-200 bg-slate-50/30 hover:bg-slate-50/50' : 'border-white/10 bg-white/5 hover:bg-white/10')
                  }`}>
                      {formData.qrList && formData.qrList.length > 0 ? (
                          <div className="p-6">
                              <div className="flex justify-between items-center mb-4">
                                  <div className="flex items-center gap-2">
                                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                                      <span className={`font-bold text-sm ${theme === 'light' ? 'text-slate-700' : 'text-gray-200'}`}>
                                          已导入快速回复配置
                                      </span>
                                  </div>
                                  <button 
                                      onClick={handleClearQr}
                                      className="p-1.5 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                      title="清除配置"
                                  >
                                      <Trash2 size={16} />
                                  </button>
                              </div>

                              <div className={`w-full rounded-xl px-4 py-3 mb-4 text-sm font-mono flex items-center ${theme === 'light' ? 'bg-white border border-slate-200 text-slate-600' : 'bg-black/20 border border-white/5 text-gray-300'}`}>
                                  <span className="opacity-50 mr-2">文件名:</span>
                                  <span className="truncate flex-1">{formData.qrFileName || 'imported_config.json'}</span>
                              </div>

                              <button 
                                  onClick={handleQrExport}
                                  className={`w-full py-3 rounded-xl font-bold text-white transition-colors flex items-center justify-center gap-2 shadow-lg ${theme === 'light' ? 'bg-slate-800 hover:bg-slate-700 shadow-slate-800/20' : 'bg-white/10 hover:bg-white/20 shadow-white/5 border border-white/10'}`}
                              >
                                  <Download size={18} />
                                  下载 JSON
                              </button>
                          </div>
                      ) : (
                          <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
                              <div className={`p-4 rounded-full mb-2 ${theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-white/10 text-gray-400'}`}>
                                  <Upload size={32} strokeWidth={1.5} />
                              </div>
                              <div className={`text-sm font-medium ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                  未导入快速回复配置
                              </div>
                              <button 
                                  onClick={() => qrFileInputRef.current?.click()}
                                  className={`px-8 py-2.5 rounded-xl font-bold text-white transition-colors flex items-center gap-2 shadow-lg ${theme === 'light' ? 'bg-slate-800 hover:bg-slate-700 shadow-slate-800/20' : 'bg-white/10 hover:bg-white/20 shadow-white/5 border border-white/10'}`}
                              >
                                  <FileJson size={18} />
                                  导入 JSON
                              </button>
                          </div>
                      )}
                  </div>
             </div>

          </GlassCard>

          {/* 4. Lorebook (Compact) */}
          <GlassCard theme={theme} className="p-6 mb-6 !bg-opacity-60">
              <div className="flex justify-between items-center mb-4">
                  <label className={`flex items-center gap-2 ${labelColor}`}>
                      <Book size={14}/> 世界书 (WORLD INFO)
                  </label>
                  <button 
                      onClick={() => { setShowWorldInfoModal(true); setViewingWorldInfoIndex(formData.character_book?.entries?.length ? 0 : -1); }}
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors ${theme === 'light' ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'}`}
                  >
                      <Maximize size={12}/> 全屏查看 / 编辑
                  </button>
              </div>
              <div className={`w-full rounded-2xl p-6 text-sm flex items-center justify-between ${theme === 'light' ? 'bg-slate-50' : 'bg-white/5'}`}>
                  <span className={`font-medium ${theme === 'light' ? 'text-slate-600' : 'text-gray-300'}`}>
                      当前包含 {formData.character_book?.entries?.length || 0} 个世界书条目
                  </span>
                  <BookOpen size={20} className="opacity-20" />
              </div>
          </GlassCard>

       </div>

       {/* Sticky Bottom Export Button */}
       <div className="absolute bottom-6 left-0 right-0 px-6 z-20 flex justify-center pointer-events-none">
           <div className="pointer-events-auto flex w-full max-w-md shadow-2xl rounded-full overflow-hidden transform transition-transform hover:scale-[1.02]">
               <button 
                 onClick={() => handleExport('json')}
                 className={`flex-1 font-bold text-lg py-4 flex items-center justify-center gap-2 transition-colors border-r border-black/5
                    ${theme === 'light' 
                        ? 'bg-white/90 text-slate-600 hover:bg-white' 
                        : 'bg-white/10 text-white/80 hover:bg-white/20 backdrop-blur-md'}`}
               >
                   <FileJson size={20} /> 
                   导出 JSON
               </button>
               <button 
                 onClick={() => handleExport('png')}
                 className={`flex-1 font-bold text-lg py-4 flex items-center justify-center gap-2 transition-colors
                    ${theme === 'light' 
                        ? 'bg-white/90 text-slate-600 hover:bg-white' 
                        : 'bg-white/10 text-white/80 hover:bg-white/20 backdrop-blur-md'}`}
               >
                   <ImageIcon size={20} /> 
                   导出 PNG
               </button>
               
               {/* Package Export Button - Only if QR exists */}
               {formData.qrList && formData.qrList.length > 0 && (
                   <button 
                     onClick={() => handleExport('package')}
                     className={`w-16 font-bold text-lg py-4 flex items-center justify-center gap-2 transition-colors border-l border-black/5
                        ${theme === 'light' 
                            ? 'bg-blue-500/90 text-white hover:bg-blue-600' 
                            : 'bg-blue-600/80 text-white hover:bg-blue-500 backdrop-blur-md'}`}
                     title="打包导出 (QR + 卡片)"
                   >
                       <Layers size={20} /> 
                   </button>
               )}
           </div>
       </div>
       
       {error && <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full text-sm shadow-xl animate-bounce z-50 flex items-center gap-2">
           <span className="font-bold">Error:</span> {error}
           <button onClick={() => setError(null)} className="ml-2 hover:bg-white/20 rounded-full p-1"><X size={12}/></button>
       </div>}

       {/* First Message Modal */}
       {showFirstMesModal && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
               {/* Backdrop */}
               <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFirstMesModal(false)} />
               
               <div className={`w-full max-w-5xl h-[85vh] shadow-2xl rounded-3xl flex flex-col border animate-in zoom-in-95 duration-200 relative z-10 overflow-hidden
                    ${theme === 'light' ? 'bg-white/90 border-white/40' : 'bg-gray-900/90 border-white/10'} backdrop-blur-xl`}>
                   
                   {/* Header */}
                   <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0
                        ${theme === 'light' ? 'bg-white/50 border-slate-200/50' : 'bg-white/5 border-white/10'}`}>
                       <div className="flex items-center gap-4">
                           <span className={`font-black text-lg flex items-center gap-2 ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>
                               <Pen size={20} className="text-rose-500" />
                               {viewingAltIndex === -1 ? '主开场白 (Main)' : `备选开场白 #${viewingAltIndex + 1}`}
                           </span>
                       </div>
                       <div className="flex items-center gap-3">
                           <span className={`text-xs font-mono mr-2 ${theme === 'light' ? 'text-slate-400' : 'text-gray-400'}`}>
                               字数: {(isEditingFirstMes ? tempFirstMes : getCurrentMessage()).length}
                           </span>
                           
                           {isEditingFirstMes ? (
                               <>
                                    <button 
                                        onClick={() => {
                                            updateCurrentMessage(tempFirstMes);
                                            setIsEditingFirstMes(false);
                                        }}
                                        className="p-2 rounded-full bg-green-500/10 text-green-500 hover:bg-green-500/20 transition"
                                        title="保存"
                                    >
                                        <Check size={20} />
                                    </button>
                                    <button 
                                        onClick={() => setIsEditingFirstMes(false)}
                                        className="p-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition"
                                        title="取消"
                                    >
                                        <X size={20} />
                                    </button>
                               </>
                           ) : (
                               <>
                                   <button 
                                       onClick={() => {
                                           setTempFirstMes(getCurrentMessage());
                                           setIsEditingFirstMes(true);
                                       }}
                                       className={`p-2 rounded-full transition ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-gray-400'}`}
                                       title="编辑"
                                   >
                                       <Pen size={18} />
                                   </button>
                                   <div className={`h-4 w-px ${theme === 'light' ? 'bg-slate-300' : 'bg-white/20'}`}></div>
                                   <button 
                                       onClick={() => setShowFirstMesModal(false)} 
                                       className={`p-2 rounded-full transition ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-gray-400'}`}
                                       title="关闭"
                                   >
                                       <X size={20} />
                                   </button>
                               </>
                           )}
                       </div>
                   </div>
                   
                   <div className="flex-1 p-0 flex flex-col md:flex-row overflow-hidden relative">
                       {/* Left: Editor */}
                       <div className={`flex-1 border-r flex flex-col overflow-hidden relative
                            ${theme === 'light' ? 'bg-white/30 border-slate-200/50' : 'bg-black/20 border-white/10'}`}>
                           <textarea 
                               readOnly={!isEditingFirstMes}
                               value={isEditingFirstMes ? tempFirstMes : getCurrentMessage()}
                               onChange={(e) => isEditingFirstMes && setTempFirstMes(e.target.value)}
                               className={`flex-1 w-full resize-none p-8 text-sm leading-7 outline-none font-mono custom-scrollbar bg-transparent
                                    ${theme === 'light' ? 'text-slate-700 placeholder-slate-400 selection:bg-rose-100' : 'text-gray-200 placeholder-gray-600 selection:bg-rose-500/30'}
                                    ${!isEditingFirstMes ? 'cursor-default' : ''}`}
                               placeholder="暂无内容..."
                           />
                       </div>

                       {/* Right: Navigation */}
                       <div className={`w-72 md:w-80 flex flex-col border-t md:border-t-0 shrink-0
                            ${theme === 'light' ? 'bg-slate-50/50' : 'bg-black/40'}`}>
                            <div className={`px-4 py-3 border-b text-[10px] font-bold uppercase tracking-widest flex justify-between items-center
                                ${theme === 'light' ? 'border-slate-200/50 text-slate-400' : 'border-white/10 text-gray-500'}`}>
                                <span>快速切换</span>
                                <button 
                                    onClick={handleAddAltGreeting} 
                                    className={`p-1.5 rounded-lg transition-colors ${theme === 'light' ? 'text-rose-500 hover:bg-rose-100' : 'text-rose-400 hover:bg-rose-500/20'}`}
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                <div 
                                     onClick={() => setViewingAltIndex(-1)}
                                     className={`group rounded-xl p-3 shadow-sm border relative cursor-pointer transition-all active:scale-[0.98] 
                                        ${viewingAltIndex === -1 
                                            ? (theme === 'light' ? 'bg-rose-50 border-rose-200 ring-2 ring-rose-100' : 'bg-rose-500/20 border-rose-500/50 ring-1 ring-rose-500/50') 
                                            : (theme === 'light' ? 'bg-white/60 border-slate-200 hover:border-blue-300 hover:shadow-md' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20')}`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`text-[10px] font-black uppercase tracking-widest ${theme === 'light' ? 'text-slate-400' : 'text-gray-400'}`}>Main Message</div>
                                        {viewingAltIndex === -1 && <Eye size={14} className="text-rose-500" />}
                                    </div>
                                    <div className={`text-xs leading-relaxed font-mono line-clamp-3 pointer-events-none ${theme === 'light' ? 'text-slate-600' : 'text-gray-300'}`}>
                                        {formData.firstMessage || '(空)'}
                                    </div>
                                </div>
                                
                                {formData.alternate_greetings?.map((alt, idx) => (
                                    <div key={idx}
                                         onClick={() => setViewingAltIndex(idx)}
                                         className={`group rounded-xl p-3 shadow-sm border relative cursor-pointer transition-all active:scale-[0.98] 
                                            ${viewingAltIndex === idx 
                                                ? (theme === 'light' ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' : 'bg-blue-500/20 border-blue-500/50 ring-1 ring-blue-500/50') 
                                                : (theme === 'light' ? 'bg-white/60 border-slate-200 hover:border-blue-300 hover:shadow-md' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20')}`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className={`text-[10px] font-bold ${theme === 'light' ? 'text-slate-400' : 'text-gray-400'}`}>Alternate #{idx + 1}</div>
                                            {viewingAltIndex === idx && <Eye size={14} className="text-blue-500" />}
                                        </div>
                                        <div className={`text-xs leading-relaxed font-mono line-clamp-3 pointer-events-none ${theme === 'light' ? 'text-slate-600' : 'text-gray-300'}`}>
                                            {alt || '(空)'}
                                        </div>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeAltGreeting(idx);
                                                if(viewingAltIndex === idx) setViewingAltIndex(-1);
                                            }} 
                                            className={`absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 rounded-lg transition-all ${theme === 'light' ? 'hover:bg-red-100 hover:text-red-500' : 'hover:bg-red-500/20 hover:text-red-400'}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                       </div>
                   </div>
               </div>
           </div>
       )}
       {/* World Info Modal */}
       {showWorldInfoModal && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
               <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWorldInfoModal(false)} />
               
               <div className={`w-full max-w-6xl h-[85vh] shadow-2xl rounded-3xl flex flex-col border animate-in zoom-in-95 duration-200 relative z-10 overflow-hidden
                    ${theme === 'light' ? 'bg-white/90 border-white/40' : 'bg-gray-900/90 border-white/10'} backdrop-blur-xl`}>
                   
                   {/* Header */}
                   <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0
                        ${theme === 'light' ? 'bg-white/50 border-slate-200/50' : 'bg-white/5 border-white/10'}`}>
                       <div className="flex items-center gap-4">
                           <span className={`font-black text-lg flex items-center gap-2 ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>
                               <BookOpen size={20} className="text-indigo-500" />
                               世界书 (World Info)
                           </span>
                       </div>
                       <div className="flex items-center gap-3">
                           {isEditingWorldInfo && viewingWorldInfoIndex !== -1 ? (
                               <>
                                    <button 
                                        onClick={() => {
                                            updateWorldInfo(viewingWorldInfoIndex, tempWorldInfo);
                                            setIsEditingWorldInfo(false);
                                        }}
                                        className="p-2 rounded-full bg-green-500/10 text-green-500 hover:bg-green-500/20 transition"
                                        title="保存"
                                    >
                                        <Check size={20} />
                                    </button>
                                    <button 
                                        onClick={() => setIsEditingWorldInfo(false)}
                                        className="p-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition"
                                        title="取消"
                                    >
                                        <X size={20} />
                                    </button>
                               </>
                           ) : (
                               <>
                                   {viewingWorldInfoIndex !== -1 && (
                                       <button 
                                           onClick={() => {
                                               setTempWorldInfo(formData.character_book?.entries?.[viewingWorldInfoIndex]);
                                               setIsEditingWorldInfo(true);
                                           }}
                                           className={`p-2 rounded-full transition ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-gray-400'}`}
                                           title="编辑"
                                       >
                                           <Pen size={18} />
                                       </button>
                                   )}
                                   <div className={`h-4 w-px ${theme === 'light' ? 'bg-slate-300' : 'bg-white/20'}`}></div>
                                   <button 
                                       onClick={() => setShowWorldInfoModal(false)} 
                                       className={`p-2 rounded-full transition ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-gray-400'}`}
                                       title="关闭"
                                   >
                                       <X size={20} />
                                   </button>
                               </>
                           )}
                       </div>
                   </div>
                   
                   <div className="flex-1 p-0 flex flex-col md:flex-row overflow-hidden relative">
                       {/* Left: Navigation (List of entries) */}
                       <div className={`w-72 md:w-80 flex flex-col border-r shrink-0
                            ${theme === 'light' ? 'bg-slate-50/50 border-slate-200/50' : 'bg-black/40 border-white/10'}`}>
                            <div className={`px-4 py-3 border-b text-[10px] font-bold uppercase tracking-widest flex justify-between items-center
                                ${theme === 'light' ? 'border-slate-200/50 text-slate-400' : 'border-white/10 text-gray-500'}`}>
                                <span>条目列表 ({formData.character_book?.entries?.length || 0})</span>
                                <button 
                                    onClick={handleAddWorldInfo} 
                                    className={`p-1.5 rounded-lg transition-colors ${theme === 'light' ? 'text-indigo-500 hover:bg-indigo-100' : 'text-indigo-400 hover:bg-indigo-500/20'}`}
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                {formData.character_book?.entries?.map((entry, idx) => (
                                    <div key={idx}
                                         onClick={() => {
                                             if (isEditingWorldInfo && viewingWorldInfoIndex !== idx) {
                                                 if (!confirm('有未保存的修改，确定要切换吗？')) return;
                                             }
                                             setViewingWorldInfoIndex(idx);
                                         }}
                                         className={`group rounded-xl p-3 shadow-sm border relative cursor-pointer transition-all active:scale-[0.98] 
                                            ${viewingWorldInfoIndex === idx 
                                                ? (theme === 'light' ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-100' : 'bg-indigo-500/20 border-indigo-500/50 ring-1 ring-indigo-500/50') 
                                                : (theme === 'light' ? 'bg-white/60 border-slate-200 hover:border-indigo-300 hover:shadow-md' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20')}`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className={`text-xs font-bold truncate pr-6 ${theme === 'light' ? 'text-slate-700' : 'text-gray-200'}`}>
                                                {entry.name || `Entry #${idx + 1}`}
                                            </div>
                                            {viewingWorldInfoIndex === idx && <Eye size={14} className="text-indigo-500 absolute right-3 top-3" />}
                                        </div>
                                        <div className={`text-[10px] font-mono truncate opacity-60 ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                            Keys: {entry.keys?.join(', ') || '(无)'}
                                        </div>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeWorldInfo(idx);
                                            }} 
                                            className={`absolute bottom-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 rounded-lg transition-all ${theme === 'light' ? 'hover:bg-red-100 hover:text-red-500' : 'hover:bg-red-500/20 hover:text-red-400'}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                {(!formData.character_book?.entries || formData.character_book.entries.length === 0) && (
                                    <div className={`text-center py-8 text-xs opacity-50 ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                        暂无条目
                                    </div>
                                )}
                            </div>
                       </div>

                       {/* Right: Editor */}
                       <div className={`flex-1 flex flex-col overflow-hidden relative
                            ${theme === 'light' ? 'bg-white/30' : 'bg-black/20'}`}>
                            {viewingWorldInfoIndex !== -1 && formData.character_book?.entries?.[viewingWorldInfoIndex] ? (
                                (() => {
                                    const currentEntry = isEditingWorldInfo ? tempWorldInfo : formData.character_book.entries[viewingWorldInfoIndex];
                                    return (
                                        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                                            {/* Name & Keys */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <label className={`block mb-2 text-xs font-bold uppercase tracking-wider ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                                        条目名称 (Name)
                                                    </label>
                                                    <input 
                                                        readOnly={!isEditingWorldInfo}
                                                        value={currentEntry.name || ''}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, name: e.target.value})}
                                                        className={`w-full rounded-xl px-4 py-3 text-sm outline-none transition-all
                                                            ${theme === 'light' ? 'bg-white/50 border border-slate-200 text-slate-800 focus:bg-white' : 'bg-black/20 border border-white/10 text-white focus:bg-black/40'}
                                                            ${!isEditingWorldInfo ? 'opacity-80 cursor-default' : ''}`}
                                                        placeholder="例如: 魔法设定"
                                                    />
                                                </div>
                                                <div>
                                                    <label className={`block mb-2 text-xs font-bold uppercase tracking-wider ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                                        触发词 (Keys, 逗号分隔)
                                                    </label>
                                                    <input 
                                                        readOnly={!isEditingWorldInfo}
                                                        value={currentEntry.keys?.join(', ') || ''}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, keys: e.target.value.split(',').map(k => k.trim()).filter(Boolean)})}
                                                        className={`w-full rounded-xl px-4 py-3 text-sm outline-none transition-all font-mono
                                                            ${theme === 'light' ? 'bg-white/50 border border-slate-200 text-slate-800 focus:bg-white' : 'bg-black/20 border border-white/10 text-white focus:bg-black/40'}
                                                            ${!isEditingWorldInfo ? 'opacity-80 cursor-default' : ''}`}
                                                        placeholder="例如: 魔法, 魔力, 咒语"
                                                    />
                                                </div>
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 flex flex-col min-h-[300px]">
                                                <label className={`block mb-2 text-xs font-bold uppercase tracking-wider flex justify-between ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                                    <span>内容 (Content)</span>
                                                    <span>{currentEntry.content?.length || 0} chars</span>
                                                </label>
                                                <textarea 
                                                    readOnly={!isEditingWorldInfo}
                                                    value={currentEntry.content || ''}
                                                    onChange={(e) => setTempWorldInfo({...tempWorldInfo, content: e.target.value})}
                                                    className={`w-full flex-1 rounded-xl p-4 text-sm leading-7 outline-none font-mono resize-none custom-scrollbar transition-all
                                                        ${theme === 'light' ? 'bg-white/50 border border-slate-200 text-slate-700 focus:bg-white' : 'bg-black/20 border border-white/10 text-gray-200 focus:bg-black/40'}
                                                        ${!isEditingWorldInfo ? 'opacity-80 cursor-default' : ''}`}
                                                    placeholder="输入世界书内容..."
                                                />
                                            </div>

                                            {/* Advanced Settings */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        type="checkbox" 
                                                        id="wi-enabled"
                                                        disabled={!isEditingWorldInfo}
                                                        checked={currentEntry.enabled !== false}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, enabled: e.target.checked})}
                                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                    />
                                                    <label htmlFor="wi-enabled" className={`text-sm ${theme === 'light' ? 'text-slate-600' : 'text-gray-300'}`}>启用 (Enabled)</label>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        type="checkbox" 
                                                        id="wi-casesensitive"
                                                        disabled={!isEditingWorldInfo}
                                                        checked={currentEntry.case_sensitive || false}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, case_sensitive: e.target.checked})}
                                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                    />
                                                    <label htmlFor="wi-casesensitive" className={`text-sm ${theme === 'light' ? 'text-slate-600' : 'text-gray-300'}`}>区分大小写</label>
                                                </div>
                                                <div>
                                                    <label className={`block mb-1 text-xs font-bold uppercase ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>插入顺序 (Order)</label>
                                                    <input 
                                                        type="number"
                                                        readOnly={!isEditingWorldInfo}
                                                        value={currentEntry.insertion_order ?? 50}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, insertion_order: parseInt(e.target.value) || 0})}
                                                        className={`w-full rounded-lg px-3 py-2 text-sm outline-none transition-all
                                                            ${theme === 'light' ? 'bg-white/50 border border-slate-200 text-slate-800' : 'bg-black/20 border border-white/10 text-white'}
                                                            ${!isEditingWorldInfo ? 'opacity-80 cursor-default' : ''}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={`block mb-1 text-xs font-bold uppercase ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>优先级 (Priority)</label>
                                                    <input 
                                                        type="number"
                                                        readOnly={!isEditingWorldInfo}
                                                        value={currentEntry.priority ?? 10}
                                                        onChange={(e) => setTempWorldInfo({...tempWorldInfo, priority: parseInt(e.target.value) || 0})}
                                                        className={`w-full rounded-lg px-3 py-2 text-sm outline-none transition-all
                                                            ${theme === 'light' ? 'bg-white/50 border border-slate-200 text-slate-800' : 'bg-black/20 border border-white/10 text-white'}
                                                            ${!isEditingWorldInfo ? 'opacity-80 cursor-default' : ''}`}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()
                            ) : (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className={`text-center opacity-50 ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>
                                        <BookOpen size={48} className="mx-auto mb-4 opacity-20" />
                                        <p>请在左侧选择一个条目</p>
                                    </div>
                                </div>
                            )}
                       </div>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};

export default CharacterForm;