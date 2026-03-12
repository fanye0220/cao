import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Character, Theme } from '../types';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Pencil, Trash2, Upload, AlertCircle, Download, FileText, AlertTriangle, CheckSquare, Square, Filter, ChevronLeft, ChevronRight, ChevronDown, FolderInput, Book, MessageSquare, MoreVertical, FileJson, Image as ImageIcon, Check, Heart, Star, List, Tag, Menu, X, Plus, Copy, Folder, FolderPlus, GitCompare, Maximize, Search } from 'lucide-react';
import { parseCharacterCard, parseCharacterJson, exportCharacterData, exportBulkCharacters } from '../services/cardImportService';

// Removed invalid module augmentation. We will cast props if needed or ignore the error for now as it's just for directory upload.
// If needed, we can use a custom input component or just ignore the TS error on the input element locally.

interface CharacterListProps {
  characters: Character[];
  onSelect: (char: Character) => void;
  onDelete: (id: string) => void;
  onDeleteBatch?: (ids: string[]) => void;
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
  failedCards: string[];   // 角色卡解析失败（文件名）
  failedQr: string[];      // 误传QR文件（文件名）
  failedJpeg: string[];    // JPEG/非PNG图片（文件名）
  duplicates: string[];    // 重复角色名
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

  const totalPages = activeFilter.type === 'duplicate' 
    ? Math.ceil((groupedCharacters?.length || 0) / itemsPerPage)
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
    const failedCards: string[] = [];
    const failedQr: string[] = [];
    const failedJpeg: string[] = [];
    const duplicates: string[] = [];
    const fileArray = Array.from(files) as File[];
    const validChars: Character[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];

      // Yield to main thread every few items to keep UI responsive
      if (i % 5 === 0) {
          setImportingCount(fileArray.length - i);
          await new Promise(resolve => setTimeout(resolve, 0));
      }

      const nameLower = file.name.toLowerCase();
      const isPng = nameLower.endsWith('.png');
      const isJson = nameLower.endsWith('.json');
      
      if (!isPng && !isJson) {
          continue; 
      }

      try {
        // PNG：先读 magic bytes 判断是否真的是 PNG（排除 JPEG 等被改名的文件）
        if (isPng) {
            const header = await file.slice(0, 8).arrayBuffer();
            const bytes = new Uint8Array(header);
            const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
            const isRealPng = PNG_SIG.every((b, i) => bytes[i] === b);
            if (!isRealPng) {
                failCount++;
                failedJpeg.push(file.name);
                continue;
            }
        }

        // JSON：先读内容，区分是角色卡还是 QR 配置
        if (isJson) {
            const text = await file.text();
            let jsonData: any;
            try { jsonData = JSON.parse(text); } catch {
                failCount++;
                failedCards.push(file.name);
                continue;
            }
            // 判断是否是 QR 文件（有 qrList/quickReplySlots 但没有角色卡特征）
            // 对应 HTML 版：raw.qrList || raw.quickReplySlots || (raw.data && ...)
            const isQrFile = (
                Array.isArray(jsonData?.qrList) || 
                Array.isArray(jsonData?.quickReplySlots) ||
                Array.isArray(jsonData?.data?.qrList) ||
                Array.isArray(jsonData?.data?.quickReplySlots)
            ) && 
                !jsonData?.spec?.startsWith('chara_card') &&
                jsonData?.first_mes === undefined &&
                jsonData?.data?.first_mes === undefined;
            if (isQrFile) {
                // HTML 版会将 QR 文件加入全局 QR 池；
                // 此版本架构不同（QR 内嵌到角色），静默跳过，不算导入失败
                continue;
            }
        }

        let char: Character;
        if (isPng) {
            char = await parseCharacterCard(file);
        } else {
            char = await parseCharacterJson(file);
        }

        const isDuplicateName = characters.some(c => c.name === char.name);
        if (isDuplicateName) {
            duplicates.push(char.name);
             if (files.length === 1) {
                setWarning(`注意：检测到可能重复的角色 "${char.name}"`);
             }
        }
        
        validChars.push(char);
        successCount++;
      } catch (err: any) {
        console.error(`Failed to import ${file.name}:`, err);
        failCount++;
        failedCards.push(file.name);
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
    if (failCount > 0 || (duplicates.length > 0 && files.length > 1)) {
        setImportResults({ success: successCount, failed: failCount, failedCards, failedQr, failedJpeg, duplicates });
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
                     onClick={() => {if(window.confirm(`确定删除这 ${selectedIds.size} 张卡片吗?`)) { onDeleteBatch?.(Array.from(selectedIds)); setSelectedIds(new Set()); }}} 
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
      <div className="flex-1 overflow-y-auto min-h-0 pb-20 custom-scrollbar">
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

      {/* Pagination - Fixed at Bottom */}
      {totalPages > 1 && (
            <div className={`absolute bottom-0 left-0 right-0 z-10 flex justify-between items-center gap-4 px-4 py-3 border-t backdrop-blur-md ${theme === 'light' ? 'bg-white/[0.37] border-slate-200' : 'bg-[#1a1b1e]/[0.37] border-white/10'}`}>
                {/* Left: Items Per Page */}
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>每页显示</span>
                    <div className="relative">
                        <select 
                            value={itemsPerPage}
                            onChange={(e) => setItemsPerPage(Number(e.target.value))}
                            className={`appearance-none pl-3 pr-8 py-1.5 rounded-lg text-xs font-bold outline-none cursor-pointer transition-colors ${theme === 'light' ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                        >
                            {[20, 30, 50, 100, 250, 500, 1000].map(size => (
                                <option key={size} value={size} className="text-black">{size}</option>
                            ))}
                        </select>
                        <ChevronDown size={12} className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${theme === 'light' ? 'text-slate-500' : 'text-white/50'}`} />
                    </div>
                </div>

                {/* Center: Navigation */}
                <div className={`flex items-center gap-4 px-4 py-1.5 rounded-xl ${theme === 'light' ? 'bg-slate-50' : 'bg-white/5'}`}>
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                        disabled={currentPage === 1} 
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-white/10 text-gray-300'}`}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className={`text-xs font-bold font-mono ${theme === 'light' ? 'text-slate-700' : 'text-gray-200'}`}>
                        {currentPage} / {totalPages}
                    </span>
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                        disabled={currentPage === totalPages} 
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-white/10 text-gray-300'}`}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Right: Jump To */}
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>跳转至</span>
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
                        className={`w-12 px-2 py-1.5 text-center text-xs font-bold rounded-lg outline-none transition-all ${theme === 'light' ? 'bg-white border border-slate-200 focus:border-blue-500 text-slate-700' : 'bg-black/20 border border-white/10 focus:border-blue-500/50 text-white'}`}
                    />
                    <button 
                        onClick={() => {
                            const page = parseInt(jumpPage);
                            if (page >= 1 && page <= totalPages) {
                                setCurrentPage(page);
                                setJumpPage('');
                            }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors ${theme === 'light' ? 'bg-slate-800 hover:bg-slate-900' : 'bg-white/10 hover:bg-white/20'}`}
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
        {importResults && (
          <div className="space-y-3">
            {/* 统计行 */}
            <div className={`flex items-center gap-3 text-xs font-bold pb-3 border-b ${theme === 'light' ? 'border-slate-100' : 'border-white/10'}`}>
              {importResults.success > 0 && (
                <span className="flex items-center gap-1 text-green-500">
                  <Check size={13}/> 成功 {importResults.success}
                </span>
              )}
              {importResults.failed > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertCircle size={13}/> 失败 {importResults.failed}
                </span>
              )}
              {importResults.duplicates.length > 0 && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <AlertTriangle size={13}/> 重复 {importResults.duplicates.length}
                </span>
              )}
            </div>

            {/* 角色卡解析失败 */}
            {importResults.failedCards.length > 0 && (
              <div>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5 ${theme === 'light' ? 'text-red-400' : 'text-red-400'}`}>
                  <AlertCircle size={11}/> 角色卡解析失败
                </div>
                <div className={`rounded-xl p-2.5 space-y-1 max-h-36 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-red-50' : 'bg-red-500/10'}`}>
                  {importResults.failedCards.map((name, i) => (
                    <div key={i} className={`text-xs font-mono truncate px-1 ${theme === 'light' ? 'text-red-700' : 'text-red-300'}`}>{name}</div>
                  ))}
                </div>
              </div>
            )}

            {/* QR配置文件 */}
            {importResults.failedQr.length > 0 && (
              <div>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5 ${theme === 'light' ? 'text-purple-400' : 'text-purple-400'}`}>
                  <AlertTriangle size={11}/> QR 配置文件（请在角色编辑页绑定）
                </div>
                <div className={`rounded-xl p-2.5 space-y-1 max-h-36 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-purple-50' : 'bg-purple-500/10'}`}>
                  {importResults.failedQr.map((name, i) => (
                    <div key={i} className={`text-xs font-mono truncate px-1 ${theme === 'light' ? 'text-purple-700' : 'text-purple-300'}`}>{name}</div>
                  ))}
                </div>
              </div>
            )}

            {/* JPEG/非PNG图片 */}
            {importResults.failedJpeg.length > 0 && (
              <div>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5 ${theme === 'light' ? 'text-orange-400' : 'text-orange-400'}`}>
                  <AlertTriangle size={11}/> 非角色卡图片（JPEG 等）
                </div>
                <div className={`rounded-xl p-2.5 space-y-1 max-h-36 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-orange-50' : 'bg-orange-500/10'}`}>
                  {importResults.failedJpeg.map((name, i) => (
                    <div key={i} className={`text-xs font-mono truncate px-1 ${theme === 'light' ? 'text-orange-700' : 'text-orange-300'}`}>{name}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 重复角色 */}
            {importResults.duplicates.length > 0 && (
              <div>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5 ${theme === 'light' ? 'text-yellow-500' : 'text-yellow-400'}`}>
                  <Copy size={11}/> 重复角色（已导入）
                </div>
                <div className={`rounded-xl p-2.5 space-y-1 max-h-36 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-yellow-50' : 'bg-yellow-500/10'}`}>
                  {importResults.duplicates.map((name, i) => (
                    <div key={i} className={`text-xs font-mono truncate px-1 ${theme === 'light' ? 'text-yellow-700' : 'text-yellow-300'}`}>{name}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setImportErrorModalOpen(false)} variant="primary">确认</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Compare Modal */}
      {compareModalOpen && selectedIds.size === 2 && (() => {
          const [idA, idB] = Array.from(selectedIds);
          const charA = characters.find(c => c.id === idA);
          const charB = characters.find(c => c.id === idB);
          if (!charA || !charB) return null;

          const getFirstMesCount = (char: Character) => 1 + (char.alternate_greetings?.length || 0);
          const getWICount = (char: Character) => char.character_book?.entries?.length || 0;
          const getWIChars = (char: Character) => (char.character_book?.entries || []).reduce((sum, e) => sum + (e.content?.length || 0), 0);

          const diffClass = (lenA: number, lenB: number, isA: boolean) => {
              if (lenA === lenB) return theme === 'light' ? 'text-gray-700' : 'text-gray-300';
              if (isA) return lenA > lenB ? 'text-green-500' : 'text-gray-500';
              return lenB > lenA ? 'text-green-500' : 'text-gray-500';
          };
          const ringClass = (lenA: number, lenB: number) =>
              lenA !== lenB ? (theme === 'light' ? 'ring-2 ring-rose-200 bg-rose-50/30' : 'ring-2 ring-rose-500/30 bg-rose-900/10') : '';

          const renderCardCol = (char: Character, other: Character, label: string) => (
              <div className="flex flex-col gap-4">
                  {/* Header */}
                  <div className={`p-4 rounded-2xl border flex gap-4 items-start ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'}`}>
                      <img src={char.avatarUrl} alt={char.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                          <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>{label}</div>
                          <div className={`text-base font-black truncate ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>{char.name}</div>
                          <div className={`text-xs font-mono truncate opacity-60`}>{char.originalFilename || 'unknown'}</div>
                          {char.qrList && char.qrList.length > 0 && (
                              <div className={`mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ${theme === 'light' ? 'bg-purple-50 text-purple-600 border border-purple-200' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'}`}>
                                  ⚡ 有快速回复 ({char.qrList.length})
                              </div>
                          )}
                          <div className="mt-3 flex gap-2">
                              {other.qrList && other.qrList.length > 0 && (
                                  <Button
                                      variant="secondary"
                                      onClick={() => {
                                          if (window.confirm(`确定将「${other.name}」的 ${other.qrList!.length} 个快速回复转移到「${char.name}」吗?`)) {
                                              onUpdate?.({ ...char, qrList: other.qrList, extra_qr_data: (other as any).extra_qr_data });
                                          }
                                      }}
                                      className="!py-1.5 !px-3 !text-xs !rounded-lg"
                                      title={`从「${other.name}」转移快速回复`}
                                  >
                                      ⚡ ← QR
                                  </Button>
                              )}
                              <Button
                                  variant="danger"
                                  onClick={() => {
                                      if (window.confirm(`确定保留「${char.name}」并删除另一张吗?`)) {
                                          const otherId = other.id;
                                          onDelete(otherId);
                                          setCompareModalOpen(false);
                                          setSelectedIds(new Set());
                                      }
                                  }}
                                  className="!py-1.5 !px-3 !text-xs !rounded-lg flex-1"
                              >
                                  保留此版本
                              </Button>
                          </div>
                      </div>
                  </div>

                  {/* Description */}
                  <div className={`p-4 rounded-2xl border ${ringClass((char.description||'').length, (other.description||'').length)} ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>Description 字数</span>
                          <span className={`text-xl font-black font-mono ${diffClass((char.description||'').length, (other.description||'').length, char === charA)}`}>
                              {(char.description||'').length}
                          </span>
                      </div>
                      <div className={`h-36 overflow-y-auto custom-scrollbar text-xs leading-relaxed font-mono p-2.5 rounded-xl whitespace-pre-wrap ${theme === 'light' ? 'bg-gray-50 text-gray-600 border border-gray-100' : 'bg-black/20 text-gray-400'}`}>
                          {char.description || '(无)'}
                      </div>
                  </div>

                  {/* First Message */}
                  <div className={`p-4 rounded-2xl border ${ringClass((char.firstMessage||'').length, (other.firstMessage||'').length)} ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>First Message 字数</span>
                          <span className={`text-xl font-black font-mono ${diffClass((char.firstMessage||'').length, (other.firstMessage||'').length, char === charA)}`}>
                              {(char.firstMessage||'').length}
                          </span>
                      </div>
                      <div className={`h-36 overflow-y-auto custom-scrollbar text-xs leading-relaxed font-mono p-2.5 rounded-xl whitespace-pre-wrap ${theme === 'light' ? 'bg-gray-50 text-gray-600 border border-gray-100' : 'bg-black/20 text-gray-400'}`}>
                          {char.firstMessage || '(无)'}
                      </div>
                  </div>

                  {/* Greetings Count */}
                  <div className={`p-4 rounded-2xl border ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>开场白数量</span>
                          <span className="text-xl font-black font-mono text-green-500">{getFirstMesCount(char)}</span>
                      </div>
                      <div className="space-y-1.5">
                          <div className={`p-2 rounded-lg text-xs flex justify-between ${ringClass((char.firstMessage||'').length, (other.firstMessage||'').length)} ${theme === 'light' ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
                              <span className={theme === 'light' ? 'font-bold text-gray-700' : 'font-bold text-gray-300'}>主开场白:</span>
                              <span className={`font-bold ${diffClass((char.firstMessage||'').length, (other.firstMessage||'').length, char === charA)}`}>{(char.firstMessage||'').length} 字符</span>
                          </div>
                          {(char.alternate_greetings||[]).map((alt, idx) => (
                              <div key={idx} className={`p-2 rounded-lg text-xs flex justify-between ${ringClass((alt||'').length, ((other.alternate_greetings||[])[idx]||'').length)} ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
                                  <span className="opacity-70">备用 #{idx+1}:</span>
                                  <span className={`font-bold ${diffClass((alt||'').length, ((other.alternate_greetings||[])[idx]||'').length, char === charA)}`}>{(alt||'').length} 字符</span>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* World Info */}
                  <div className={`p-4 rounded-2xl border ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'}`}>世界书 (Lorebook)</span>
                          <span className="text-xl font-black font-mono text-purple-500">{getWICount(char)} 条</span>
                      </div>
                      <div className={`p-3 rounded-xl ${theme === 'light' ? 'bg-purple-50' : 'bg-purple-500/10'}`}>
                          <div className={`text-xs mb-1 ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>总字符数:</div>
                          <div className="text-2xl font-black text-purple-500">{getWIChars(char).toLocaleString()}</div>
                      </div>
                  </div>
              </div>
          );

          return (
              <Modal
                isOpen={compareModalOpen}
                onClose={() => setCompareModalOpen(false)}
                title="档案深度对比 (Diff Check)"
                theme={theme}
                maxWidth="max-w-5xl"
              >
                <div className="grid grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
                    {renderCardCol(charA, charB, 'Card A (Keep Left)')}
                    {renderCardCol(charB, charA, 'Card B (Keep Right)')}
                </div>
                <div className="flex justify-end mt-4">
                    <Button onClick={() => setCompareModalOpen(false)} variant="primary">关闭</Button>
                </div>
              </Modal>
          );
      })()}

      {/* View Character Modal */}
      {viewCharacter && (
          <Modal
            isOpen={!!viewCharacter}
            onClose={() => setViewCharacter(null)}
            title={viewCharacter.name}
            theme={theme}
            maxWidth="max-w-2xl"
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
                            {(viewCharacter as any).fileLastModified && (
                                <div className={`flex items-center gap-2 ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                                    <span className="opacity-70">文件修改:</span>
                                    <span>{new Date((viewCharacter as any).fileLastModified).toLocaleString()}</span>
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
                                <Pencil size={14} className="mr-2" /> 编辑 / 聊天
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
                    {viewCharacter.creator_notes && (
                        <div>
                            <h4 className="font-bold opacity-70 mb-2 text-xs uppercase tracking-wider flex items-center gap-1.5">
                                <span>👤</span> 作者备注 (Creator Notes)
                            </h4>
                            <div className={`p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap opacity-80 ${theme === 'light' ? 'bg-white border border-gray-100 text-gray-700' : 'bg-black/20 text-gray-300'}`}>
                                {viewCharacter.creator_notes}
                            </div>
                        </div>
                    )}
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
                </div>
            </div>
          </Modal>
      )}
    </div>
  );
};

export default CharacterList;
