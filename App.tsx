import React, { useState, useEffect } from 'react';
import { Character, ViewMode, Theme } from './types';
import CharacterList from './components/CharacterList';
import CharacterForm from './components/CharacterForm';
import { DEFAULT_CHARACTERS } from './constants';
import { Moon, Sun, Key, X, Eye, EyeOff } from 'lucide-react';
import { loadImage, deleteImage, saveImage } from './services/imageService';
import { hasApiKey, saveApiKey, clearApiKey } from './services/geminiService';

function App() {
  // Load characters from localStorage or use defaults
  const [characters, setCharacters] = useState<Character[]>(() => {
    try {
      const saved = localStorage.getItem('glass_tavern_characters_v1');
      const parsed = saved ? JSON.parse(saved) : DEFAULT_CHARACTERS;
      return Array.isArray(parsed) ? parsed : DEFAULT_CHARACTERS;
    } catch (e) {
      console.error("Failed to parse characters from localStorage", e);
      return DEFAULT_CHARACTERS;
    }
  });

  const [view, setView] = useState<ViewMode>('list');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  
  // Theme state: default is 'dark'
  const [theme, setTheme] = useState<Theme>('dark');

  // API Key modal state
  const [showKeyModal, setShowKeyModal] = useState<boolean>(!hasApiKey());
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleSaveKey = () => {
    if (keyInput.trim()) {
      saveApiKey(keyInput.trim());
      setKeyInput('');
      setShowKeyModal(false);
    }
  };

  const handleClearKey = () => {
    clearApiKey();
    setKeyInput('');
    setShowKeyModal(true);
  };

  // Folders state
  const [folders, setFolders] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('glass_tavern_folders_v1');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse folders from localStorage", e);
      return [];
    }
  });

  // Persist characters
  useEffect(() => {
    try {
      localStorage.setItem('glass_tavern_characters_v1', JSON.stringify(characters));
    } catch (e) {
      console.error("Failed to save characters to localStorage (Quota Exceeded?)", e);
      // Optional: Show a toast to the user?
    }
  }, [characters]);

  // Persist folders
  useEffect(() => {
    try {
      localStorage.setItem('glass_tavern_folders_v1', JSON.stringify(folders));
    } catch (e) {
      console.error("Failed to save folders to localStorage", e);
    }
  }, [folders]);

  // Load images from IndexedDB on mount to fix blob URL expiration
  useEffect(() => {
    const loadImages = async () => {
      if (!Array.isArray(characters)) return;
      
      const updatedCharacters = await Promise.all(characters.map(async (char) => {
        // If it's an external URL (http/https), we don't need to load from IDB
        // unless we want to cache it, but for now let's assume external URLs are fine.
        // However, imported chars use blob URLs which expire.
        
        // Try to load from IDB first
        try {
          const blob = await loadImage(char.id);
          if (blob) {
            return { ...char, avatarUrl: URL.createObjectURL(blob) };
          }
        } catch (e) {
          console.error(`Failed to load image for char ${char.id}`, e);
        }
        
        // If not in IDB, and it's a blob URL, it's definitely broken (expired).
        // We should probably show a placeholder or keep it (it will show broken image).
        // Let's keep it for now, but maybe we could set a flag.
        return char;
      }));
      
      setCharacters(prev => {
        const urlMap = new Map(updatedCharacters.map(c => [c.id, c.avatarUrl]));
        return prev.map(c => {
           if (urlMap.has(c.id)) {
               return { ...c, avatarUrl: urlMap.get(c.id)! };
           }
           return c;
        });
      });
    };
    
    if (characters.length > 0) {
      loadImages().catch(err => console.error("Failed to load images from IDB:", err));
    }
  }, []);

  // Handlers
  const handleSaveCharacter = async (char: Character) => {
    // Save avatar to IndexedDB if it's a blob URL
    if (char.avatarUrl.startsWith('blob:')) {
        try {
            const response = await fetch(char.avatarUrl);
            const blob = await response.blob();
            await saveImage(char.id, blob);
        } catch (e) {
            console.error("Failed to save image to IDB", e);
        }
    }

    setCharacters(prev => {
      const exists = prev.find(c => c.id === char.id);
      if (exists) {
        return prev.map(c => c.id === char.id ? char : c);
      }
      return [...prev, char];
    });
    setView('list');
  };

  const handleUpdateCharacter = (char: Character) => {
    setCharacters(prev => prev.map(c => c.id === char.id ? char : c));
  };

  const handleDeleteCharacter = (id: string, skipConfirm = false) => {
    if (skipConfirm || window.confirm("确定要删除这个角色吗？")) {
      deleteImage(id).catch(err => console.error("Failed to delete image", err));
      setCharacters(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleDeleteBatch = (ids: string[], skipConfirm = false) => {
    if (skipConfirm || window.confirm(`确定要删除选中的 ${ids.length} 个角色吗？`)) {
      ids.forEach(id => deleteImage(id).catch(err => console.error("Failed to delete image", err)));
      setCharacters(prev => prev.filter(c => !ids.includes(c.id)));
    }
  };

  const handleImportCharacter = (char: Character) => {
    // Determine if we should replace an existing one or add new
    // For now, we always add new, but the List component warns about duplicates.
    setCharacters(prev => [...prev, char]);
    // setSelectedCharacterId(char.id); // Optional: select it? User said "just add it in".
    // setView('edit'); // REMOVED: Do not show details immediately
  };

  const handleImportBatch = (chars: Character[]) => {
    setCharacters(prev => [...prev, ...chars]);
  };

  const handleCreateFolder = (name: string) => {
    if (!folders.includes(name)) {
      setFolders(prev => [...prev, name]);
    }
  };

  const handleDeleteFolder = (name: string) => {
    if (window.confirm(`确定要删除文件夹 "${name}" 吗？文件夹内的角色不会被删除。`)) {
      setFolders(prev => prev.filter(f => f !== name));
      // Remove folder assignment from characters
      setCharacters(prev => prev.map(c => c.folder === name ? { ...c, folder: undefined } : c));
    }
  };

  const handleRenameFolder = (oldName: string, newName: string) => {
    if (folders.includes(newName)) return;
    setFolders(prev => prev.map(f => f === oldName ? newName : f));
    setCharacters(prev => prev.map(c => c.folder === oldName ? { ...c, folder: newName } : c));
  };

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId);

  // Background Styles
  const darkBg = `
    radial-gradient(circle at 15% 50%, rgba(76, 29, 149, 0.4), transparent 25%), 
    radial-gradient(circle at 85% 30%, rgba(219, 39, 119, 0.3), transparent 25%), 
    linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)
  `;

  // White theme background
  const lightBg = `
    radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.15), transparent 40%),
    radial-gradient(circle at 80% 80%, rgba(236, 72, 153, 0.1), transparent 40%),
    linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)
  `;

  const backgroundStyle = {
    backgroundImage: theme === 'light' ? lightBg : darkBg,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed'
  };

  return (
    <div className={`min-h-screen relative overflow-hidden transition-all duration-700 font-sans`} style={backgroundStyle}>
      {/* Decorative Orbs */}
      <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] pointer-events-none transition-all duration-700 
          ${theme === 'light' ? 'bg-blue-300/30' : 'bg-blue-500/20'}`} />
      <div className={`absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] pointer-events-none transition-all duration-700 
          ${theme === 'light' ? 'bg-purple-300/30' : 'bg-purple-500/20'}`} />

      {/* Main Container */}
      <main className="relative z-10 w-full h-screen flex flex-col p-4 md:p-6 lg:p-8">
        
        {/* Top Controls */}
        <div className="absolute top-6 right-6 z-50 flex items-center gap-2">
          <button
            onClick={() => setShowKeyModal(true)}
            className={`p-3 rounded-full backdrop-blur-md border transition-all duration-300 shadow-lg
              ${hasApiKey()
                ? (theme === 'light' ? 'bg-green-100/80 text-green-700 border-green-300 hover:bg-green-100' : 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30')
                : (theme === 'light' ? 'bg-red-100/80 text-red-600 border-red-300 hover:bg-red-100' : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30')}
            `}
            title="管理 Gemini API Key"
          >
            <Key size={20} />
          </button>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-3 rounded-full backdrop-blur-md border transition-all duration-300 shadow-lg
              ${theme === 'light' 
                ? 'bg-white/80 text-slate-800 border-slate-300 hover:bg-white' 
                : 'bg-black/20 text-yellow-300 border-white/10 hover:bg-black/40'}
            `}
            title={theme === 'dark' ? "切换到亮色主题" : "切换到暗色主题"}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        {/* API Key Modal */}
        {showKeyModal && (
          <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className={`w-full max-w-md rounded-3xl shadow-2xl p-8 border animate-fade-in
              ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-900 border-white/10'}`}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${theme === 'light' ? 'bg-blue-100' : 'bg-blue-500/20'}`}>
                    <Key size={20} className="text-blue-500" />
                  </div>
                  <div>
                    <h2 className={`text-lg font-black ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>Gemini API Key</h2>
                    <p className={`text-xs ${theme === 'light' ? 'text-slate-400' : 'text-gray-500'}`}>仅保存在本地浏览器，不会上传</p>
                  </div>
                </div>
                {hasApiKey() && (
                  <button onClick={() => setShowKeyModal(false)} className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-slate-100 text-slate-400' : 'hover:bg-white/10 text-gray-500'}`}>
                    <X size={18} />
                  </button>
                )}
              </div>

              {hasApiKey() && (
                <div className={`mb-4 px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-medium
                  ${theme === 'light' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0"></span>
                  已设置 API Key
                </div>
              )}

              <div className="relative mb-4">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                  placeholder={hasApiKey() ? "输入新 key 以替换..." : "AIza..."}
                  className={`w-full px-4 py-3 pr-12 rounded-xl border text-sm outline-none transition-colors
                    ${theme === 'light'
                      ? 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
                      : 'bg-white/5 border-white/10 text-white placeholder-gray-600 focus:border-blue-500/50 focus:bg-white/10'}`}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${theme === 'light' ? 'text-slate-400 hover:text-slate-600' : 'text-gray-600 hover:text-gray-300'}`}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <p className={`text-xs mb-6 ${theme === 'light' ? 'text-slate-400' : 'text-gray-600'}`}>
                前往 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline hover:text-blue-400">Google AI Studio</a> 免费获取 API Key
              </p>

              <div className="flex gap-3">
                {hasApiKey() && (
                  <button
                    onClick={handleClearKey}
                    className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-colors border flex items-center gap-2
                      ${theme === 'light' ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-red-500/20 text-red-400 hover:bg-red-500/10'}`}
                  >
                    <X size={14} /> 清除
                  </button>
                )}
                <button
                  onClick={handleSaveKey}
                  disabled={!keyInput.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Views */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className={`h-full ${view === 'list' ? 'block' : 'hidden'}`}>
            <CharacterList 
              characters={characters} 
              onSelect={(char) => {
                setSelectedCharacterId(char.id);
                setView('edit');
              }}
              onDelete={handleDeleteCharacter}
              onDeleteBatch={handleDeleteBatch}
              onImport={handleImportCharacter}
              onImportBatch={handleImportBatch}
              onUpdate={handleUpdateCharacter}
              folders={folders}
              onCreateFolder={handleCreateFolder}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              theme={theme}
            />
          </div>

          {view === 'edit' && (
            <div className="h-full overflow-hidden">
              <CharacterForm 
                initialData={selectedCharacter}
                onSave={handleSaveCharacter}
                onCancel={() => setView('list')}
                onDelete={handleDeleteCharacter}
                theme={theme}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;