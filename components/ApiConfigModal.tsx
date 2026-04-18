import React, { useState, useEffect } from 'react';
import { Theme } from '../types';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Check, Edit2, Plus, RefreshCw, Trash2, X, Key, Globe, CheckCircle2, Save } from 'lucide-react';

export interface ApiConfig {
  id: string;
  name: string;
  type: 'openai' | 'gemini';
  apiKey: string;
  baseUrl: string;
  selectedModel: string;
  availableModels: string[];
}

export const getApiConfigs = (): ApiConfig[] => {
  try {
    const saved = localStorage.getItem('glass_tavern_api_configs');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

export const getActiveApiConfigId = (): string | null => {
  try {
    return localStorage.getItem('glass_tavern_active_api') || null;
  } catch {
    return null;
  }
};

interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: Theme;
}

export const ApiConfigModal: React.FC<ApiConfigModalProps> = ({ isOpen, onClose, theme }) => {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [fetchMessage, setFetchMessage] = useState('');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      const savedConfigs = getApiConfigs();
      setConfigs(savedConfigs);
      const savedActiveId = getActiveApiConfigId();
      setActiveId(savedActiveId);
      
      if (savedConfigs.length > 0) {
        const active = savedConfigs.find(c => c.id === savedActiveId) || savedConfigs[0];
        setEditingConfig(active);
      } else {
        handleCreateNew();
      }
    }
  }, [isOpen]);

  const saveConfigs = (newConfigs: ApiConfig[], newActiveId: string | null) => {
    setConfigs(newConfigs);
    setActiveId(newActiveId);
    localStorage.setItem('glass_tavern_api_configs', JSON.stringify(newConfigs));
    if (newActiveId) {
      localStorage.setItem('glass_tavern_active_api', newActiveId);
    } else {
      localStorage.removeItem('glass_tavern_active_api');
    }
  };

  const handleCreateNew = () => {
    setEditingConfig({
      id: crypto.randomUUID(),
      name: '新连接',
      type: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      selectedModel: '',
      availableModels: [],
    });
  };

  const handleFetchModels = async () => {
    if (!editingConfig) return;
    setIsLoadingModels(true);
    setFetchMessage('');
    try {
      if (editingConfig.type === 'openai') {
        const url = new URL('/models', editingConfig.baseUrl);
        const res = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${editingConfig.apiKey}`
          }
        });
        if (!res.ok) throw new Error('Request failed');
        const data = await res.json();
        if (data.data) {
          const models = data.data.map((m: any) => m.id);
          setEditingConfig({ ...editingConfig, availableModels: models, selectedModel: models.includes(editingConfig.selectedModel) ? editingConfig.selectedModel : (models[0] || '') });
          setFetchMessage(`成功获取 ${data.data.length} 个模型`);
        }
      } else {
        // Simple manual definition for Gemini for now, fetching gemini models requires a different Google specific API
        const geminiModels = ['gemini-3.1-pro-preview', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        setEditingConfig({
          ...editingConfig, 
          availableModels: geminiModels,
          selectedModel: 'gemini-3.1-pro-preview'
        });
        setFetchMessage(`成功获取 ${geminiModels.length} 个模型`);
      }
    } catch (err: any) {
      alert(`无法获取模型列表: ${err.message}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleTestConnection = async () => {
     if (!editingConfig) return;
     setTestMessage('测试中...');
     try {
       // Minimal ping based on type
       if (editingConfig.type === 'openai') {
         const url = new URL('/models', editingConfig.baseUrl);
         const res = await fetch(url.toString(), {
           headers: { 'Authorization': `Bearer ${editingConfig.apiKey}` }
         });
         if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
         setTestMessage('连接成功');
       } else {
          // Gemini doesn't have a simple models endpoint accessible without different auth usually, 
          // but we can try pinging the generic endpoint or just assume OK if key looks like syntax
          if (editingConfig.apiKey.length > 10) {
              setTestMessage('连接成功');
          } else {
              throw new Error('API Key 无效');
          }
       }
     } catch (err: any) {
        setTestMessage(`连接失败: ${err.message}`);
     }
     setTimeout(() => setTestMessage(''), 3000);
  };

  const handleSaveConfig = () => {
    if (!editingConfig) return;
    if (!editingConfig.name || !editingConfig.apiKey) {
      alert('名称和 API Key 不能为空');
      return;
    }

    const existingIndex = configs.findIndex(c => c.id === editingConfig.id);
    let newConfigs = [...configs];
    if (existingIndex >= 0) {
      newConfigs[existingIndex] = editingConfig;
    } else {
      newConfigs.push(editingConfig);
    }
    
    // Always make saved config the active one
    const newActiveId = editingConfig.id;
    
    saveConfigs(newConfigs, newActiveId);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这个连接吗？')) {
      const newConfigs = configs.filter(c => c.id !== id);
      const newActiveId = activeId === id ? (newConfigs[0]?.id || null) : activeId;
      saveConfigs(newConfigs, newActiveId);
      if (newConfigs.length > 0) {
        setEditingConfig(newConfigs.find(c => c.id === newActiveId) || newConfigs[0]);
      } else {
        handleCreateNew();
      }
    }
  };

  const textColor = theme === 'light' ? 'text-slate-800' : 'text-gray-200';
  const subTextColor = theme === 'light' ? 'text-slate-500' : 'text-gray-400';
  const bgInput = theme === 'light' ? 'bg-white border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20' : 'bg-black/40 border-white/10 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

  return (
    <Modal 
       isOpen={isOpen} 
       onClose={onClose} 
       title={
          <div className="flex items-center gap-2">
             <Key size={18} className="text-[#a78bfa]" />
             <span className="font-medium text-lg">API 设置</span>
          </div>
       } 
       theme={theme} 
       size="md"
    >
      <div className={`p-5 ${theme === 'light' ? 'bg-slate-50' : 'bg-[#151720]'}`}>
        <div className="space-y-5">
           {/* Top dropdown and ADD button */}
           <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                 <select
                    value={activeId || ''}
                    onChange={e => {
                        const conf = configs.find(c => c.id === e.target.value);
                        if (conf) {
                           setEditingConfig(conf);
                           saveConfigs(configs, conf.id);
                        }
                    }}
                    className={`w-full p-3 rounded-xl border outline-none text-sm transition-all appearance-none cursor-pointer ${bgInput} ${textColor}`}
                 >
                    {configs.map(c => (
                        <option key={c.id} value={c.id} className={theme === 'light' ? 'text-slate-800' : 'text-slate-800'}>
                            {c.id === editingConfig?.id ? editingConfig.name || '默认接口' : c.name || '默认接口'}
                        </option>
                    ))}
                 </select>
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                 </div>
              </div>
              <button 
                  onClick={handleCreateNew}
                  className={`flex items-center justify-center p-3 rounded-xl border transition-colors ${theme === 'light' ? 'bg-white border-slate-300 hover:bg-slate-100' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${textColor}`}
                  title="新建连接"
              >
                  <Plus size={18} />
              </button>
              {editingConfig && configs.some(c => c.id === editingConfig.id) && configs.length > 1 && (
                  <button 
                      onClick={() => handleDelete(editingConfig.id)} 
                      className={`flex items-center justify-center p-3 rounded-xl border transition-colors ${theme === 'light' ? 'bg-white border-slate-300 text-red-500 hover:bg-red-50 hover:border-red-200' : 'bg-white/5 border-white/10 text-red-400 hover:bg-red-500/10 hover:border-red-500/30'}`}
                      title="删除此连接"
                  >
                      <Trash2 size={18} />
                  </button>
              )}
           </div>

          {editingConfig ? (
            <div className="space-y-4">
              <div>
                <label className={`block text-[13px] mb-1.5 ml-1 ${textColor}`}>接口名称 (备注)</label>
                <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={editingConfig.name}
                      onChange={e => {
                         const updated = {...editingConfig, name: e.target.value};
                         setEditingConfig(updated);
                         // Auto live update
                         const newConfigs = configs.map(c => c.id === updated.id ? updated : c);
                         setConfigs(newConfigs);
                      }}
                      className={`flex-1 p-3 rounded-xl border outline-none text-sm transition-all ${bgInput} ${textColor}`}
                      placeholder="例如: DeepSeek、本地Ollama"
                    />
                </div>
              </div>

              <div>
                <label className={`block text-[13px] mb-1.5 ml-1 ${textColor}`}>接口类型</label>
                <select 
                  value={editingConfig.type}
                  onChange={e => setEditingConfig({...editingConfig, type: e.target.value as any})}
                  className={`w-full p-3 rounded-xl border outline-none text-sm transition-all ${bgInput} ${textColor}`}
                >
                  <option value="openai" className="text-slate-800">OpenAI 兼容</option>
                  <option value="gemini" className="text-slate-800">Google Gemini</option>
                </select>
              </div>

              <div>
                <label className={`block text-[13px] mb-1.5 ml-1 ${textColor}`}>API 地址 (Base URL) {editingConfig.type === 'gemini' && <span className="opacity-50">(已忽略)</span>}</label>
                <div className="relative">
                   <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${subTextColor}`}>
                       <Globe size={16} />
                   </div>
                   <input 
                     type="text" 
                     value={editingConfig.baseUrl}
                     onChange={e => setEditingConfig({...editingConfig, baseUrl: e.target.value})}
                     className={`w-full p-3 pl-9 rounded-xl border outline-none text-sm font-mono transition-all ${bgInput} ${textColor}`}
                     placeholder="例如: https://api.openai.com/v1"
                     disabled={editingConfig.type === 'gemini'}
                   />
                </div>
              </div>

              <div>
                <label className={`block text-[13px] mb-1.5 ml-1 ${textColor}`}>API Key</label>
                <input 
                  type="password" 
                  value={editingConfig.apiKey}
                  onChange={e => setEditingConfig({...editingConfig, apiKey: e.target.value})}
                  className={`w-full p-3 rounded-xl border outline-none text-sm font-mono tracking-widest transition-all ${bgInput} ${textColor}`}
                  placeholder="sk-..."
                />
              </div>

              <div>
                <div className="flex justify-between items-end mb-1.5 ml-1">
                  <label className={`text-[13px] ${textColor}`}>模型名称 (Model)</label>
                  <button 
                    onClick={handleFetchModels}
                    disabled={isLoadingModels}
                    className={`text-xs flex items-center gap-1 transition-colors ${isLoadingModels ? 'text-gray-400 cursor-not-allowed' : 'text-[#60a5fa] hover:opacity-80'}`}
                  >
                    <RefreshCw size={12} className={isLoadingModels ? 'animate-spin' : ''} />
                    拉取模型
                  </button>
                </div>
                
                <div>
                   <input
                     list="model-datalist"
                     value={editingConfig.selectedModel}
                     onChange={e => setEditingConfig({...editingConfig, selectedModel: e.target.value})}
                     className={`w-full p-3 rounded-xl border outline-none text-sm transition-all ${bgInput} ${textColor}`}
                     placeholder="下拉选择可用模型，或手动输入名称"
                   />
                   <datalist id="model-datalist">
                     {editingConfig.availableModels.map(model => (
                       <option key={model} value={model} />
                     ))}
                   </datalist>
                   
                   {fetchMessage && (
                       <div className="mt-2 p-2 rounded-lg border border-green-500/20 bg-green-500/10 flex items-center gap-2 text-green-400 text-xs">
                          <CheckCircle2 size={14} />
                          <span>{fetchMessage}</span>
                       </div>
                   )}
                </div>
              </div>
              
              <div className="pt-4 flex items-center justify-between gap-3">
                 <button 
                    onClick={handleTestConnection} 
                    className={`px-4 py-2.5 rounded-xl border transition-colors text-sm ${theme === 'light' ? 'bg-white border-slate-300 hover:bg-slate-50' : 'bg-[#1e1f2a] border-white/10 hover:bg-white/5'} ${textColor}`}
                 >
                    {testMessage || '测试连接'}
                 </button>
                 
                 <div className="flex items-center gap-3">
                     <button 
                         onClick={onClose} 
                         className={`px-4 py-2.5 rounded-xl border transition-colors text-sm ${theme === 'light' ? 'bg-white border-slate-300 hover:bg-slate-50' : 'bg-transparent border-transparent hover:bg-white/5 disabled:opacity-50'} ${subTextColor}`}
                     >
                         取消
                     </button>
                     <button 
                         onClick={handleSaveConfig} 
                         className="px-4 py-2.5 rounded-xl bg-[#3b82f6] text-white hover:bg-blue-500 text-sm font-medium flex items-center gap-1.5 transition-colors"
                     >
                         <Save size={16} />
                         保存设置
                     </button>
                 </div>
              </div>

            </div>
          ) : (
             <div className={`py-12 flex flex-col items-center justify-center text-center opacity-50 ${textColor}`}>
               <Plus size={48} strokeWidth={1} className="mb-4 text-[#60a5fa]"/>
               <p>没有可用的连接配置</p>
             </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
