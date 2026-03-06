import React, { useState, useEffect } from 'react';
import { Character, ViewMode, Theme } from './types';
import CharacterList from './components/CharacterList';
import CharacterForm from './components/CharacterForm';
import { DEFAULT_CHARACTERS } from './constants';
import { Moon, Sun } from 'lucide-react';
import { loadImage, deleteImage, saveImage } from './services/imageService';

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

  const handleDeleteCharacter = (id: string) => {
    if (window.confirm("确定要删除这个角色吗？")) {
      deleteImage(id).catch(err => console.error("Failed to delete image", err));
      setCharacters(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleDeleteBatch = (ids: string[]) => {
    if (window.confirm(`确定要删除选中的 ${ids.length} 个角色吗？`)) {
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
        <div className="absolute top-6 right-6 z-50">
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
                onDelete={(id) => { handleDeleteCharacter(id); setView('list'); }}
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