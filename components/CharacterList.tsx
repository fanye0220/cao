import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Character, Theme } from '../types';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Pencil, Trash2, Upload, AlertCircle, Download, FileText, AlertTriangle, CheckSquare, Square, Filter, ChevronLeft, ChevronRight, ChevronDown, FolderInput, Book, MessageSquare, MoreVertical, FileJson, Image as ImageIcon, Check, Heart, Star, List, Tag, Menu, X, Plus, Copy, Folder, FolderPlus, GitCompare, Maximize, Search, BookOpen, QrCode, Scale, ArrowLeft, ArrowRight, Zap } from 'lucide-react';
import { parseCharacterCard, parseCharacterJson, exportCharacterData, exportBulkCharacters } from '../services/cardImportService';

// Removed invalid module augmentation. We will cast props if needed or ignore the error for now as it's just for directory upload.
// If needed, we can use a custom input component or just ignore the TS error on the input element locally.

interface CharacterListProps {
  characters: Character[];
  onSelect: (char: Character) => void;
  onDelete: (id: string, skipConfirm?: boolean) => void;
  onDeleteBatch?: (ids: string[], skipConfirm?: boolean) => void;
  onImport: (char: Character) => void;
  onImportBatch?: (chars: Character[]) => void;
  onUpdate?: (char: Character) => void; // Add onUpdate prop
  theme: Theme;
  folders?: string[]; // Optional for now as it seems unused in this version
  onCreateFolder?: (name: string) => void;
  onDeleteFolder?: (name: string) => void;
  onRenameFolder?: (oldName: string, newName: string) => void;
}

interface ImportResults {
  success: number;
  failed: number;
  invalidFormatFiles: string[];
  duplicateFiles: string[];
  otherFailedFiles: string[];
}

const CharacterList: React.FC<CharacterListProps> = ({ 
  characters, 
  onSelect, 
  onDelete,
  onDeleteBatch,
  onImport,
  onImportBatch,
  onUpdate,
  theme
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [importingCount, setImportingCount] = useState(0);
  
  // Import Error Modal State
  const [importErrorModalOpen, setImportErrorModalOpen] = useState(false);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  
  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTagsExpanded, setIsTagsExpanded] = useState(true);
  const [isCollectionsExpanded, setIsCollectionsExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState<{ type: 'all' | 'favorite' | 'tag' | 'duplicate' | 'collection', value?: string }>({ type: 'all' });
  const [searchQuery, setSearchQuery] = useState('');

  // Resizable Sidebar State
  const [collectionsHeight, setCollectionsHeight] = useState(180);
  const [tagsHeight, setTagsHeight] = useState(180);
  const [resizingTarget, setResizingTarget] = useState<'collections' | 'tags' | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingTarget) return;
      
      if (resizingTarget === 'collections') {
          setCollectionsHeight(prev => {
              const newHeight = prev + e.movementY;
              return Math.max(50, Math.min(600, newHeight));
          });
      } else if (resizingTarget === 'tags') {
          setTagsHeight(prev => {
              const newHeight = prev + e.movementY;
              return Math.max(50, Math.min(600, newHeight));
          });
      }
    };

    const handleMouseUp = () => {
      setResizingTarget(null);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    if (resizingTarget) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingTarget]);

  // States
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [exportMenuCharId, setExportMenuCharId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<'updated-desc' | 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('updated-desc');
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [viewCharacter, setViewCharacter] = useState<Character | null>(null);
  
  // Tag & Collection Management
  const [customTags, setCustomTags] = useState<string[]>([]); // "Card Tags"
  const [collections, setCollections] = useState<string[]>(() => {
      try {
          const saved = localStorage.getItem('collections');
          return saved ? JSON.parse(saved) : [];
      } catch {
          return [];
      }
  });
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isAddingCollection, setIsAddingCollection] = useState(false);
  const [newTagInputValue, setNewTagInputValue] = useState('');
  const [newCollectionInputValue, setNewCollectionInputValue] = useState('');

  useEffect(() => {
      localStorage.setItem('collections', JSON.stringify(collections));
  }, [collections]);

  // Renaming State
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleStartRenameCollection = (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingCollection(name);
      setRenameValue(name);
  };

  // Drag and Drop State
  const [draggedCharId, setDraggedCharId] = useState<string | null>(null);
  const [dragOverCollection, setDragOverCollection] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, charId: string) => {
      setDraggedCharId(charId);
      e.dataTransfer.setData('text/plain', charId);
      e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, collectionName: string) => {
      e.preventDefault();
      setDragOverCollection(collectionName);
      e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCollection(null);
  };

  const handleDrop = (e: React.DragEvent, collectionName: string) => {
      e.preventDefault();
      setDragOverCollection(null);
      const charId = e.dataTransfer.getData('text/plain');
      
      if (charId) {
          const char = characters.find(c => c.id === charId);
          if (char) {
              const currentTags = Array.isArray(char.tags) ? char.tags : [];
              if (!currentTags.includes(collectionName)) {
                  onUpdate?.({ ...char, tags: [...currentTags, collectionName] });
                  // Optional: Show success feedback
              }
          }
      }
      setDraggedCharId(null);
  };
  const handleFinishRenameCollection = () => {
      if (!editingCollection || !renameValue.trim()) {
          setEditingCollection(null);
          return;
      }
      const newName = renameValue.trim();
      if (newName !== editingCollection && !collections.includes(newName)) {
          setCollections(prev => prev.map(c => c === editingCollection ? newName : c));
          
          // Update characters
          characters.forEach(char => {
              const currentTags = Array.isArray(char.tags) ? char.tags : [];
              if (currentTags.includes(editingCollection)) {
                  const newTags = currentTags.map(t => t === editingCollection ? newName : t);
                  onUpdate?.({ ...char, tags: newTags });
              }
          });
          if (activeFilter.type === 'collection' && activeFilter.value === editingCollection) {
              setActiveFilter({ ...activeFilter, value: newName });
          }
      }
      setEditingCollection(null);
  };

  const handleStartRenameTag = (tag: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingTag(tag);
      setRenameValue(tag);
  };

  const handleFinishRenameTag = () => {
      if (!editingTag || !renameValue.trim()) {
          setEditingTag(null);
          return;
      }
      const newName = renameValue.trim();
      if (newName !== editingTag && !allTags.includes(newName)) {
          // Update custom tags list if it's there
          setCustomTags(prev => prev.map(t => t === editingTag ? newName : t));
          
          // Update characters
          characters.forEach(char => {
              const currentTags = Array.isArray(char.tags) ? char.tags : [];
              if (currentTags.includes(editingTag)) {
                  const newTags = currentTags.map(t => t === editingTag ? newName : t);
                  onUpdate?.({ ...char, tags: newTags });
              }
          });
          
          if (activeFilter.type === 'tag' && activeFilter.value === editingTag) {
              setActiveFilter({ ...activeFilter, value: newName });
          }
      }
      setEditingTag(null);
  };
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [jumpPage, setJumpPage] = useState('');

  useEffect(() => {
    setCurrentPage(1);
  }, [characters.length, itemsPerPage, sortOption, activeFilter]);

  // Compute unique tags (excluding collections)
  const allTags = useMemo(() => {
    const tags = new Set<string>(customTags);
    characters.forEach(c => {
      const currentTags = Array.isArray(c.tags) ? c.tags : [];
      currentTags.forEach(t => {
          if (!collections.includes(t)) {
              tags.add(t);
          }
      });
    });
    return Array.from(tags).sort();
  }, [characters, customTags, collections]);

  const duplicateIds = useMemo(() => {
    const seenNames = new Map<string, string[]>();
    const ids = new Set<string>();
    
    characters.forEach(c => {
        const existing = seenNames.get(c.name) || [];
        seenNames.set(c.name, [...existing, c.id]);
    });

    seenNames.forEach((idsList) => {
        if (idsList.length > 1) {
            idsList.forEach(id => ids.add(id));
        }
    });
    return ids;
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    let result = characters;
    
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        result = result.filter(c => 
            c.name.toLowerCase().includes(query) || 
            (c.description && c.description.toLowerCase().includes(query)) ||
            (c.firstMessage && c.firstMessage.toLowerCase().includes(query))
        );
    }
    
    // Apply Active Filter
    if (activeFilter.type === 'favorite') {
        result = result.filter(c => c.isFavorite);
    } else if (activeFilter.type === 'tag' && activeFilter.value) {
        result = result.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || ''));
    } else if (activeFilter.type === 'collection' && activeFilter.value) {
        result = result.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || ''));
    } else if (activeFilter.type === 'duplicate') {
        result = result.filter(c => duplicateIds.has(c.id));
    }
    
    // Sorting
    return [...result].sort((a, b) => {
        if (sortOption === 'updated-desc') {
            return (b.updatedAt || b.importDate || 0) - (a.updatedAt || a.importDate || 0);
        } else if (sortOption === 'date-desc') {
            return (b.importDate || 0) - (a.importDate || 0);
        } else if (sortOption === 'date-asc') {
            return (a.importDate || 0) - (b.importDate || 0);
        } else if (sortOption === 'name-asc') {
            return a.name.localeCompare(b.name);
        } else if (sortOption === 'name-desc') {
            return b.name.localeCompare(a.name);
        }
        return 0;
    });
  }, [characters, duplicateIds, sortOption, activeFilter, searchQuery]);

  const groupedCharacters = useMemo<[string, Character[]][] | null>(() => {
    if (activeFilter.type !== 'duplicate') return null;
    const groups: Record<string, Character[]> = {};
    filteredCharacters.forEach(c => {
      if (!groups[c.name]) groups[c.name] = [];
      groups[c.name].push(c);
    });
    return Object.entries(groups);
  }, [filteredCharacters, activeFilter]);

  const displayCharacters = useMemo(() => {
    if (activeFilter.type === 'duplicate') return []; // Not used in grouped mode
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredCharacters.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredCharacters, currentPage, itemsPerPage, activeFilter]);

  const displayGroups = useMemo(() => {
    if (!groupedCharacters) return [];
    const startIndex = (currentPage - 1) * itemsPerPage;
    return groupedCharacters.slice(startIndex, startIndex + itemsPerPage);
  }, [groupedCharacters, currentPage, itemsPerPage]);

  const totalPages = activeFilter.type === 'duplicate' && groupedCharacters
      ? Math.ceil(groupedCharacters.length / itemsPerPage)
      : Math.ceil(filteredCharacters.length / itemsPerPage);

  const renderCharacterCard = (char: Character) => {
    const isDuplicate = duplicateIds.has(char.id);
    const hasQr = char.qrList && char.qrList.length > 0;
    const hasWorldInfo = !!(char.scenario || (char.character_book?.entries?.length > 0));
    const isSelected = selectedIds.has(char.id);
    const showExportMenu = exportMenuCharId === char.id;

    return (
        <div 
            key={char.id} 
            onClick={(e) => {
                if (isSelectionMode) toggleSelection(char.id, e.shiftKey);
                else onSelect(char);
            }}
            draggable
            onDragStart={(e) => handleDragStart(e, char.id)}
            className={`
                flex flex-col h-[500px] rounded-[24px] overflow-hidden relative group transition-all duration-300
                ${theme === 'light' 
                    ? 'bg-white shadow-lg hover:shadow-xl border border-slate-200' 
                    : 'bg-[#1a1b1e] shadow-xl hover:shadow-2xl border border-white/10'
                }
                ${isSelected ? 'transform scale-[0.98] border-blue-500/50' : 'hover:-translate-y-1'}
                cursor-grab active:cursor-grabbing
                ${isDuplicate && activeFilter.type !== 'duplicate' && theme === 'dark' ? 'border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.1)]' : ''} 
                ${isDuplicate && activeFilter.type !== 'duplicate' && theme === 'light' ? 'border-yellow-400 shadow-md' : ''}
                ${draggedCharId === char.id ? 'opacity-50' : ''}
            `}
        >
        
        {/* Image Section (Top 65%) */}
        <div className="h-[65%] w-full relative overflow-hidden bg-gray-900">
             <img 
                src={char.avatarUrl} 
                alt={char.name} 
                className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
                loading="lazy" 
            />
            {/* Dark gradient overlay */}
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
        </div>

        {/* Content Section */}
        <div className="flex-1 p-4 flex flex-col relative">
            <div className="flex gap-1 mb-1">
                 {isDuplicate && activeFilter.type !== 'duplicate' && <AlertTriangle size={12} className="text-yellow-500"/>}
            </div>

            <div className="mb-2">
                <div className="flex items-center gap-2 mb-1">
                    <h3 className={`text-lg font-bold truncate leading-tight ${theme === 'light' ? 'text-gray-900' : 'text-gray-100'}`} title={char.name}>
                        {char.name}
                    </h3>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {hasQr && <span className="text-[9px] font-extrabold text-green-500 border border-green-500/50 rounded-[3px] px-1 py-[1px] leading-none" title="包含二维码配置">QR</span>}
                        {hasWorldInfo && <Book size={14} className="text-yellow-500" title="包含世界书" />}
                    </div>
                </div>
                <div className={`flex items-center gap-1.5 text-[11px] font-medium truncate ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`} title={char.originalFilename || "Local"}>
                    <FileText size={10} />
                    {char.originalFilename || "local_card.png"}
                </div>
            </div>

            <div className={`h-[90px] shrink-0 rounded-xl p-3 flex flex-col gap-1.5 ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
                 <div className="flex justify-between items-center">
                     <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>
                         FIRST MESSAGE
                     </span>
                     <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 ${theme === 'light' ? 'bg-white text-gray-400 shadow-sm' : 'bg-black/20 text-gray-500'}`}>
                         <MessageSquare size={8} /> 
                         <span>{(char.firstMessage ? 1 : 0) + (char.alternate_greetings?.length || 0)}</span>
                     </div>
                 </div>
                 <p className={`text-[11px] line-clamp-4 leading-relaxed ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                     {char.firstMessage || "..."}
                 </p>
            </div>
        </div>

        {/* Selection Overlay (Ring Only) */}
        {isSelected && (
            <div className="absolute inset-0 border-[3px] border-blue-500 rounded-[24px] pointer-events-none z-30"></div>
        )}
        </div>
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setWarning(null);
    setImportingCount(files.length);

    let successCount = 0;
    let failCount = 0;
    const invalidFormatFiles: string[] = [];
    const duplicateFiles: string[] = [];
    const otherFailedFiles: string[] = [];
    const fileArray = Array.from(files) as File[];
    const validChars: Character[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];

      // Yield to main thread every few items to keep UI responsive
      if (i % 5 === 0) {
          setImportingCount(fileArray.length - i);
          await new Promise(resolve => setTimeout(resolve, 0));
      }

      const isPng = file.name.toLowerCase().endsWith('.png');
      const isJson = file.name.toLowerCase().endsWith('.json');
      
      if (!isPng && !isJson) {
          continue; 
      }
      try {
        let char: Character;
        if (isPng) {
            char = await parseCharacterCard(file);
        } else {
            char = await parseCharacterJson(file);
        }

        const isDuplicateName = characters.some(c => c.name === char.name);
        if (isDuplicateName) {
            duplicateFiles.push(file.name);
            if (files.length === 1) {
                setWarning(`注意：检测到重复的角色 "${char.name}"，已导入`);
            }
        }
        
        validChars.push(char);
        successCount++;
      } catch (err: any) {
        console.error(`Failed to import ${file.name}:`, err);
        failCount++;
        const msg = err.message || "";
        if (msg.includes("不是有效的 PNG 文件") || msg.includes("未在此图片中找到角色数据") || msg.includes("Invalid JSON file") || msg.includes("无效的")) {
            invalidFormatFiles.push(file.name);
        } else {
            otherFailedFiles.push(file.name);
        }
      }
    }

    if (validChars.length > 0) {
        if (onImportBatch) {
            onImportBatch(validChars);
        } else {
            validChars.forEach(char => onImport(char));
        }
    }

    setImportingCount(0);
    if (failCount > 0) {
        setImportResults({ success: successCount, failed: failCount, invalidFormatFiles, duplicateFiles, otherFailedFiles });
        setImportErrorModalOpen(true);
    } else if (files.length > 1) {
        // Optional: show success toast for bulk import
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const toggleSelection = (id: string, shiftKey: boolean = false) => {
    const newSet = new Set(selectedIds);
    
    // Determine the current list of visible characters
    let currentVisibleList: Character[] = [];
    if (activeFilter.type === 'duplicate') {
        // Flatten the groups
        currentVisibleList = displayGroups.flatMap(([_, chars]) => chars);
    } else {
        currentVisibleList = displayCharacters;
    }

    if (shiftKey && lastSelectedId) {
        const currentIndex = currentVisibleList.findIndex(c => c.id === id);
        const lastIndex = currentVisibleList.findIndex(c => c.id === lastSelectedId);

        if (currentIndex !== -1 && lastIndex !== -1) {
            const start = Math.min(currentIndex, lastIndex);
            const end = Math.max(currentIndex, lastIndex);
            
            // Select everything in range
            for (let i = start; i <= end; i++) {
                newSet.add(currentVisibleList[i].id);
            }
        } else {
             // Fallback: just toggle the current one
             if (newSet.has(id)) newSet.delete(id);
             else newSet.add(id);
        }
    } else {
        // Normal toggle
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
    }
    
    setSelectedIds(newSet);
    setLastSelectedId(id);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCharacters.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredCharacters.map(c => c.id)));
    setLastSelectedId(null);
  };

  const toggleSelectAllPage = () => {
    const currentList = activeFilter.type === 'duplicate' ? filteredCharacters : displayCharacters;
    const newSet = new Set(selectedIds);
    const allPageSelected = currentList.length > 0 && currentList.every(c => newSet.has(c.id));
    if (allPageSelected) {
        currentList.forEach(c => newSet.delete(c.id));
    } else {
        currentList.forEach(c => newSet.add(c.id));
    }
    setSelectedIds(newSet);
    setLastSelectedId(null);
  };

  const handleBulkExport = async () => {
    const selectedChars = characters.filter(c => selectedIds.has(c.id));
    if (selectedChars.length === 0) return;
    try {
        await exportBulkCharacters(selectedChars, collections);
        setIsSelectionMode(false);
        setSelectedIds(new Set());
        setLastSelectedId(null);
    } catch (e: any) {
        setError("批量导出失败: " + e.message);
    }
  };

  const handleSingleExport = async (char: Character, format: 'json' | 'png') => {
    setExportMenuCharId(null);
    
    // Check if trying to export PNG from a JSON-imported character (or one without a proper avatar)
    if (format === 'png' && char.importFormat === 'json') {
        // We can check if the avatar is a blob URL (which means they uploaded one) or a picsum URL (placeholder)
        // If it's a placeholder, we should definitely warn.
        if (char.avatarUrl.includes('picsum.photos')) {
             if (!window.confirm("该角色是通过 JSON 导入的，且似乎没有上传自定义头像（当前是随机占位图）。\n导出 PNG 会将数据嵌入到这张占位图中。\n\n确定要继续吗？建议先在编辑页面上传一张图片。")) {
                 return;
             }
        }
    }

    try {
      await exportCharacterData(char, format);
    } catch (err) {
      console.error("Export failed", err);
      setError("导出失败");
    }
  };

  const handleAddTag = () => {
    const tag = newTagInputValue.trim();
    if (tag && !allTags.includes(tag) && !collections.includes(tag)) {
        setCustomTags(prev => [...prev, tag]);
        setNewTagInputValue('');
        setIsAddingTag(false);
    }
  };

  const handleAddCollection = () => {
      const name = newCollectionInputValue.trim();
      if (name && !collections.includes(name) && !allTags.includes(name)) {
          setCollections(prev => [...prev, name]);
          setNewCollectionInputValue('');
          setIsAddingCollection(false);
      }
  };

  const handleDeleteCollection = (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`确定要删除收藏夹 "${name}" 吗? 这将从所有角色中移除此标签。`)) return;
      
      setCollections(prev => prev.filter(c => c !== name));
      
      // Remove tag from characters
      characters.forEach(char => {
          const currentTags = Array.isArray(char.tags) ? char.tags : [];
          if (currentTags.includes(name)) {
              const newTags = currentTags.filter(t => t !== name);
              onUpdate?.({ ...char, tags: newTags });
          }
      });

      if (activeFilter.type === 'collection' && activeFilter.value === name) {
          setActiveFilter({ type: 'all' });
      }
  };

  const handleDeleteTag = (tagToDelete: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`确定要删除标签 "${tagToDelete}" 吗? 这将从所有角色中移除此标签。`)) return;
      
      // Remove from custom tags
      setCustomTags(prev => prev.filter(t => t !== tagToDelete));
      
      // Remove from all characters
      characters.forEach(char => {
          const currentTags = Array.isArray(char.tags) ? char.tags : [];
          if (currentTags.includes(tagToDelete)) {
              const newTags = currentTags.filter(t => t !== tagToDelete);
              onUpdate?.({ ...char, tags: newTags });
          }
      });
      
      if (activeFilter.type === 'tag' && activeFilter.value === tagToDelete) {
          setActiveFilter({ type: 'all' });
      }
  };

  const textColor = theme === 'light' ? 'text-slate-800' : 'text-white';
  const subTextColor = theme === 'light' ? 'text-slate-500' : 'text-blue-200/70';
  const buttonBase = theme === 'light' 
    ? 'bg-white/50 hover:bg-white/80 border-slate-200 text-slate-700 shadow-sm' 
    : 'bg-white/10 hover:bg-white/20 border-white/20 text-white shadow-lg';
  const activeFilterClass = theme === 'light' 
    ? 'bg-blue-100 border-blue-300 text-blue-700' 
    : 'bg-blue-500/30 border-blue-400 text-white';

  return (
    <div className="w-full max-w-[1600px] mx-auto animate-fade-in relative flex h-full gap-6">
      
      {/* Sidebar */}
      <div className={`transition-all duration-300 flex flex-col shrink-0 ${isSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 overflow-hidden'}`}>
          <div className={`flex-1 rounded-2xl p-4 flex flex-col gap-2 ${theme === 'light' ? 'bg-white/50 border border-slate-200' : 'bg-black/20 border border-white/10'}`}>
              


              {/* All Characters */}
              <button 
                  onClick={() => setActiveFilter({ type: 'all' })}
                  className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center gap-3 transition-all duration-300 group ${
                      activeFilter.type === 'all' 
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 scale-[1.02]' 
                          : (theme === 'light' ? 'hover:bg-white/60 text-slate-600 hover:shadow-sm' : 'hover:bg-white/10 text-gray-400')
                  }`}
              >
                  <List size={18} className={activeFilter.type === 'all' ? 'text-white' : ''} />
                  <span>全部角色</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                      activeFilter.type === 'all' 
                          ? 'bg-white/20 text-white' 
                          : 'bg-black/5 text-slate-400 group-hover:bg-black/10'
                  }`}>
                      {characters.length}
                  </span>
              </button>

              {/* Duplicates */}
              <button 
                  onClick={() => setActiveFilter({ type: 'duplicate' })}
                  className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center gap-3 transition-all duration-300 group ${
                      activeFilter.type === 'duplicate' 
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 scale-[1.02]' 
                          : (theme === 'light' ? 'hover:bg-white/60 text-slate-600 hover:shadow-sm' : 'hover:bg-white/10 text-gray-400')
                  }`}
              >
                  <Copy size={18} className={activeFilter.type === 'duplicate' ? 'text-white' : ''} />
                  <span>重复角色</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                      activeFilter.type === 'duplicate' 
                          ? 'bg-white/20 text-white' 
                          : 'bg-black/5 text-slate-400 group-hover:bg-black/10'
                  }`}>
                      {duplicateIds.size}
                  </span>
              </button>

              <div className={`h-px my-3 mx-2 ${theme === 'light' ? 'bg-slate-200/60' : 'bg-white/5'}`}></div>

              {/* Collections Header */}
              <div className={`w-full px-2 py-2 flex items-center justify-between`}>
                  <button 
                      onClick={() => setIsCollectionsExpanded(!isCollectionsExpanded)}
                      className={`flex-1 text-left font-bold text-xs uppercase tracking-wider flex items-center gap-2 ${theme === 'light' ? 'text-slate-400 hover:text-slate-600' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                      <Folder size={14} />
                      <span>收藏夹 ({collections.length})</span>
                      {isCollectionsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button 
                      onClick={() => setIsAddingCollection(!isAddingCollection)}
                      className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-slate-200 text-slate-400 hover:text-slate-600' : 'hover:bg-white/10 text-gray-500 hover:text-gray-300'}`}
                      title="新建收藏夹"
                  >
                      <FolderPlus size={14} />
                  </button>
              </div>

              {/* Collections List */}
              <div 
                  className={`overflow-y-auto custom-scrollbar space-y-1 transition-all duration-300 mb-2 shrink-0 ${isCollectionsExpanded ? 'opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}
                  style={isCollectionsExpanded ? { maxHeight: `${collectionsHeight}px` } : {}}
              >
                  {isAddingCollection && (
                      <div className="px-2 mb-2">
                          <input
                              autoFocus
                              type="text"
                              value={newCollectionInputValue}
                              onChange={(e) => setNewCollectionInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddCollection();
                                  if (e.key === 'Escape') setIsAddingCollection(false);
                              }}
                              onBlur={() => {
                                  if (newCollectionInputValue.trim()) handleAddCollection();
                                  else setIsAddingCollection(false);
                              }}
                              placeholder="收藏夹名称..."
                              className={`w-full px-3 py-2 rounded-xl text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                          />
                      </div>
                  )}
                  {collections.map(name => (
                      <div key={name} className="relative group">
                          {editingCollection === name ? (
                              <input
                                  autoFocus
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleFinishRenameCollection();
                                      if (e.key === 'Escape') setEditingCollection(null);
                                  }}
                                  onBlur={handleFinishRenameCollection}
                                  className={`w-full px-3 py-2 rounded-xl text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                              />
                          ) : (
                              <button
                                  onClick={() => setActiveFilter({ type: 'collection', value: name })}
                                  onDoubleClick={(e) => handleStartRenameCollection(name, e)}
                                  onDragOver={(e) => handleDragOver(e, name)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, name)}
                                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all group relative 
                                    ${activeFilter.type === 'collection' && activeFilter.value === name ? (theme === 'light' ? 'bg-slate-200 text-slate-900' : 'bg-white/20 text-white') : (theme === 'light' ? 'hover:bg-white/50 text-slate-500' : 'hover:bg-white/5 text-gray-400')}
                                    ${dragOverCollection === name ? (theme === 'light' ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-blue-500/30 ring-2 ring-blue-500') : ''}
                                  `}
                              >
                                  <Folder size={14} className="opacity-70" />
                                  <span className="truncate flex-1">{name}</span>
                                  <span className="text-[10px] opacity-50 group-hover:opacity-0 transition-opacity">{characters.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(name)).length}</span>
                                  
                                  {/* Actions */}
                                  <div className={`absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all`}>
                                      <div 
                                          onClick={(e) => handleStartRenameCollection(name, e)}
                                          className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-blue-100 text-blue-400' : 'hover:bg-blue-500/20 text-blue-400'}`}
                                          title="重命名"
                                      >
                                          <Pencil size={12} />
                                      </div>
                                      <div 
                                          onClick={(e) => handleDeleteCollection(name, e)}
                                          className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-red-100 text-red-400' : 'hover:bg-red-500/20 text-red-400'}`}
                                          title="删除"
                                      >
                                          <Trash2 size={12} />
                                      </div>
                                  </div>
                              </button>
                          )}
                      </div>
                  ))}
                  {collections.length === 0 && !isAddingCollection && (
                      <div className={`text-center py-4 text-xs ${theme === 'light' ? 'text-slate-400' : 'text-gray-600'}`}>
                          暂无收藏夹
                      </div>
                  )}
              </div>

              {/* Resize Handle for Collections */}
              <div 
                  className={`h-1.5 my-1 mx-2 shrink-0 cursor-row-resize flex items-center justify-center group transition-colors rounded-full ${resizingTarget === 'collections' ? 'bg-blue-500/50' : (theme === 'light' ? 'hover:bg-slate-200' : 'hover:bg-white/10')}`}
                  onMouseDown={(e) => {
                      e.preventDefault();
                      setResizingTarget('collections');
                  }}
              >
                  <div className={`w-8 h-1 rounded-full transition-colors ${resizingTarget === 'collections' ? 'bg-blue-500' : (theme === 'light' ? 'bg-slate-300 group-hover:bg-slate-400' : 'bg-white/20 group-hover:bg-white/40')}`}></div>
              </div>

              {/* Tags Header */}
              <div className={`w-full px-2 py-2 flex items-center justify-between shrink-0`}>
                  <button 
                      onClick={() => setIsTagsExpanded(!isTagsExpanded)}
                      className={`flex-1 text-left font-bold text-xs uppercase tracking-wider flex items-center gap-2 ${theme === 'light' ? 'text-slate-400 hover:text-slate-600' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                      <Tag size={14} />
                      <span>标签 ({allTags.length})</span>
                      {isTagsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button 
                      onClick={() => setIsAddingTag(!isAddingTag)}
                      className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-slate-200 text-slate-400 hover:text-slate-600' : 'hover:bg-white/10 text-gray-500 hover:text-gray-300'}`}
                      title="Add Tag"
                  >
                      <Plus size={14} />
                  </button>
              </div>

              {/* Tags List */}
              <div 
                  className={`min-h-0 overflow-y-auto custom-scrollbar space-y-1 transition-all duration-300 shrink-0 ${isTagsExpanded ? 'opacity-100' : 'h-0 opacity-0 overflow-hidden'}`}
                  style={isTagsExpanded ? { height: `${tagsHeight}px` } : {}}
              >
                  {isAddingTag && (
                      <div className="px-2 mb-2">
                          <input
                              autoFocus
                              type="text"
                              value={newTagInputValue}
                              onChange={(e) => setNewTagInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddTag();
                                  if (e.key === 'Escape') setIsAddingTag(false);
                              }}
                              onBlur={() => {
                                  if (newTagInputValue.trim()) handleAddTag();
                                  else setIsAddingTag(false);
                              }}
                              placeholder="New tag..."
                              className={`w-full px-3 py-2 rounded-xl text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                          />
                      </div>
                  )}
                  {allTags.map(tag => (
                      <div key={tag} className="relative group">
                          {editingTag === tag ? (
                              <input
                                  autoFocus
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleFinishRenameTag();
                                      if (e.key === 'Escape') setEditingTag(null);
                                  }}
                                  onBlur={handleFinishRenameTag}
                                  className={`w-full px-3 py-2 rounded-xl text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                              />
                          ) : (
                              <button
                                  onClick={() => setActiveFilter({ type: 'tag', value: tag })}
                                  onDoubleClick={(e) => handleStartRenameTag(tag, e)}
                                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all group relative ${activeFilter.type === 'tag' && activeFilter.value === tag ? (theme === 'light' ? 'bg-slate-200 text-slate-900' : 'bg-white/20 text-white') : (theme === 'light' ? 'hover:bg-white/50 text-slate-500' : 'hover:bg-white/5 text-gray-400')}`}
                              >
                                  <span className="truncate flex-1"># {tag}</span>
                                  <span className="text-[10px] opacity-50 group-hover:opacity-0 transition-opacity">{characters.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(tag)).length}</span>
                                  
                                  {/* Actions */}
                                  <div className={`absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all`}>
                                      <div 
                                          onClick={(e) => handleStartRenameTag(tag, e)}
                                          className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-blue-100 text-blue-400' : 'hover:bg-blue-500/20 text-blue-400'}`}
                                          title="重命名"
                                      >
                                          <Pencil size={12} />
                                      </div>
                                      <div 
                                          onClick={(e) => handleDeleteTag(tag, e)}
                                          className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-red-100 text-red-400' : 'hover:bg-red-500/20 text-red-400'}`}
                                          title="删除"
                                      >
                                          <Trash2 size={12} />
                                      </div>
                                  </div>
                              </button>
                          )}
                      </div>
                  ))}
                  {allTags.length === 0 && !isAddingTag && (
                      <div className={`text-center py-4 text-xs ${theme === 'light' ? 'text-slate-400' : 'text-gray-600'}`}>
                          暂无标签
                      </div>
                  )}
              </div>

              {/* Resize Handle for Tags */}
              <div 
                  className={`h-1.5 my-1 mx-2 shrink-0 cursor-row-resize flex items-center justify-center group transition-colors rounded-full ${resizingTarget === 'tags' ? 'bg-blue-500/50' : (theme === 'light' ? 'hover:bg-slate-200' : 'hover:bg-white/10')}`}
                  onMouseDown={(e) => {
                      e.preventDefault();
                      setResizingTarget('tags');
                  }}
              >
                  <div className={`w-8 h-1 rounded-full transition-colors ${resizingTarget === 'tags' ? 'bg-blue-500' : (theme === 'light' ? 'bg-slate-300 group-hover:bg-slate-400' : 'bg-white/20 group-hover:bg-white/40')}`}></div>
              </div>

              {/* Spacer to fill remaining space */}
              <div className="flex-1 min-h-0"></div>
          </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative">
      {/* Header Controls */}
      <div className="flex flex-col xl:flex-row justify-between items-end mb-4 px-2 gap-4 shrink-0">
        <div className="flex items-center gap-4">
           <button 
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className={`p-2 rounded-xl transition-colors ${theme === 'light' ? 'bg-white/50 hover:bg-white text-slate-600' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
           >
               {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
           </button>
           <div>
               <h1 className={`text-2xl font-bold mb-1 tracking-tight drop-shadow-sm ${textColor}`}>
                   {activeFilter.type === 'all' && '全部角色'}
                   {activeFilter.type === 'tag' && `# ${activeFilter.value}`}
                   {activeFilter.type === 'collection' && `${activeFilter.value}`}
                   {activeFilter.type === 'duplicate' && '重复角色'}
               </h1>
               <p className={`text-xs ${subTextColor}`}>
                   {activeFilter.type === 'all' && `共 ${characters.length} 张卡片`}
                   {activeFilter.type === 'tag' && `标签 "${activeFilter.value}" 下共 ${characters.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || '')).length} 张卡片`}
                   {activeFilter.type === 'collection' && `收藏夹 "${activeFilter.value}" 下共 ${characters.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || '')).length} 张卡片`}
                   {activeFilter.type === 'duplicate' && `共 ${duplicateIds.size} 张重复卡片`}
               </p>
           </div>

           {/* Search Box - Moved from Sidebar */}
           <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors w-64 ${theme === 'light' ? 'bg-white/50 border-slate-200 focus-within:bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100' : 'bg-white/5 border-white/10 focus-within:bg-black/40 focus-within:border-blue-500/50'}`}>
               <Search size={16} className={theme === 'light' ? 'text-slate-400' : 'text-gray-500'} />
               <input 
                   type="text"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   placeholder="搜索角色..."
                   className={`w-full bg-transparent outline-none text-sm font-medium ${theme === 'light' ? 'text-slate-700 placeholder-slate-400' : 'text-white placeholder-gray-500'}`}
               />
               {searchQuery && (
                   <button onClick={() => setSearchQuery('')} className={`p-0.5 rounded-full transition-colors ${theme === 'light' ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'text-gray-500 hover:bg-white/10 hover:text-gray-300'}`}>
                       <X size={14} />
                   </button>
               )}
           </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center justify-end">
            <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-medium backdrop-blur-sm ${buttonBase}`}>
                <span className="opacity-70">排序:</span>
                <select 
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as any)}
                    className="bg-transparent border-none outline-none cursor-pointer font-bold appearance-none"
                    style={{ textAlignLast: 'center' }}
                >
                    <option value="updated-desc" className="text-black">最近修改</option>
                    <option value="date-desc" className="text-black">最新导入</option>
                    <option value="date-asc" className="text-black">最早导入</option>
                    <option value="name-asc" className="text-black">名称 A-Z</option>
                    <option value="name-desc" className="text-black">名称 Z-A</option>
                </select>
                <ChevronDown size={10} className="opacity-50"/>
            </div>

            <button
                onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedIds(new Set());
                    setLastSelectedId(null);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-medium backdrop-blur-sm transition-all ${isSelectionMode ? activeFilterClass : buttonBase}`}
            >
                <CheckSquare size={12} />
                {isSelectionMode ? '取消' : '多选'}
            </button>

            <input type="file" accept="image/png,application/json" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            {/* @ts-ignore */}
            <input type="file" webkitdirectory="" directory="" multiple className="hidden" ref={folderInputRef} onChange={handleFileChange} />

            <div className="flex gap-1">
                <button 
                    onClick={() => folderInputRef.current?.click()}
                    disabled={importingCount > 0}
                    className={`flex items-center gap-2 px-4 py-1.5 border rounded-l-full font-medium backdrop-blur-sm transition-all hover:brightness-110 text-xs ${buttonBase}`}
                    title="导入整个文件夹"
                >
                    <FolderInput size={14} /> 文件夹
                </button>
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importingCount > 0}
                    className={`flex items-center gap-2 px-4 py-1.5 border rounded-r-full font-medium backdrop-blur-sm transition-all hover:brightness-110 text-xs border-l-0 ${buttonBase}`}
                    title="导入文件"
                >
                    <Upload size={14} /> 文件
                </button>
            </div>
             {importingCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-blue-400 animate-pulse">
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}
        </div>
      </div>
      
      {/* Bulk Action Bar */}
      {isSelectionMode && (
          <div className={`mb-4 mx-2 p-3 rounded-2xl flex items-center justify-between backdrop-blur-xl shadow-lg border animate-slide-down z-20 ${
              theme === 'light' 
                  ? 'bg-blue-50/90 border-blue-100 text-blue-900' 
                  : 'bg-blue-900/20 border-blue-500/20 text-blue-100'
          }`}>
             <div className="flex items-center gap-4 px-2">
                 <div className="flex items-center gap-3">
                     {activeFilter.type !== 'duplicate' && (
                         <button onClick={toggleSelectAllPage} className="flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-opacity">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                displayCharacters.length > 0 && displayCharacters.every(c => selectedIds.has(c.id))
                                    ? 'bg-blue-500 border-blue-500 text-white'
                                    : 'bg-transparent border-current'
                            }`}>
                                {displayCharacters.length > 0 && displayCharacters.every(c => selectedIds.has(c.id)) && <Check size={14} strokeWidth={3} />}
                            </div>
                            全选本页
                         </button>
                     )}
                     <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-opacity">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                            selectedIds.size === filteredCharacters.length && filteredCharacters.length > 0
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-transparent border-current'
                        }`}>
                            {selectedIds.size === filteredCharacters.length && filteredCharacters.length > 0 && <Check size={14} strokeWidth={3} />}
                        </div>
                        全选全部
                     </button>
                     {selectedIds.size > 0 && (
                         <button onClick={() => setSelectedIds(new Set())} className="text-sm font-bold opacity-70 hover:opacity-100 transition-opacity ml-2">
                            取消选择
                         </button>
                     )}
                 </div>
                 <span className="text-sm font-bold opacity-80 border-l border-current pl-4">已选 {selectedIds.size} 项</span>
             </div>
             <div className="flex gap-3">
                 {selectedIds.size === 2 && (
                     <Button 
                         variant="secondary" 
                         onClick={() => setCompareModalOpen(true)} 
                         className="!py-1.5 !px-4 !text-xs !h-9 !rounded-lg shadow-sm hover:shadow-md transition-all bg-indigo-500 hover:bg-indigo-600 text-white border-none"
                     >
                        <GitCompare size={14} className="mr-1.5" /> 对比选中 (2)
                     </Button>
                 )}
                 <Button 
                     variant="primary" 
                     disabled={selectedIds.size === 0} 
                     onClick={handleBulkExport} 
                     className="!py-1.5 !px-4 !text-xs !h-9 !rounded-lg shadow-sm hover:shadow-md transition-all bg-blue-500 hover:bg-blue-600 border-none"
                 >
                    <Download size={14} className="mr-1.5" /> 导出 (ZIP)
                 </Button>
                 <Button 
                     variant="danger" 
                     disabled={selectedIds.size === 0} 
                     onClick={() => {if(window.confirm(`确定删除这 ${selectedIds.size} 张卡片吗?`)) { onDeleteBatch?.(Array.from(selectedIds), true); setSelectedIds(new Set()); }}} 
                     className="!py-1.5 !px-4 !text-xs !h-9 !rounded-lg shadow-sm hover:shadow-md transition-all bg-red-500 hover:bg-red-600 border-none"
                 >
                    <Trash2 size={14} className="mr-1.5" /> 删除
                 </Button>
             </div>
          </div>
      )}

      {error && <div className="mb-4 mx-2 p-3 bg-red-500/20 border border-red-500/40 rounded-xl flex items-center gap-3 text-red-100 backdrop-blur-md text-sm"><AlertCircle className="text-red-400" size={16} />{error}</div>}
      {warning && <div className="mb-4 mx-2 p-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl flex items-center gap-3 text-yellow-100 backdrop-blur-md text-sm"><AlertTriangle className="text-yellow-400" size={16} />{warning}</div>}

        {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-32 custom-scrollbar relative">
        {activeFilter.type === 'duplicate' && groupedCharacters ? (
            <div className="px-2 space-y-8">
                {displayGroups.map(([name, chars]) => (
                    <div key={name} className="animate-fade-in">
                        {/* Group Header */}
                        <div className="flex items-center justify-between mb-4 pl-2 pr-4">
                            <div className="flex items-center">
                                <div className="w-1 h-6 bg-red-500 rounded-full mr-3 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
                                <h2 className={`text-lg font-bold ${textColor}`}>{name}</h2>
                                <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-xs font-bold rounded-full ml-3 border border-red-500/20">
                                    {chars.length} 张
                                </span>
                            </div>
                        </div>
                        {/* Group Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                            {chars.map(char => renderCharacterCard(char))}
                        </div>
                    </div>
                ))}
                {displayGroups.length === 0 && (
                    <div className={`text-center py-20 opacity-50 ${textColor}`}>没有发现重复角色</div>
                )}
            </div>
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 px-2">
                {displayCharacters.map((char) => renderCharacterCard(char))}
            </div>
        )}
      </div>
      
      {/* Unified Pagination */}
      {(activeFilter.type === 'duplicate' ? (groupedCharacters && groupedCharacters.length > 0) : filteredCharacters.length > 0) && (
          <div className={`absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl shadow-lg z-20 border ${theme === 'light' ? 'bg-white/[0.38] border-white/40' : 'bg-black/[0.38] border-white/10'}`}>
              <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold ${theme === 'light' ? 'text-slate-700' : 'text-gray-300'}`}>每页显示</span>
                  <select 
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className={`rounded-xl text-xs font-bold py-2 px-3 outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer shadow-sm transition-colors ${theme === 'light' ? 'bg-white/50 border border-white/50 hover:bg-white/70 text-slate-800' : 'bg-black/50 border border-white/10 text-white hover:bg-black/70'}`}
                  >
                      {[10, 20, 30, 50, 100, 500, 1000].map(size => (
                          <option key={size} value={size} className="bg-white text-black dark:bg-slate-800 dark:text-white">{size}</option>
                      ))}
                  </select>
              </div>
              <div className={`flex items-center gap-2 p-1 rounded-xl border ${theme === 'light' ? 'bg-white/40 border-white/50' : 'bg-black/40 border-white/10'}`}>
                  <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                      disabled={currentPage === 1} 
                      className={`p-2 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed ${theme === 'light' ? 'hover:bg-white/60 hover:shadow-sm text-slate-700' : 'hover:bg-white/20 text-gray-300'}`}
                  >
                      <ChevronLeft size={16} />
                  </button>
                  <span className={`text-xs font-black font-mono px-3 min-w-[100px] text-center ${theme === 'light' ? 'text-slate-800' : 'text-gray-200'}`}>
                      {currentPage} / {totalPages}
                  </span>
                  <button 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                      disabled={currentPage === totalPages} 
                      className={`p-2 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed ${theme === 'light' ? 'hover:bg-white/60 hover:shadow-sm text-slate-700' : 'hover:bg-white/20 text-gray-300'}`}
                  >
                      <ChevronRight size={16} />
                  </button>
              </div>
              <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${theme === 'light' ? 'text-slate-700' : 'text-gray-300'}`}>跳转至</span>
                  <input 
                      type="number" 
                      min={1} 
                      max={totalPages}
                      value={jumpPage}
                      onChange={(e) => setJumpPage(e.target.value)}
                      onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                              const page = parseInt(jumpPage);
                              if (page >= 1 && page <= totalPages) {
                                  setCurrentPage(page);
                                  setJumpPage('');
                              }
                          }
                      }}
                      className={`w-16 rounded-xl text-xs font-bold py-2 px-2 text-center outline-none focus:ring-2 focus:ring-rose-500/20 shadow-sm ${theme === 'light' ? 'bg-white/50 border border-white/50 text-slate-800' : 'bg-black/50 border border-white/10 text-white'}`}
                  />
                  <button 
                      onClick={() => {
                          const page = parseInt(jumpPage);
                          if (page >= 1 && page <= totalPages) {
                              setCurrentPage(page);
                              setJumpPage('');
                          }
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg ${theme === 'light' ? 'bg-white/60 text-slate-800 hover:bg-white/80 border border-white/50' : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'}`}
                  >
                      Go
                  </button>
              </div>
          </div>
      )}
      </div>
      {/* Import Error Modal */}
      <Modal
        isOpen={importErrorModalOpen}
        onClose={() => setImportErrorModalOpen(false)}
        title="导入结果"
        theme={theme}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
             <div className="flex items-center gap-1 text-green-500 font-bold">
                <Check size={16} /> 成功: {importResults?.success}
             </div>
             {importResults && importResults.failed > 0 && (
                 <div className="flex items-center gap-1 text-red-500 font-bold">
                    <AlertCircle size={16} /> 失败: {importResults?.failed}
                 </div>
             )}
             {importResults && (importResults as ImportResults).duplicateFiles.length > 0 && (
                 <div className="flex items-center gap-1 text-yellow-500 font-bold">
                    <AlertTriangle size={16} /> 重复: {(importResults as ImportResults).duplicateFiles.length}
                 </div>
             )}
          </div>
          
          {importResults && (importResults as ImportResults).invalidFormatFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2 text-sm uppercase tracking-wider opacity-70">非酒馆卡 (格式无效)</h4>
              <div className={`rounded-lg p-3 text-sm font-mono overflow-x-auto max-h-32 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-red-50 text-red-800' : 'bg-red-900/20 text-red-200'}`}>
                <ul className="list-disc list-inside space-y-1">
                  {(importResults as ImportResults).invalidFormatFiles.map((msg, idx) => (
                    <li key={idx} className="break-all">{msg}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {importResults && (importResults as ImportResults).duplicateFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2 text-sm uppercase tracking-wider opacity-70">重复文件 (已导入)</h4>
              <div className={`rounded-lg p-3 text-sm font-mono overflow-x-auto max-h-32 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-yellow-50 text-yellow-800' : 'bg-yellow-900/20 text-yellow-200'}`}>
                <ul className="list-disc list-inside space-y-1">
                  {(importResults as ImportResults).duplicateFiles.map((name, idx) => (
                    <li key={idx} className="break-all">{name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {importResults && (importResults as ImportResults).otherFailedFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2 text-sm uppercase tracking-wider opacity-70">其他错误</h4>
              <div className={`rounded-lg p-3 text-sm font-mono overflow-x-auto max-h-32 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-red-50 text-red-800' : 'bg-red-900/20 text-red-200'}`}>
                <ul className="list-disc list-inside space-y-1">
                  {(importResults as ImportResults).otherFailedFiles.map((msg, idx) => (
                    <li key={idx} className="break-all">{msg}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          
          <div className="flex justify-end mt-6">
            <Button onClick={() => setImportErrorModalOpen(false)} variant="primary">
              确认
            </Button>
          </div>
        </div>
      </Modal>

      {/* Compare Modal (Diff Check) */}
      {compareModalOpen && selectedIds.size === 2 && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
            <div className={`w-full max-w-6xl h-[90vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300 ${theme === 'light' ? 'bg-white' : 'bg-slate-900 text-slate-100 border border-white/10'}`}>
                <div className={`px-8 py-5 border-b flex justify-between items-center ${theme === 'light' ? 'border-gray-100 bg-gray-50' : 'border-white/10 bg-slate-800/50'}`}>
                    <span className="font-black text-lg flex items-center gap-3"><Scale className="text-rose-500" /> 档案深度对比 (Diff Check)</span>
                    <button onClick={() => setCompareModalOpen(false)} className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${theme === 'light' ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400'}`}><X /></button>
                </div>
                
                <div className={`flex-1 overflow-y-auto custom-scrollbar p-6 ${theme === 'light' ? 'bg-slate-50/50' : 'bg-slate-900/50'}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {(() => {
                            const compareIds = Array.from(selectedIds);
                            const char1 = characters.find(c => c.id === compareIds[0]);
                            const char2 = characters.find(c => c.id === compareIds[1]);

                            if (!char1 || !char2) return null;

                            return [char1, char2].map((char, index) => {
                                const otherChar = index === 0 ? char2 : char1;
                                const isLeft = index === 0;
                                
                                const descLength = char.description?.length || 0;
                                const otherDescLength = otherChar.description?.length || 0;
                                const isDescDiff = descLength !== otherDescLength;
                                const isDescGreater = descLength > otherDescLength;

                                const fmLength = char.firstMessage?.length || 0;
                                const otherFmLength = otherChar.firstMessage?.length || 0;
                                const isFmDiff = fmLength !== otherFmLength;
                                const isFmGreater = fmLength > otherFmLength;

                                const fmCount = 1 + (char.alternate_greetings?.length || 0);
                                
                                const wbCount = char.character_book?.entries?.length || 0;
                                const wbTotalChars = char.character_book?.entries?.reduce((sum, entry) => sum + (entry.content?.length || 0), 0) || 0;

                                return (
                                    <div key={char.id} className="flex flex-col gap-6">
                                        {/* 头部信息 */}
                                        <div className={`p-5 rounded-3xl border shadow-sm flex gap-5 items-start ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-white/10'}`}>
                                             <img src={char.avatarUrl} className={`w-20 h-20 rounded-xl object-cover border ${theme === 'light' ? 'bg-gray-100 border-gray-100' : 'bg-slate-700 border-white/10'}`} />
                                             <div className="flex-1 min-w-0">
                                                 <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Card {isLeft ? 'A (Keep Left)' : 'B (Keep Right)'}</div>
                                                 <div className="text-lg font-black truncate">{char.name}</div>
                                                 <div className="text-xs font-mono text-gray-400 truncate">{char.fileName || `${char.name}.png`}</div>
                                                 {char.qrList && char.qrList.length > 0 && (
                                                     <div className={`mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border w-fit ${theme === 'light' ? 'text-purple-600 bg-purple-50 border-purple-200' : 'text-purple-400 bg-purple-900/30 border-purple-800'}`}>
                                                         <Zap className="w-3 h-3" />
                                                         <span className="font-bold">有快速回复</span>
                                                     </div>
                                                 )}
                                                 <div className="mt-3 flex gap-2">
                                                     {!isLeft && otherChar.qrList && otherChar.qrList.length > 0 && (
                                                         <button onClick={() => {
                                                             if (window.confirm(`确定要从左侧卡片获取 QR 配置吗？这会覆盖当前卡的 QR。`)) {
                                                                 if (onUpdate) {
                                                                     onUpdate({
                                                                         ...char,
                                                                         qrList: otherChar.qrList,
                                                                         extra_qr_data: otherChar.extra_qr_data,
                                                                         qrFileName: otherChar.qrFileName
                                                                     });
                                                                     alert("QR 转移成功！");
                                                                 }
                                                             }
                                                         }} className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${theme === 'light' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300' : 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50 border-purple-800'}`} title="从左侧卡片转移快速回复">
                                                             <ArrowRight className="w-3.5 h-3.5" />
                                                         </button>
                                                     )}
                                                     <button onClick={() => {
                                                         if (window.confirm(`确定要保留此卡，并删除另一张卡吗？`)) {
                                                             onDelete(otherChar.id, true);
                                                             setCompareModalOpen(false);
                                                             setSelectedIds(new Set());
                                                         }
                                                     }} className={`flex-1 px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg ${theme === 'light' ? 'bg-slate-800 text-white hover:bg-rose-500 shadow-gray-200' : 'bg-slate-700 text-white hover:bg-rose-600 shadow-black/50'}`}>保留此版本</button>
                                                     {isLeft && otherChar.qrList && otherChar.qrList.length > 0 && (
                                                         <button onClick={() => {
                                                             if (window.confirm(`确定要从右侧卡片获取 QR 配置吗？这会覆盖当前卡的 QR。`)) {
                                                                 if (onUpdate) {
                                                                     onUpdate({
                                                                         ...char,
                                                                         qrList: otherChar.qrList,
                                                                         extra_qr_data: otherChar.extra_qr_data,
                                                                         qrFileName: otherChar.qrFileName
                                                                     });
                                                                     alert("QR 转移成功！");
                                                                 }
                                                             }
                                                         }} className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${theme === 'light' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300' : 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50 border-purple-800'}`} title="从右侧卡片转移快速回复">
                                                             <ArrowLeft className="w-3.5 h-3.5" />
                                                         </button>
                                                     )}
                                                 </div>
                                             </div>
                                        </div>

                                        {/* 统计对比：Description */}
                                        <div className={`p-5 rounded-3xl border shadow-sm ${isDescDiff ? (theme === 'light' ? 'ring-2 ring-rose-200 bg-rose-50/30' : 'ring-2 ring-rose-900 bg-rose-900/20') : (theme === 'light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-white/10')}`}>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Description 字数</span>
                                                <span className={`text-lg font-black font-mono ${isDescGreater ? 'text-green-600' : (theme === 'light' ? 'text-gray-700' : 'text-gray-300')}`}>
                                                    {descLength}
                                                </span>
                                            </div>
                                            <div className={`h-48 overflow-y-auto custom-scrollbar text-xs leading-relaxed font-mono p-3 rounded-xl border whitespace-pre-wrap ${theme === 'light' ? 'text-gray-600 bg-gray-50 border-gray-100' : 'text-gray-300 bg-slate-900/50 border-white/5'}`}>{char.description || ''}</div>
                                        </div>

                                        {/* 统计对比：First Message */}
                                        <div className={`p-5 rounded-3xl border shadow-sm ${isFmDiff ? (theme === 'light' ? 'ring-2 ring-rose-200 bg-rose-50/30' : 'ring-2 ring-rose-900 bg-rose-900/20') : (theme === 'light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-white/10')}`}>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">First Message 字数</span>
                                                <span className={`text-lg font-black font-mono ${isFmGreater ? 'text-green-600' : (theme === 'light' ? 'text-gray-700' : 'text-gray-300')}`}>
                                                    {fmLength}
                                                </span>
                                            </div>
                                            <div className={`h-48 overflow-y-auto custom-scrollbar text-xs leading-relaxed font-mono p-3 rounded-xl border whitespace-pre-wrap ${theme === 'light' ? 'text-gray-600 bg-gray-50 border-gray-100' : 'text-gray-300 bg-slate-900/50 border-white/5'}`}>{char.firstMessage || ''}</div>
                                        </div>

                                        {/* 开场白统计 */}
                                        <div className={`p-5 rounded-3xl border shadow-sm ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-white/10'}`}>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">开场白数量</span>
                                                <span className="text-lg font-black font-mono text-green-600">
                                                    {fmCount}
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className={`p-2 rounded-lg text-xs border ${isFmDiff ? (theme === 'light' ? 'ring-2 ring-rose-200 bg-rose-50/30 border-rose-100' : 'ring-2 ring-rose-900 bg-rose-900/20 border-rose-800') : (theme === 'light' ? 'bg-blue-50 border-blue-100' : 'bg-blue-900/20 border-blue-800')}`}>
                                                    <span className={`font-bold ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>主开场白:</span>
                                                    <span className={`ml-2 font-bold ${isFmGreater ? 'text-blue-600' : (theme === 'light' ? 'text-gray-600' : 'text-gray-400')}`}>{fmLength} 字符</span>
                                                </div>
                                                {char.alternate_greetings && char.alternate_greetings.length > 0 && (
                                                    <div className="space-y-1">
                                                        {char.alternate_greetings.map((alt, idx) => {
                                                            const altLength = alt?.length || 0;
                                                            const otherAltLength = otherChar.alternate_greetings?.[idx]?.length || 0;
                                                            const isAltDiff = altLength !== otherAltLength;
                                                            const isAltGreater = altLength > otherAltLength;
                                                            return (
                                                                <div key={idx} className={`p-2 rounded-lg text-xs flex justify-between border ${isAltDiff ? (theme === 'light' ? 'ring-2 ring-rose-200 bg-rose-50/30 border-rose-100' : 'ring-2 ring-rose-900 bg-rose-900/20 border-rose-800') : (theme === 'light' ? 'bg-gray-50 border-gray-100' : 'bg-slate-900/50 border-white/5')}`}>
                                                                    <span className={theme === 'light' ? 'text-gray-700' : 'text-gray-300'}>备用 #{idx+1}:</span>
                                                                    <span className={`font-bold ${isAltGreater ? 'text-blue-600' : (theme === 'light' ? 'text-gray-600' : 'text-gray-400')}`}>{altLength} 字符</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 世界书统计 */}
                                        <div className={`p-5 rounded-3xl border shadow-sm ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-white/10'}`}>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">世界书 (Lorebook)</span>
                                                <span className="text-lg font-black font-mono text-purple-600">
                                                    {wbCount} 条
                                                </span>
                                            </div>
                                            <div className={`p-3 rounded-lg ${theme === 'light' ? 'bg-purple-50' : 'bg-purple-900/20'}`}>
                                                <div className={`text-xs mb-1 ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>总字符数:</div>
                                                <div className={`text-2xl font-black ${theme === 'light' ? 'text-purple-700' : 'text-purple-400'}`}>{wbTotalChars.toLocaleString()}</div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* View Character Modal */}
      {viewCharacter && (
          <Modal
            isOpen={!!viewCharacter}
            onClose={() => setViewCharacter(null)}
            title={viewCharacter.name}
            theme={theme}
            maxWidth="max-w-2xl"
            headerActions={
              <button 
                onClick={() => {
                  if (window.confirm(`确定删除 ${viewCharacter.name} 吗?`)) {
                    onDelete(viewCharacter.id, true);
                    setViewCharacter(null);
                  }
                }}
                className={`p-1 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-red-100 text-red-500' : 'hover:bg-red-500/20 text-red-400'}`}
                title="删除角色"
              >
                <Trash2 size={20} />
              </button>
            }
          >
            <div className="flex flex-col gap-6">
                <div className="flex gap-6">
                    <img 
                        src={viewCharacter.avatarUrl} 
                        alt={viewCharacter.name} 
                        className="w-32 h-48 object-cover rounded-xl shadow-lg shrink-0 bg-gray-900" 
                    />
                    <div className="flex-1 space-y-3 min-w-0">
                        <div className="flex flex-wrap gap-2">
                            {viewCharacter.tags?.map(tag => (
                                <span key={tag} className={`px-2 py-1 rounded-md text-xs font-bold ${theme === 'light' ? 'bg-blue-100 text-blue-600' : 'bg-blue-500/20 text-blue-300'}`}>
                                    # {tag}
                                </span>
                            ))}
                        </div>
                        
                        <div className={`text-sm ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                            <div className="flex items-center gap-2 mb-1">
                                <FileText size={14} />
                                <span className="truncate" title={viewCharacter.originalFilename}>{viewCharacter.originalFilename || "local_card.png"}</span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="opacity-70">导入时间:</span>
                                <span>{new Date(viewCharacter.importDate || 0).toLocaleString()}</span>
                            </div>
                            {viewCharacter.fileLastModified && (
                                <div className="flex items-center gap-2">
                                    <span className="opacity-70">本地修改:</span>
                                    <span>{new Date(viewCharacter.fileLastModified).toLocaleString()}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 mt-auto pt-2">
                             <Button 
                                variant="primary"
                                onClick={() => {
                                    onSelect(viewCharacter);
                                    setViewCharacter(null);
                                }}
                                className="flex-1"
                             >
                                <Pencil size={14} className="mr-2" /> 编辑
                             </Button>
                             <Button 
                                variant="secondary"
                                onClick={() => handleSingleExport(viewCharacter, 'png')}
                                title="导出 PNG"
                             >
                                <Download size={14} /> PNG
                             </Button>
                             <Button 
                                variant="secondary"
                                onClick={() => handleSingleExport(viewCharacter, 'json')}
                                title="导出 JSON"
                             >
                                <FileJson size={14} /> JSON
                             </Button>
                        </div>
                    </div>
                </div>

                <div className={`space-y-4 p-4 rounded-xl max-h-[400px] overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
                    {viewCharacter.description && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider">描述 (Description)</h4>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{viewCharacter.description}</p>
                        </div>
                    )}
                    
                    {viewCharacter.firstMessage && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider">首发消息 (First Message)</h4>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{viewCharacter.firstMessage}</p>
                        </div>
                    )}
                    
                    {viewCharacter.personality && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider">性格 (Personality)</h4>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{viewCharacter.personality}</p>
                        </div>
                    )}
                    
                    {viewCharacter.scenario && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider">场景 (Scenario)</h4>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{viewCharacter.scenario}</p>
                        </div>
                    )}
                    
                    {viewCharacter.character_book?.entries && viewCharacter.character_book.entries.length > 0 && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider flex items-center gap-2">
                                <BookOpen size={14} /> 世界书 (World Info) - {viewCharacter.character_book.entries.length} 条
                            </h4>
                            <div className="space-y-2">
                                {viewCharacter.character_book.entries.map((entry, idx) => (
                                    <div key={idx} className={`p-3 rounded-lg border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-black/20 border-white/10'}`}>
                                        {entry.name && (
                                            <div className="font-bold text-sm mb-1 opacity-90">{entry.name}</div>
                                        )}
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {entry.keys.map((key, i) => (
                                                <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${theme === 'light' ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/20 text-indigo-300'}`}>
                                                    {key}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{entry.content}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
          </Modal>
      )}
    </div>
  );
};

export default CharacterList;
