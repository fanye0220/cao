import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Character, Theme } from '../types';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Pencil, Trash2, Upload, AlertCircle, Download, FileText, AlertTriangle, CheckSquare, Square, Filter, ChevronLeft, ChevronRight, ChevronDown, FolderInput, Book, MessageSquare, MoreVertical, FileJson, Image as ImageIcon, Check, Heart, Star, List, Tag, Menu, X, Plus, Copy, Folder, FolderPlus, GitCompare, Maximize, Search, BookOpen, QrCode, Scale, ArrowLeft, ArrowRight, Zap, Sparkles, Dices, RefreshCw } from 'lucide-react';
import { parseCharacterCard, parseCharacterJson, exportCharacterData, exportBulkCharacters } from '../services/cardImportService';
import { ApiConfigModal } from './ApiConfigModal';
import { recommendCharacters, autoTagCharacter, autoTagCharactersBatch } from '../services/aiService';
import { TarotCardDraw } from './TarotCardDraw';
import { loadImage } from '../services/imageService';

// Removed invalid module augmentation. We will cast props if needed or ignore the error for now as it's just for directory upload.
// If needed, we can use a custom input component or just ignore the TS error on the input element locally.

// Global cache for avatar blob URLs to prevent rapid create/revoke cycles causing load failures
const avatarUrlCache = new Map<string, string>();

// Async lazy loading avatar component
const AsyncAvatar: React.FC<{ charId: string; initialUrl?: string; alt: string; className?: string }> = ({ charId, initialUrl, alt, className }) => {
    // We prioritize memory cache, then initialUrl, then undefined
    const [url, setUrl] = useState<string | undefined>(
        avatarUrlCache.get(charId) || (initialUrl?.startsWith('blob:') ? initialUrl : undefined)
    );

    useEffect(() => {
        // If we have an initial blob URL and it differs from cache, update cache
        if (initialUrl && initialUrl.startsWith('blob:') && avatarUrlCache.get(charId) !== initialUrl) {
             const oldUrl = avatarUrlCache.get(charId);
             if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
             
             avatarUrlCache.set(charId, initialUrl);
             if (url !== initialUrl) setUrl(initialUrl);
             return;
        }

        // If it's already loaded and in cache (and state), we're good.
        if (url && url.startsWith('blob:')) {
             if (avatarUrlCache.has(charId) && avatarUrlCache.get(charId) !== url) {
                 // cache changed (e.g. from an edit), update local
                 setUrl(avatarUrlCache.get(charId));
             }
             return;
        }

        // Otherwise load from IDB
        let mounted = true;
        
        loadImage(charId).then(blob => {
            if (!mounted) return;
            if (blob) {
                const objectUrl = URL.createObjectURL(blob);
                avatarUrlCache.set(charId, objectUrl);
                setUrl(objectUrl);
            }
        }).catch(err => {
            console.error("Failed to lazy load image for", charId, err);
        });

        // We DO NOT revoke the blob URL here anymore to prevent race conditions 
        // and browser blob-revocation limits. The browser will clean them up 
        // when the document unloads. Or we can explicitly clean them only on edit.
        return () => {
            mounted = false;
        };
    }, [charId, initialUrl, url]);

    return (
        <img 
            src={url || `https://picsum.photos/seed/${charId}/400/400`} 
            alt={alt} 
            className={className}
            loading="lazy" 
            onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (!target.src.includes('picsum.photos')) {
                    target.src = `https://picsum.photos/seed/${charId}/400/400`;
                }
            }}
        />
    );
};

interface CharacterListProps {
  characters: Character[];
  onSelect: (char: Character) => void;
  onDelete: (id: string, skipConfirm?: boolean) => void;
  onDeleteBatch?: (ids: string[], skipConfirm?: boolean) => void;
  onImport: (char: Character) => void;
  onImportBatch?: (chars: Character[]) => void;
  onUpdate?: (char: Character) => void; // Add onUpdate prop
  onUpdateBatch?: (chars: Character[]) => void;
  theme: Theme;
  folders?: string[]; // Optional for now as it seems unused in this version
  onCreateFolder?: (name: string) => void;
  onCreateFolders?: (names: string[]) => void;
  onDeleteFolder?: (name: string) => void;
  onRenameFolder?: (oldName: string, newName: string) => void;
  onReorderFolders?: (draggedFolder: string, targetFolder: string, position: 'before' | 'after') => void;
  isActive?: boolean;
}

interface ImportResults {
  success: number;
  failed: number;
  invalidFormatFiles: string[];
  duplicateFiles: string[];
  otherFailedFiles: string[];
  qrFiles: string[];
}

const CharacterList: React.FC<CharacterListProps> = ({ 
  characters, 
  onSelect, 
  onDelete,
  onDeleteBatch,
  onImport,
  onImportBatch,
  onUpdate,
  onUpdateBatch,
  theme,
  folders = [],
  onCreateFolder,
  onCreateFolders,
  onDeleteFolder,
  onRenameFolder,
  onReorderFolders,
  isActive = true
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('glass_tavern_sidebar_open') || 'true'); } catch { return true; }
  });
  const [isTagsExpanded, setIsTagsExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem('glass_tavern_tags_expanded') || 'true'); } catch { return true; }
  });
  const [isCollectionsExpanded, setIsCollectionsExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem('glass_tavern_collections_expanded') || 'true'); } catch { return true; }
  });
  const [activeFilter, setActiveFilter] = useState<{ type: 'all' | 'favorite' | 'tag' | 'duplicate' | 'collection', value?: string }>(() => {
    try { return JSON.parse(localStorage.getItem('glass_tavern_active_filter') || '{"type":"all"}'); } catch { return { type: 'all' }; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Resizable Sidebar State
  const [collectionsHeight, setCollectionsHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('glass_tavern_collections_height') || '180', 10); } catch { return 180; }
  });
  const [tagsHeight, setTagsHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('glass_tavern_tags_height') || '180', 10); } catch { return 180; }
  });
  const [resizingTarget, setResizingTarget] = useState<'collections' | 'tags' | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('glass_tavern_sidebar_open', JSON.stringify(isSidebarOpen));
      localStorage.setItem('glass_tavern_tags_expanded', JSON.stringify(isTagsExpanded));
      localStorage.setItem('glass_tavern_collections_expanded', JSON.stringify(isCollectionsExpanded));
      localStorage.setItem('glass_tavern_active_filter', JSON.stringify(activeFilter));
      localStorage.setItem('glass_tavern_collections_height', collectionsHeight.toString());
      localStorage.setItem('glass_tavern_tags_height', tagsHeight.toString());
    } catch (e) {
      console.error("Failed to save UI state", e);
    }
  }, [isSidebarOpen, isTagsExpanded, isCollectionsExpanded, activeFilter, collectionsHeight, tagsHeight]);

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
  const [sortOption, setSortOption] = useState<'updated-desc' | 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>(() => {
    try {
      const saved = localStorage.getItem('glass_tavern_sort_option');
      return (saved as any) || 'updated-desc';
    } catch {
      return 'updated-desc';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('glass_tavern_sort_option', sortOption);
    } catch (e) {
      console.error("Failed to save sort option", e);
    }
  }, [sortOption]);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [viewCharacter, setViewCharacter] = useState<Character | null>(null);
  
  // Tag & Collection Management
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [customTags, setCustomTags] = useState<string[]>([]); // "Card Tags"
  const [showTagFilterModal, setShowTagFilterModal] = useState(false);
  const [tagFilterMode, setTagFilterMode] = useState<'view' | 'edit'>('view');

  const [tagSearchQuery, setTagSearchQuery] = useState('');

  // AI Features State
  const [showAIRecommendModal, setShowAIRecommendModal] = useState(false);
  const [showAutoTagModal, setShowAutoTagModal] = useState(false);
  const [showApiConfigModal, setShowApiConfigModal] = useState(false);
  const [autoTagTab, setAutoTagTab] = useState<'untagged' | 'tagged'>('untagged');
  const [autoTagBatchSize, setAutoTagBatchSize] = useState<number | 'all'>(10);
  const [aiRecommendQuery, setAiRecommendQuery] = useState('');
  const [aiRecommendLoading, setAiRecommendLoading] = useState(false);
  const [aiLogs, setAiLogs] = useState<{time: string, text: string}[]>([]);
  const [showAutoTagLogs, setShowAutoTagLogs] = useState(true);
  const [drawingCards, setDrawingCards] = useState<any[]>([]);
  const [aiRecommendResults, setAiRecommendResults] = useState<{char: any, reason: string}[] | null>(null);
  const [hideAiRecommendWidget, setHideAiRecommendWidget] = useState(false);

  const handleAIRecommend = async () => {
    if (!aiRecommendQuery.trim()) return;
    setAiRecommendLoading(true);
    setAiLogs([]);
    setAiRecommendResults(null);
    setHideAiRecommendWidget(false);
    
    const addLog = (text: string) => {
      const now = new Date();
      const time = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
      setAiLogs(prev => [...prev, { time, text }]);
    };

    try {
      addLog("开始分析您的需求...");
      await new Promise(resolve => setTimeout(resolve, 600));
      addLog(`已加载本地角色库，共 ${characters.length} 个角色...`);
      if (characters.length > 100) {
        addLog(`(因角色库记录较多，AI 将优先分析前 100 个档案以保证质量)`);
      }
      await new Promise(resolve => setTimeout(resolve, 800));
      addLog("正在向 AI 发起语义理解与智能搜索...");
      
      const response = await recommendCharacters(characters, aiRecommendQuery, addLog);
      
      if (response.keywords && response.keywords.length > 0) {
        addLog(`AI 识别关键词: [${response.keywords.join(', ')}]`);
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      
      const results = response.results || [];
      if (results.length > 0) {
        addLog(`AI 已完成深度筛选评估，并找到 ${results.length} 个高度匹配的档案...`);
      } else {
        addLog(`AI 遍历了档案库，但未发现高度契合该需求的角色卡。建议微调语焉或补充人设细节。`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 600));
      addLog("正在解析推荐理由与最终结果...");
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const recommendedCharacters = characters
        .filter(c => results.some(r => r.id === c.id))
        .map(c => {
            const reason = results.find(r => r.id === c.id)?.reason;
            return { char: c, reason: reason || '' };
        });

      setAiRecommendResults(recommendedCharacters);
      setAiRecommendLoading(false);
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || "未知错误";
      addLog(`❌ AI 引擎报错: ${errorMessage}`);
      alert(`AI 推荐执行失败: ${errorMessage}\n请检查您的 API 配置是否正确。`);
      setAiRecommendLoading(false);
    }
  };

  type AutoTagQueueItem = {
    char: Character;
    status: 'pending' | 'processing' | 'review' | 'success' | 'fail';
    generatedTags?: string[];
    error?: string;
    retries: number;
    isRetag: boolean;
  };

  const autoTagStateRef = useRef<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const [autoTagState, setAutoTagState] = useState<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const autoTagQueueRef = useRef<AutoTagQueueItem[]>([]);
  const [autoTagQueue, setAutoTagQueue] = useState<AutoTagQueueItem[]>([]);
  const [autoTagProgress, setAutoTagProgress] = useState({total: 0, current: 0, success: 0, fail: 0});
  
  const processAutoTagQueue = async () => {
    while (autoTagStateRef.current === 'running') {
      const queue = autoTagQueueRef.current;
      const pendingItems = queue.map((q, idx) => ({q, idx})).filter(({q}) => q.status === 'pending');
      const retryItems = queue.map((q, idx) => ({q, idx})).filter(({q}) => q.status === 'fail' && q.retries < 5);
      
      const pendingIndices = [...pendingItems, ...retryItems]
        .slice(0, 5)
        .map(x => x.idx);

      if (pendingIndices.length === 0) {
        autoTagStateRef.current = 'stopped';
        setAutoTagState('stopped');
        break;
      }

      setAutoTagQueue(prevQ => {
           const newQ = [...prevQ];
           pendingIndices.forEach(idx => { newQ[idx] = { ...newQ[idx], status: 'processing', error: undefined }; });
           autoTagQueueRef.current = newQ;
           return newQ;
      });

      const batchChars = pendingIndices.map(idx => autoTagQueueRef.current[idx].char);

      try {
        const results = await autoTagCharactersBatch(batchChars);
        
        let successCount = 0;
        let failCount = 0;
        
        const newQ = [...autoTagQueueRef.current];
        pendingIndices.forEach(idx => {
            const q = newQ[idx];
            const res = results.find(r => r.id === q.char.id);
            if (res && res.tags && res.tags.length > 0) {
                 const generatedTags = res.tags;
                 if (q.isRetag) {
                      newQ[idx] = { ...q, status: 'review', generatedTags };
                      // Do not auto-increment successCount yet, it waits for user review
                 } else {
                      const currentTags = Array.isArray(q.char.tags) ? q.char.tags : [];
                      const newTags = Array.from(new Set([...currentTags, ...generatedTags]));
                      onUpdate?.({ ...q.char, tags: newTags });
                      newQ[idx] = { ...q, status: 'success', generatedTags };
                      successCount++;
                 }
            } else {
                 newQ[idx] = { ...q, status: 'fail', error: "AI未返回结果可重试", retries: q.retries + 1 };
                 if (newQ[idx].retries >= 5) failCount++;
            }
        });
        
        autoTagQueueRef.current = newQ;
        setAutoTagQueue(newQ);
        
        setAutoTagProgress(p => ({ 
             ...p, 
             current: p.current + successCount + failCount, 
             success: p.success + successCount,
             fail: p.fail + failCount
        }));

      } catch (err: any) {
         let failCount = 0;
         const newQ = [...autoTagQueueRef.current];
         pendingIndices.forEach(idx => {
             const q = newQ[idx];
             newQ[idx] = { ...q, status: 'fail', error: err.message || "请求失败", retries: q.retries + 1 };
             if (newQ[idx].retries >= 5) failCount++;
         });
         
         autoTagQueueRef.current = newQ;
         setAutoTagQueue(newQ);
         
         setAutoTagProgress(p => ({ ...p, current: p.current + failCount, fail: p.fail + failCount }));
         await new Promise(r => setTimeout(r, 5000)); // Increase backoff on error
      }
      
      // Delay before next batch to respect rate limits
      await new Promise(r => setTimeout(r, 3000));
    }
  };

  const handleStartAutoTag = () => {
     if (autoTagState === 'paused' && autoTagQueue.length > 0) {
         autoTagStateRef.current = 'running';
         setAutoTagState('running');
         processAutoTagQueue();
         return;
     }

     const isRetag = autoTagTab === 'tagged';
     const charsToProcessBase = characters.filter(c => {
        const hasTags = Array.isArray(c.tags) && c.tags.length > 0;
        return isRetag ? hasTags : !hasTags;
     });
     const charsToProcess = autoTagBatchSize === 'all' ? charsToProcessBase : charsToProcessBase.slice(0, autoTagBatchSize);

     if (charsToProcess.length === 0) {
       alert("没有找到符合条件的角色。");
       return;
     }

     const newQueue: AutoTagQueueItem[] = charsToProcess.map(char => ({
         char,
         status: 'pending',
         retries: 0,
         isRetag
     }));

     autoTagQueueRef.current = newQueue;
     setAutoTagQueue(newQueue);
     setAutoTagProgress({ total: newQueue.length, current: 0, success: 0, fail: 0 });
     autoTagStateRef.current = 'running';
     setAutoTagState('running');

     processAutoTagQueue();
  };

  const handlePauseAutoTag = () => {
      autoTagStateRef.current = 'paused';
      setAutoTagState('paused');
  };

  const handleStopAutoTag = () => {
      autoTagStateRef.current = 'stopped';
      setAutoTagState('stopped');
  };

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isAddingCollection, setIsAddingCollection] = useState(false);
  const [newTagInputValue, setNewTagInputValue] = useState('');
  const [newCollectionInputValue, setNewCollectionInputValue] = useState('');

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
  const [dragOverCollection, setDragOverCollection] = useState<{name: string, position: 'before'|'after'|'inside'|'root'} | null>(null);

  const handleDragStart = (e: React.DragEvent, charId: string) => {
      if (isSelectionMode && selectedIds.has(charId) && selectedIds.size > 1) {
          setDraggedCharId(charId);
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'multi', ids: Array.from(selectedIds) }));
      } else {
          setDraggedCharId(charId);
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'single', id: charId }));
      }
      e.dataTransfer.effectAllowed = 'copy';
  };

  const handleFolderDragStart = (e: React.DragEvent, name: string) => {
      setDraggingFolder(name);
      e.dataTransfer.setData('text/folder', name);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, collectionName: string | null) => {
      e.preventDefault();
      if (draggingFolder && collectionName) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          if (y < rect.height * 0.25) {
              setDragOverCollection({ name: collectionName, position: 'before' });
          } else if (y > rect.height * 0.75) {
              setDragOverCollection({ name: collectionName, position: 'after' });
          } else {
              setDragOverCollection({ name: collectionName, position: 'inside' });
          }
      } else {
          setDragOverCollection(collectionName ? { name: collectionName, position: 'inside' } : { name: '', position: 'root' });
      }
      e.dataTransfer.dropEffect = draggingFolder ? 'move' : 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCollection(null);
  };

  const handleDrop = (e: React.DragEvent, collectionName: string | null) => {
      e.preventDefault();
      const dropPosition = dragOverCollection?.position || 'inside';
      setDragOverCollection(null);
      setDraggingFolder(null);

      const folderData = e.dataTransfer.getData('text/folder');
      if (folderData) {
          const isReorder = dropPosition === 'before' || dropPosition === 'after';
          if (!isReorder && (dropPosition === 'inside' || dropPosition === 'root')) {
              const draggedBaseName = folderData.split('/').pop()!;
              const newName = collectionName ? `${collectionName}/${draggedBaseName}` : draggedBaseName;
              if (folderData !== collectionName && (!collectionName || !collectionName.startsWith(folderData + '/')) && newName !== folderData) {
                  if (onRenameFolder) onRenameFolder(folderData, newName);
              }
          } else if (onReorderFolders && collectionName && folderData !== collectionName) {
              onReorderFolders(folderData, collectionName, dropPosition === 'after' ? 'after' : 'before');
          }
          return;
      }

      const dataStr = e.dataTransfer.getData('text/plain');
      
      if (dataStr) {
          try {
              const data = JSON.parse(dataStr);
              const targetFolder = collectionName || undefined;
              if (data.type === 'multi' && Array.isArray(data.ids)) {
                  const charsToUpdate = characters
                      .filter(c => data.ids.includes(c.id) && c.folder !== targetFolder)
                      .map(c => ({ ...c, folder: targetFolder }));
                  if (charsToUpdate.length > 0) {
                      if (onUpdateBatch) {
                          onUpdateBatch(charsToUpdate);
                      } else {
                          charsToUpdate.forEach(c => onUpdate?.(c));
                      }
                  }
              } else if (data.type === 'single' && data.id) {
                  const char = characters.find(c => c.id === data.id);
                  if (char && char.folder !== targetFolder) {
                      onUpdate?.({ ...char, folder: targetFolder });
                  }
              }
          } catch (err) {
              // Fallback to legacy string charId
              const targetFolder = collectionName || undefined;
              const char = characters.find(c => c.id === dataStr);
              if (char && char.folder !== targetFolder) {
                  onUpdate?.({ ...char, folder: targetFolder });
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
      if (newName !== editingCollection && !folders.includes(newName)) {
          onRenameFolder?.(editingCollection, newName);
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
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      const saved = localStorage.getItem('glass_tavern_current_page');
      return saved ? parseInt(saved, 10) : 1;
    } catch {
      return 1;
    }
  });
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    try {
      const saved = localStorage.getItem('glass_tavern_items_per_page');
      return saved ? parseInt(saved, 10) : 20;
    } catch {
      return 20;
    }
  });
  const [jumpPage, setJumpPage] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('glass_tavern_current_page', currentPage.toString());
      localStorage.setItem('glass_tavern_items_per_page', itemsPerPage.toString());
    } catch (e) {
      console.error("Failed to save pagination state", e);
    }
  }, [currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage, sortOption, activeFilter]);

  // Compute unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>(customTags);
    characters.forEach(c => {
      const currentTags = Array.isArray(c.tags) ? c.tags : [];
      currentTags.forEach(t => {
          tags.add(t);
      });
    });
    return Array.from(tags).sort();
  }, [characters, customTags]);

  const duplicateIds = useMemo(() => {
    const seenNames = new Map<string, string[]>();
    const ids = new Set<string>();
    
    characters.forEach(c => {
        let existing = seenNames.get(c.name);
        if (!existing) {
            existing = [];
            seenNames.set(c.name, existing);
        }
        existing.push(c.id);
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
    
    if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase();
        result = result.filter(c => 
            c.name.toLowerCase().includes(query) || 
            (c.description && c.description.toLowerCase().includes(query)) ||
            (c.firstMessage && c.firstMessage.toLowerCase().includes(query))
        );
    }
    
    // Apply Active Filter
    if ((activeFilter as any).recommendResults) {
        const recommendedIds = ((activeFilter as any).recommendResults as any[]).map(r => r.id);
        result = result.filter(c => recommendedIds.includes(c.id));
    } else if (activeFilter.type === 'favorite') {
        result = result.filter(c => c.isFavorite);
    } else if (activeFilter.type === 'tag' && activeFilter.value) {
        result = result.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || ''));
    } else if (activeFilter.type === 'collection' && activeFilter.value) {
        result = result.filter(c => c.folder === activeFilter.value);
    } else if (activeFilter.type === 'duplicate') {
        result = result.filter(c => duplicateIds.has(c.id));
    }
    
    // Sorting (optimize by pre-calculating sort keys if it's updated-desc)
    if (sortOption === 'updated-desc') {
        return result.map(char => ({
            char,
            time: Math.max(char.updatedAt || 0, char.fileLastModified || 0, char.importDate || 0)
        })).sort((a, b) => b.time - a.time).map(item => item.char);
    }

    return [...result].sort((a, b) => {
        if (sortOption === 'date-desc') {
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
  }, [characters, duplicateIds, sortOption, activeFilter, debouncedSearchQuery]);

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
             <AsyncAvatar 
                charId={char.id}
                initialUrl={char.avatarUrl}
                alt={char.name} 
                className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
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
                        {char.tags && char.tags.length > 0 && <Tag size={12} className="text-blue-500" title={`包含 ${char.tags.length} 个标签`} />}
                        {hasQr && <span className="text-[9px] font-extrabold text-green-500 border border-green-500/50 rounded-[3px] px-1 py-[1px] leading-none" title="包含二维码配置">QR</span>}
                        {hasWorldInfo && <Book size={14} className="text-yellow-500" title="包含世界书" />}
                    </div>
                </div>
                
                {/* Character Tags Row */}
                {char.tags && char.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2 max-h-[22px] overflow-hidden">
                        {char.tags.slice(0, 3).map((tag: string, i: number) => (
                            <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded-md font-bold border ${theme === 'light' ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-blue-500/10 border-blue-400/20 text-blue-400'}`}>
                                {tag}
                            </span>
                        ))}
                        {char.tags.length > 3 && <span className="text-[8px] opacity-40">+{char.tags.length - 3}</span>}
                    </div>
                )}

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
    const qrFiles: string[] = [];
    const fileArray = Array.from(files) as File[];
    const validChars: Character[] = [];
    const seenNamesInBatch = new Set<string>();
    const newFoldersToCreate = new Set<string>();

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

        if (file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length >= 2) {
                const folderPath = parts.slice(0, parts.length - 1).join('/');
                if (folderPath) {
                    let currentPath = '';
                    for (const part of folderPath.split('/')) {
                        currentPath = currentPath ? `${currentPath}/${part}` : part;
                        newFoldersToCreate.add(currentPath);
                    }
                    char.folder = folderPath;
                }
            }
        }

        const isDuplicateInApp = characters.some(c => c.name === char.name);
        const isDuplicateInBatch = seenNamesInBatch.has(char.name);
        
        if (isDuplicateInApp || isDuplicateInBatch) {
            duplicateFiles.push(file.name);
            if (files.length === 1 && isDuplicateInApp) {
                setWarning(`注意：检测到重复的角色 "${char.name}"，已导入`);
            }
        }
        
        seenNamesInBatch.add(char.name);
        validChars.push(char);
        successCount++;
      } catch (err: any) {
        console.error(`Failed to import ${file.name}:`, err);
        failCount++;
        const msg = err.message || "";
        if (msg === "DETECTED_QR_FILE") {
            qrFiles.push(file.name);
        } else if (msg.includes("不是有效的 PNG 文件") || msg.includes("未在此图片中找到角色数据") || msg.includes("Invalid JSON file") || msg.includes("无效的")) {
            invalidFormatFiles.push(file.name);
        } else {
            otherFailedFiles.push(file.name);
        }
      }
    }

    if (newFoldersToCreate.size > 0 && onCreateFolders) {
        onCreateFolders(Array.from(newFoldersToCreate));
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
        setImportResults({ success: successCount, failed: failCount, invalidFormatFiles, duplicateFiles, otherFailedFiles, qrFiles });
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
        await exportBulkCharacters(selectedChars, folders);
        setIsSelectionMode(false);
        setSelectedIds(new Set());
        setLastSelectedId(null);
    } catch (e: any) {
        setError("批量导出失败: " + e.message);
    }
  };

  const handleSingleExport = async (char: Character, format: 'json' | 'png') => {
    setExportMenuCharId(null);
    
    // Get the absolute latest version from state to fix stale closure/snapshot issues
    const latestChar = characters.find(c => c.id === char.id) || char;

    // Check if trying to export PNG from a JSON-imported character (or one without a proper avatar)
    if (format === 'png' && latestChar.importFormat === 'json') {
        // We can check if the avatar is a blob URL (which means they uploaded one) or a picsum URL (placeholder)
        // If it's a placeholder, we should definitely warn.
        if (latestChar.avatarUrl.includes('picsum.photos')) {
             if (!window.confirm("该角色是通过 JSON 导入的，且似乎没有上传自定义头像（当前是随机占位图）。\n导出 PNG 会将数据嵌入到这张占位图中。\n\n确定要继续吗？建议先在编辑页面上传一张图片。")) {
                 return;
             }
        }
    }

    try {
      await exportCharacterData(latestChar, format);
    } catch (err) {
      console.error("Export failed", err);
      setError("导出失败");
    }
  };

  const handleAddTag = () => {
    const tag = newTagInputValue.trim();
    if (tag && !allTags.includes(tag)) {
        setCustomTags(prev => [...prev, tag]);
        setNewTagInputValue('');
        setIsAddingTag(false);
    }
  };

  const handleAddCollection = () => {
      const name = newCollectionInputValue.trim();
      if (name && !folders.includes(name)) {
          onCreateFolder?.(name);
          setNewCollectionInputValue('');
          setIsAddingCollection(false);
      }
  };

  const handleDeleteCollection = (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`确定要删除文件夹 "${name}" 吗? 其中的角色将被移出。`)) return;
      
      onDeleteFolder?.(name);

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

  const handleAutoCleanDuplicates = () => {
    if (!groupedCharacters) return;
    
    const idsToDelete = new Set<string>();
    const charsToUpdate: Character[] = [];
    
    groupedCharacters.forEach(([name, chars]) => {
      // Find identical subgroups based on core content
      const contentMap = new Map<string, Character[]>();
      chars.forEach(c => {
        // Exclude properties that could vary without changing the core meaning:
        // id, importDate, fileLastModified, avatarUrl, cardUrl, tags, alternate_greetings, etc.
        const hashObj = {
          firstMessage: c.firstMessage || '',
          description: c.description || '',
          personality: c.personality || '',
          scenario: c.scenario || '',
          mes_example: c.mes_example || '',
          system_prompt: c.system_prompt || '',
          creator_notes: c.creator_notes || '',
          post_history_instructions: c.post_history_instructions || '',
        };
        const contentHash = JSON.stringify(hashObj);
        if (!contentMap.has(contentHash)) contentMap.set(contentHash, []);
        contentMap.get(contentHash)!.push(c);
      });
      
      contentMap.forEach((identicalChars) => {
        if (identicalChars.length > 1) {
          // Sort by local modified date descending (newest first)
          const sorted = [...identicalChars].sort((a, b) => {
            const timeA = Math.max(a.updatedAt || 0, a.fileLastModified || 0, a.importDate || 0);
            const timeB = Math.max(b.updatedAt || 0, b.fileLastModified || 0, b.importDate || 0);
            return timeB - timeA;
          });
          
          let keptChar = { ...sorted[0] };
          let needsUpdate = false;
          
          // Keep sorted[0], mark rest for deletion & merge info into sorted[0]
          for (let i = 1; i < sorted.length; i++) {
            idsToDelete.add(sorted[i].id);
            const oldChar = sorted[i];

            // Merge QR
            if (oldChar.qrList && oldChar.qrList.length > 0 && (!keptChar.qrList || keptChar.qrList.length === 0)) {
                keptChar.qrList = oldChar.qrList;
                keptChar.extra_qr_data = oldChar.extra_qr_data;
                keptChar.qrFileName = oldChar.qrFileName;
                needsUpdate = true;
            }
            // Merge Source URL
            if (oldChar.sourceUrl && !keptChar.sourceUrl) {
                keptChar.sourceUrl = oldChar.sourceUrl;
                needsUpdate = true;
            }
            // Merge Tags
            if (oldChar.tags && oldChar.tags.length > 0) {
                const existingTags = keptChar.tags || [];
                const mergedTags = Array.from(new Set([...existingTags, ...oldChar.tags]));
                if (mergedTags.length > existingTags.length) {
                    keptChar.tags = mergedTags;
                    needsUpdate = true;
                }
            }
          }
          
          if (needsUpdate) {
             charsToUpdate.push(keptChar);
          }
        }
      });
    });
    
    if (idsToDelete.size === 0) {
      alert("没有发现【名称且核心内容相同 (忽略标签和QR差异)】的旧版卡片。\n现有的同名重复卡片似乎核心文案均有差异，需要您手动鉴别。");
      return;
    }
    
    // Automatically apply merged data if any
    if (charsToUpdate.length > 0 && onUpdateBatch) {
       onUpdateBatch(charsToUpdate);
    }
    
    setSelectedIds(prev => new Set([...prev, ...Array.from(idsToDelete)]));
    setIsSelectionMode(true);
    alert(`已为您选中 ${idsToDelete.size} 张【名称且核心内容完全一致】的旧版重复卡片。
这些旧卡的 QR、来源链接、标签已自动合并到了最新版卡片中！

您可以预览并确认无误后，点击头部的垃圾桶图标进行批量删除。`);
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

              {/* AI Features */}
              <button 
                  onClick={() => setShowAIRecommendModal(true)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 mt-1 transition-all group ${
                      theme === 'light' ? 'hover:bg-white/60 text-slate-600 hover:shadow-sm' : 'hover:bg-white/10 text-gray-400'
                  }`}
              >
                  <Sparkles size={14} />
                  <span>AI 智能推荐</span>
              </button>
              <button 
                  onClick={() => setShowAutoTagModal(true)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all group ${
                      theme === 'light' ? 'hover:bg-white/60 text-slate-600 hover:shadow-sm' : 'hover:bg-white/10 text-gray-400'
                  }`}
              >
                  <Tag size={14} />
                  <span>批量自动打标</span>
              </button>

              <button 
                  onClick={() => setShowApiConfigModal(true)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 mt-1 transition-all group ${
                      theme === 'light' ? 'hover:bg-white/60 text-slate-600 hover:shadow-sm' : 'hover:bg-white/10 text-gray-400'
                  }`}
              >
                  <Zap size={14} />
                  <span>API 连接</span>
              </button>

              <div className={`h-px my-3 mx-2 ${theme === 'light' ? 'bg-slate-200/60' : 'bg-white/5'}`}></div>

              {/* Collections Header */}
              <div 
                  className={`w-full px-2 py-2 flex items-center justify-between transition-colors ${dragOverCollection?.position === 'root' ? (theme === 'light' ? 'bg-blue-100 ring-2 ring-blue-400 rounded-xl' : 'bg-blue-500/30 ring-2 ring-blue-500 rounded-xl') : ''}`}
                  onDragOver={(e) => handleDragOver(e, null)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, null)}
              >
                  <button 
                      onClick={() => setIsCollectionsExpanded(!isCollectionsExpanded)}
                      className={`flex-1 text-left font-bold text-xs uppercase tracking-wider flex items-center gap-2 ${theme === 'light' ? 'text-slate-400 hover:text-slate-600' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                      <Folder size={14} />
                      <span>文件夹 ({folders.length})</span>
                      {isCollectionsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button 
                      onClick={() => setIsAddingCollection(!isAddingCollection)}
                      className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-slate-200 text-slate-400 hover:text-slate-600' : 'hover:bg-white/10 text-gray-500 hover:text-gray-300'}`}
                      title="新建文件夹"
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
                              placeholder="文件夹名称..."
                              className={`w-full px-3 py-2 rounded-xl text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                          />
                      </div>
                  )}
                  {(() => {
                      const displayed = folders.filter(f => {
                          const parts = f.split('/');
                          if (parts.length === 1) return true;
                          let currentPath = '';
                          for (let i = 0; i < parts.length - 1; i++) {
                              currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
                              if (!expandedFolders.has(currentPath)) return false;
                          }
                          return true;
                      });
                      
                      return displayed.map(name => {
                          const parts = name.split('/');
                          const displayName = <span className="truncate flex-1" title={name}>{parts[parts.length - 1]}</span>;
                          const hasChildren = folders.some(f => f.startsWith(`${name}/`) && f !== name);
                          
                          return (
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
                                  draggable
                                  onDragStart={(e) => handleFolderDragStart(e, name)}
                                  onDragEnd={() => setDraggingFolder(null)}
                                  onClick={() => setActiveFilter({ type: 'collection', value: name })}
                                  onDoubleClick={(e) => handleStartRenameCollection(name, e)}
                                  onDragOver={(e) => handleDragOver(e, name)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, name)}
                                  className={`w-full text-left px-2 py-2.5 rounded-xl text-sm font-medium flex items-center gap-1 transition-all group relative 
                                    ${activeFilter.type === 'collection' && activeFilter.value === name ? (theme === 'light' ? 'bg-slate-200 text-slate-900' : 'bg-white/20 text-white') : (theme === 'light' ? 'hover:bg-white/50 text-slate-500' : 'hover:bg-white/5 text-gray-400')}
                                    ${dragOverCollection === name && !draggingFolder ? (theme === 'light' ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-blue-500/30 ring-2 ring-blue-500') : ''}
                                    ${dragOverCollection === name && draggingFolder && draggingFolder !== name ? (theme === 'light' ? 'bg-slate-100' : 'bg-white/5') : ''}
                                    ${draggingFolder === name ? 'opacity-50' : ''}
                                  `}
                                  style={{ borderTop: dragOverCollection === name && draggingFolder && draggingFolder !== name ? '2px solid #3b82f6' : '2px solid transparent', borderBottom: '2px solid transparent' }}
                              >
                                  <div 
                                       className={`p-1 -ml-1 rounded cursor-pointer shrink-0 transition-colors ${theme === 'light' ? 'hover:bg-slate-300' : 'hover:bg-gray-600'}`}
                                       onClick={(e) => {
                                           if (!hasChildren) return;
                                           e.stopPropagation();
                                           setExpandedFolders(prev => {
                                               const next = new Set(prev);
                                               if (next.has(name)) next.delete(name);
                                               else next.add(name);
                                               return next;
                                           });
                                       }}
                                   >
                                      {hasChildren ? (
                                        expandedFolders.has(name) ? <ChevronDown size={14} className="opacity-70" /> : <ChevronRight size={14} className="opacity-70" />
                                      ) : (
                                        <Folder size={14} className="opacity-70" />
                                      )}
                                  </div>
                                  <div className="flex-1 overflow-hidden ml-1 flex items-center">
                                      {displayName}
                                  </div>
                                  <span className="text-[10px] opacity-50 shadow-sm transition-opacity">
                                      {characters.filter(c => c.folder === name || (c.folder && c.folder.startsWith(name + '/'))).length}
                                  </span>
                                  
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
                  );
              });
          })()}
                  {folders.length === 0 && !isAddingCollection && (
                      <div className={`text-center py-4 text-xs ${theme === 'light' ? 'text-slate-400' : 'text-gray-600'}`}>
                          暂无文件夹
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
                   {(activeFilter as any).recommendResults && 'AI 智能推荐结果'}
               </h1>
               {/* Filter counts bug fix in header */}
               <p className={`text-xs ${subTextColor}`}>
                   {activeFilter.type === 'all' && `共 ${characters.length} 张卡片`}
                   {activeFilter.type === 'tag' && `标签 "${activeFilter.value}" 下共 ${characters.filter(c => (Array.isArray(c.tags) ? c.tags : []).includes(activeFilter.value || '')).length} 张卡片`}
                   {activeFilter.type === 'collection' && `文件夹 "${activeFilter.value}" 下共 ${characters.filter(c => c.folder === activeFilter.value || (c.folder && c.folder.startsWith(activeFilter.value + '/'))).length} 张卡片`}
                   {activeFilter.type === 'duplicate' && `共 ${duplicateIds.size} 张重复卡片`}
                   {(activeFilter as any).recommendResults && `根据关键词找到 ${(activeFilter as any).recommendResults?.length} 张卡片`}
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
        
        <div className="flex flex-wrap gap-2 items-center justify-end relative">
            <div className="relative flex items-center">
                <button 
                    onClick={() => {
                        setShowTagFilterModal(!showTagFilterModal);
                        setTagFilterMode('view');
                    }}
                    className={`flex items-center justify-center p-2 rounded-full border backdrop-blur-sm transition-all ${buttonBase} ${activeFilter.type === 'tag' ? activeFilterClass : ''}`}
                    title="标签筛选"
                >
                    <Filter size={16} />
                </button>
                
                {/* Tag Filter Popover */}
                {showTagFilterModal && (
                    <div className={`absolute top-full mt-2 right-0 w-[400px] z-[150] rounded-2xl shadow-2xl border animate-in slide-in-from-top-4 fade-in duration-200 overflow-hidden ${theme === 'light' ? 'bg-white border-slate-200/50' : 'bg-gray-900 border-white/10'}`}>
                     <div className={`flex flex-col border-b ${theme === 'light' ? 'border-slate-100 bg-slate-50/80' : 'border-white/10 bg-white/5'} backdrop-blur-md`}>
                         <div className="px-4 py-3 flex justify-between items-center">
                             <span className={`font-bold text-sm flex items-center gap-2 ${theme === 'light' ? 'text-slate-700' : 'text-slate-200'}`}>
                                 <Tag size={14} className="opacity-70" /> 标签管理
                             </span>
                             <div className="flex items-center gap-2">
                                 {activeFilter.type === 'tag' && activeFilter.value && (
                                     <button 
                                         onClick={() => setActiveFilter({ type: 'all' })}
                                         className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors ${theme === 'light' ? 'text-slate-500 hover:bg-slate-200/50' : 'text-slate-400 hover:bg-white/5'}`}
                                     >
                                         清除筛选
                                     </button>
                                 )}
                                 <button 
                                   onClick={() => setTagFilterMode(tagFilterMode === 'view' ? 'edit' : 'view')}
                                   className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors ${theme === 'light' ? 'text-slate-700 bg-slate-200/50 hover:bg-slate-200' : 'text-gray-200 bg-white/10 hover:bg-white/20'}`}
                                 >
                                   {tagFilterMode === 'view' ? '编辑模式' : '完成编辑'}
                                 </button>
                             </div>
                         </div>
                         <div className="px-3 pb-3">
                             <div className={`relative flex items-center w-full rounded-xl border transition-all ${theme === 'light' ? 'bg-white border-slate-200 hover:border-slate-300 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10' : 'bg-[#0f1117] border-white/10 hover:border-white/20 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 shadow-inner'}`}>
                                 <div className="pl-3 py-2 flex items-center pointer-events-none opacity-50">
                                     <Search size={14} />
                                 </div>
                                 <input
                                     type="text"
                                     placeholder="搜索特定标签..."
                                     value={tagSearchQuery}
                                     onChange={(e) => setTagSearchQuery(e.target.value)}
                                     className="w-full bg-transparent border-none outline-none px-2 py-2 text-[13px] font-medium placeholder-opacity-50"
                                     style={{ color: 'inherit' }}
                                 />
                                 {tagSearchQuery && (
                                     <button 
                                         onClick={() => setTagSearchQuery('')} 
                                         className="pr-3 pl-1 py-2 flex items-center opacity-40 hover:opacity-100 transition-opacity"
                                     >
                                         <X size={14} />
                                     </button>
                                 )}
                             </div>
                         </div>
                     </div>
                     <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                        <div className="space-y-4">
                            {tagFilterMode === 'view' ? (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        {allTags.filter(t => !tagSearchQuery.trim() || t.toLowerCase().includes(tagSearchQuery.toLowerCase())).map(tag => (
                                            <button
                                                key={tag}
                                                onClick={() => setActiveFilter({ type: 'tag', value: tag })}
                                                className={`px-3 py-1.5 rounded-lg text-sm transition-all border ${
                                                    activeFilter.type === 'tag' && activeFilter.value === tag 
                                                        ? (theme === 'light' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-900 border-white')
                                                        : (theme === 'light' ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-transparent border-white/20 hover:bg-white/10 text-gray-300')
                                                }`}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                        {allTags.filter(t => !tagSearchQuery.trim() || t.toLowerCase().includes(tagSearchQuery.toLowerCase())).length === 0 && (
                                            <div className="w-full text-center py-8 text-sm opacity-50">
                                                {tagSearchQuery ? '未找到匹配的标签' : '暂无可用的标签'}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {allTags.filter(t => !tagSearchQuery.trim() || t.toLowerCase().includes(tagSearchQuery.toLowerCase())).map(tag => (
                                        <div key={tag} className={`flex items-center gap-1 py-1 pl-3 pr-1.5 rounded-lg border text-sm ${theme === 'light' ? 'bg-white border-slate-200 text-slate-700' : 'bg-transparent border-white/20 text-gray-300'}`}>
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
                                                    className={`w-[120px] px-2 py-0.5 rounded-md text-sm outline-none border ${theme === 'light' ? 'bg-white border-blue-500 text-slate-800' : 'bg-black/40 border-blue-500 text-white'}`}
                                                />
                                            ) : (
                                                <>
                                                    <span className="font-medium mr-1">{tag}</span>
                                                    <div className="flex gap-0.5 shrink-0">
                                                        <button onClick={(e) => handleStartRenameTag(tag, e)} className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-800' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}><Pencil size={14}/></button>
                                                        <button onClick={(e) => handleDeleteTag(tag, e)} className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'hover:bg-red-100 text-slate-500 hover:text-red-500' : 'hover:bg-red-500/20 text-gray-400 hover:text-red-400'}`}><Trash2 size={14}/></button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                    {allTags.filter(t => !tagSearchQuery.trim() || t.toLowerCase().includes(tagSearchQuery.toLowerCase())).length === 0 && (
                                        <div className="w-full text-center py-8 text-sm opacity-50">
                                            {tagSearchQuery ? '未找到匹配的标签' : '暂无可用的标签'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                     </div>
                </div>
            )}
            </div>

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
                 {activeFilter.type === 'duplicate' && (
                     <button
                         onClick={handleAutoCleanDuplicates} 
                         className={`flex items-center gap-1.5 px-4 py-1.5 text-xs h-9 rounded-lg border shadow-sm transition-all ${theme === 'light' ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'}`}
                         title="自动对比并选中内容完全一致的较旧版本"
                     >
                        <Sparkles size={14} /> 智能清理重复
                     </button>
                 )}
                 {selectedIds.size > 0 && (
                     <button
                         onClick={() => {
                             const tag = window.prompt("输入要批量添加的标签名称:");
                             if (tag && tag.trim()) {
                                 const trimmedTag = tag.trim();
                                 let count = 0;
                                 characters.forEach(char => {
                                     if (selectedIds.has(char.id)) {
                                         const currentTags = Array.isArray(char.tags) ? char.tags : [];
                                         if (!currentTags.includes(trimmedTag)) {
                                             onUpdate?.({ ...char, tags: [...currentTags, trimmedTag] });
                                             count++;
                                         }
                                     }
                                 });
                                 alert(`批量添加标签 "${trimmedTag}" 成功，应用到 ${count} 个角色。`);
                                 setSelectedIds(new Set());
                                 setIsSelectionMode(false);
                             }
                         }} 
                         className={`flex items-center gap-1.5 px-4 py-1.5 text-xs h-9 rounded-lg border shadow-sm transition-all ${theme === 'light' ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'}`}
                     >
                        <Tag size={14} /> 批量加标签
                     </button>
                 )}
                 {selectedIds.size === 2 && (
                     <button
                         onClick={() => setCompareModalOpen(true)} 
                         className={`flex items-center gap-1.5 px-4 py-1.5 text-xs h-9 rounded-lg border shadow-sm transition-all ${theme === 'light' ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'}`}
                     >
                        <GitCompare size={14} /> 对比选中 (2)
                     </button>
                 )}
                 <button
                     disabled={selectedIds.size === 0} 
                     onClick={handleBulkExport} 
                     className={`flex items-center gap-1.5 px-4 py-1.5 text-xs h-9 rounded-lg border shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${theme === 'light' ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'}`}
                 >
                    <Download size={14} /> 导出 (ZIP)
                 </button>
                 <button
                     disabled={selectedIds.size === 0} 
                     onClick={() => {if(window.confirm(`确定删除这 ${selectedIds.size} 张卡片吗?`)) { onDeleteBatch?.(Array.from(selectedIds), true); setSelectedIds(new Set()); }}} 
                     className={`flex items-center gap-1.5 px-4 py-1.5 text-xs h-9 rounded-lg border shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${theme === 'light' ? 'bg-white hover:bg-red-50 border-slate-200 text-red-500' : 'bg-white/5 hover:bg-red-500/20 border-white/10 text-red-400'}`}
                 >
                    <Trash2 size={14} /> 删除
                 </button>
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
                      {[10, 20, 30, 50, 100, 250, 500, 1000].map(size => (
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
          
          {importResults && (importResults as ImportResults).qrFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2 text-sm uppercase tracking-wider opacity-70">检测到 QR 配置文件</h4>
              <p className="text-xs mb-2 opacity-60">这些文件应在角色详情页中导入，而不是在此处导入：</p>
              <div className={`rounded-lg p-3 text-sm font-mono overflow-x-auto max-h-32 overflow-y-auto custom-scrollbar ${theme === 'light' ? 'bg-blue-50 text-blue-800' : 'bg-blue-900/20 text-blue-200'}`}>
                <ul className="list-disc list-inside space-y-1">
                  {(importResults as ImportResults).qrFiles.map((msg, idx) => (
                    <li key={idx} className="break-all">{msg}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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
              <h4 className="font-semibold mb-2 text-sm uppercase tracking-wider opacity-70">其他未知错误</h4>
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

      {/* AI Recommend Modal */}
      <Modal
        isOpen={isActive && showAIRecommendModal}
        onClose={() => setShowAIRecommendModal(false)}
        title="✨ AI 智能推荐"
        theme={theme}
        maxWidth={aiRecommendResults ? "max-w-5xl" : "max-w-xl"}
      >
        <div className="space-y-6">
          <div className={`${aiRecommendResults ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : ''}`}>
            {/* Left/Top side: Input and Logs */}
            <div className={`space-y-6 ${aiRecommendResults ? 'lg:col-span-1 border-r border-[#ffffff10] pr-6' : ''}`}>
               <div>
                  <p className="text-sm font-bold opacity-80 mb-2">你想玩怎样的剧情或角色？</p>
                  <div className={`relative rounded-xl border p-1 transition-colors ${theme === 'light' ? 'bg-white border-slate-200 focus-within:border-slate-800' : 'bg-black/20 border-white/10 focus-within:border-white/50'}`}>
                      <textarea
                        rows={4}
                        placeholder="例如: 我是主播，给我找个榜一大哥的卡..."
                        value={aiRecommendQuery}
                        onChange={(e) => setAiRecommendQuery(e.target.value)}
                        className="w-full p-3 bg-transparent outline-none resize-none text-sm custom-scrollbar"
                      />
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-xs font-bold opacity-60">
                    <Sparkles size={14} />
                    <p>不知道玩什么？试试随机抽卡！（不消耗 API）</p>
                </div>

                <div className="flex justify-between gap-4 flex-wrap pb-4">
                  <Button 
                      variant="secondary" 
                      onClick={() => {
                          const randomChar = characters[Math.floor(Math.random() * characters.length)];
                          setDrawingCards([randomChar]);
                          setShowAIRecommendModal(false);
                      }} 
                      className={`flex-1 min-w-[120px] py-4 !rounded-2xl ${theme === 'light' ? '!text-slate-700 !bg-slate-100 hover:!bg-slate-200 !border-slate-200' : ''}`}
                      disabled={aiRecommendLoading}
                  >
                      <div className="flex flex-col items-center gap-1">
                          <Dices size={20} />
                          <span>随机抽卡</span>
                      </div>
                  </Button>
                  <Button 
                      variant="primary" 
                      onClick={() => {
                          handleAIRecommend();
                      }} 
                      disabled={aiRecommendLoading}
                      className={`flex-1 min-w-[120px] py-4 !rounded-2xl shadow-lg ${theme === 'light' ? '!bg-slate-800 hover:!bg-slate-700 !text-white !border-none shadow-slate-800/20' : 'shadow-black/50'}`}
                  >
                     <div className="flex flex-col items-center gap-1">
                         {aiRecommendLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles size={20} />}
                         <span>{aiRecommendLoading ? '处理中...' : '开始推荐'}</span>
                     </div>
                  </Button>
                </div>

                {/* AI Logs */}
                {(aiLogs.length > 0 || aiRecommendLoading) && (
                  <div className={`mt-4 rounded-xl border p-4 font-mono text-xs shadow-inner ${theme === 'light' ? 'bg-[#0f111a] border-slate-800 text-teal-400' : 'bg-[#0a0a0c] border-white/10 text-teal-500'}`}>
                      <div className="flex items-center gap-2 mb-3 text-gray-500 border-b border-gray-800 pb-2">
                          <span>{'>_ AI 思维链 (CHAIN OF THOUGHT)'}</span>
                      </div>
                      <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                          {aiLogs.map((log, idx) => (
                              <div key={idx} className="flex items-start gap-2 animate-in fade-in slide-in-from-bottom-1">
                                  <span className="opacity-50 shrink-0">{log.time}</span>
                                  <span className="break-all">{log.text}</span>
                              </div>
                          ))}
                          {aiRecommendLoading && (
                              <div className="flex items-start gap-2 animate-pulse mt-2 opacity-70">
                                  <span className="shrink-0">[{new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')}:{new Date().getSeconds().toString().padStart(2, '0')}]</span>
                                  <span className="flex items-center gap-1">
                                      <RefreshCw className="animate-spin" size={12} /> 正在处理中...
                                  </span>
                              </div>
                          )}
                      </div>
                  </div>
                )}
            </div>

            {/* Right side: Results */}
            {aiRecommendResults && !aiRecommendLoading && (
               <div className="lg:col-span-2 pt-6 lg:pt-0">
                  <div className="flex items-center justify-between mb-4 border-b pb-2 opacity-80 border-white/10">
                    <h3 className="font-bold flex items-center gap-2 text-sm"><CheckSquare size={16} /> 精选档案结果 ({aiRecommendResults.length})</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                      {aiRecommendResults.map((item, idx) => (
                          <div key={item.char.id + idx} className={`flex flex-col gap-3 p-4 rounded-3xl border shadow-sm transition-all hover:shadow-md ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-800/80 border-white/10'}`}>
                              <div className="flex gap-3">
                                  {/* Avatar */}
                                  <div className="w-20 lg:w-24 aspect-[4/5] relative rounded-2xl overflow-hidden shrink-0 group cursor-pointer" onClick={() => { onSelect(item.char); }}>
                                      <AsyncAvatar charId={item.char.id} initialUrl={item.char.avatarUrl} alt={item.char.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <span className="text-white font-bold text-[10px] bg-black/50 px-2 py-1 rounded-full flex items-center gap-1"><BookOpen size={12}/> 查看</span>
                                      </div>
                                  </div>

                                  {/* Info */}
                                  <div className="flex-1 flex flex-col min-w-0">
                                      <div className="flex justify-between items-start gap-1 mb-2">
                                          <h3 className={`font-black text-lg truncate ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{item.char.name}</h3>
                                          <button
                                              onClick={() => { onSelect(item.char); }}
                                              className={`px-3 py-1.5 shrink-0 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 ${theme === 'light' ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'}`}
                                          >
                                              查看详情 <ArrowRight size={14} />
                                          </button>
                                      </div>
                                      <div className="flex flex-wrap gap-1 line-clamp-2">
                                          {(item.char.tags || []).slice(0, 4).map((tag: string) => (
                                              <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${theme === 'light' ? 'bg-blue-50 text-blue-700' : 'bg-blue-900/30 text-blue-400'}`}>
                                                  {tag}
                                              </span>
                                          ))}
                                      </div>
                                  </div>
                              </div>

                              {/* Reason */}
                              <div className={`mt-auto rounded-xl p-2.5 flex flex-col gap-1 ${theme === 'light' ? 'bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100/50' : 'bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-indigo-800/30'}`}>
                                  <div className="flex items-center gap-1.5">
                                      <Sparkles size={12} className={theme === 'light' ? 'text-indigo-600' : 'text-indigo-400'} />
                                      <span className={`font-bold text-[10px] ${theme === 'light' ? 'text-indigo-900' : 'text-indigo-200'}`}>推荐理由</span>
                                  </div>
                                  <p className={`text-[10px] leading-relaxed line-clamp-3 ${theme === 'light' ? 'text-indigo-900/80' : 'text-indigo-200/80'}`}>
                                      {item.reason}
                                  </p>
                              </div>
                          </div>
                      ))}
                      
                      {aiRecommendResults.length === 0 && (
                          <div className={`col-span-1 lg:col-span-2 py-12 text-center rounded-3xl border ${theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/50 border-white/10'}`}>
                             <p className={`font-bold ${theme === 'light' ? 'text-slate-500' : 'text-gray-400'}`}>没有找到合适的档案喔，换个说法试试吧！</p>
                          </div>
                      )}
                  </div>
               </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Auto Tag Modal */}
      <Modal
        isOpen={showAutoTagModal}
        onClose={() => setShowAutoTagModal(false)}
        title="批量自动打标"
        theme={theme}
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500 mb-2">使用 AI 自动识别角色设定并生成标签</p>
          <div className={`flex gap-4 border-b ${theme === 'light' ? 'border-slate-200' : 'border-white/10'}`}>
              <button 
                  onClick={() => setAutoTagTab('untagged')}
                  className={`pb-2 text-sm font-bold transition-all border-b-2 ${autoTagTab === 'untagged' ? (theme === 'light' ? 'border-slate-800 text-slate-800' : 'border-white text-white') : 'border-transparent opacity-60 hover:opacity-100'}`}
              >
                  未打标 ({characters.filter(c => !c.tags || c.tags.length === 0).length})
              </button>
              <button 
                  onClick={() => setAutoTagTab('tagged')}
                  className={`pb-2 text-sm font-bold transition-all border-b-2 ${autoTagTab === 'tagged' ? (theme === 'light' ? 'border-slate-800 text-slate-800' : 'border-white text-white') : 'border-transparent opacity-60 hover:opacity-100'}`}
              >
                  已打标 ({characters.filter(c => Array.isArray(c.tags) && c.tags.length > 0).length})
              </button>
          </div>

          <div className={`p-4 rounded-xl border ${theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'}`}>
              <div className={`flex items-center gap-2 mb-2 font-bold text-sm ${theme === 'light' ? 'text-slate-800' : 'text-gray-200'}`}>
                  {autoTagTab === 'untagged' ? <Tag size={16} /> : <RefreshCw size={16} />}
                  <span>{autoTagTab === 'untagged' ? '待打标角色' : '重新打标'}</span>
              </div>
              <p className="text-xs opacity-70 mb-4">
                  {autoTagTab === 'untagged' 
                      ? `共发现 ${characters.filter(c => !c.tags || c.tags.length === 0).length} 个未打标的角色卡`
                      : `共发现 ${characters.filter(c => Array.isArray(c.tags) && c.tags.length > 0).length} 个已打标签的角色卡`}
              </p>
              
              <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs opacity-70">每次处理</span>
                  <select 
                      value={autoTagBatchSize} 
                      onChange={e => setAutoTagBatchSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                      className={`text-sm rounded-lg p-1.5 outline-none font-medium ${theme === 'light' ? 'bg-white border-slate-200 text-slate-800' : 'bg-black/50 border-white/20 text-white'}`}
                      disabled={autoTagState === 'running' || autoTagState === 'paused'}
                  >
                      <option value={10}>10 个</option>
                      <option value={20}>20 个</option>
                      <option value={30}>30 个</option>
                      <option value={50}>50 个</option>
                      <option value={100}>100 个</option>
                      <option value="all">全部</option>
                  </select>
              </div>

              {autoTagState === 'idle' || autoTagState === 'stopped' ? (
                <Button 
                    variant="primary" 
                    onClick={handleStartAutoTag} 
                    className={`w-full py-3 ${theme === 'light' ? '!bg-slate-800 hover:!bg-slate-700 !text-white !border-none' : ''}`}
                >
                   <div className="flex items-center justify-center gap-2">
                       {autoTagTab === 'untagged' ? <Tag size={16} /> : <RefreshCw size={16} />}
                       <span>{autoTagTab === 'untagged' ? '开始打标' : '开始重新打标'}</span>
                   </div>
                </Button>
              ) : (
                <div className="flex gap-4">
                  <Button 
                      variant="secondary" 
                      onClick={autoTagState === 'paused' ? handleStartAutoTag : handlePauseAutoTag} 
                      className={`flex-1 py-3 ${theme === 'light' ? 'border-amber-400 text-amber-600 hover:bg-amber-50 hover:border-amber-500' : 'border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-600'}`}
                  >
                     <div className="flex items-center justify-center gap-2">
                         {autoTagState === 'paused' ? <RefreshCw size={16} /> : <div className="flex gap-0.5"><div className="w-1.5 h-3 bg-current rounded-sm"></div><div className="w-1.5 h-3 bg-current rounded-sm"></div></div>}
                         <span>{autoTagState === 'paused' ? '继续' : '暂停'}</span>
                     </div>
                  </Button>
                  <Button 
                      variant="secondary" 
                      onClick={handleStopAutoTag} 
                      className={`flex-1 py-3 ${theme === 'light' ? 'border-rose-400 text-rose-600 hover:bg-rose-50 hover:border-rose-500' : 'border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600'}`}
                  >
                     <div className="flex items-center justify-center gap-2">
                         <Square size={14} className="fill-current" />
                         <span>停止</span>
                     </div>
                  </Button>
                </div>
              )}

            {/* Progress indicators */}
            {autoTagQueue.length > 0 && (
              <div className="mt-4 animate-in fade-in">
                  <div className="flex justify-between text-xs mb-2 opacity-70 font-medium">
                      <span>进度: {autoTagProgress.current} / {autoTagProgress.total}</span>
                      <div className="flex gap-4">
                         <span className="text-green-500 font-bold">成功: {autoTagProgress.success}</span>
                         <span className="text-red-500 font-bold">失败: {autoTagProgress.fail}</span>
                      </div>
                  </div>
                  {/* Progress Bar */}
                  <div className={`h-1.5 w-full rounded-full overflow-hidden flex ${theme === 'light' ? 'bg-slate-200' : 'bg-white/10'}`}>
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{width: `${(autoTagProgress.success / autoTagProgress.total) * 100}%`}}></div>
                      <div className="h-full bg-red-500 transition-all duration-300" style={{width: `${(autoTagProgress.fail / autoTagProgress.total) * 100}%`}}></div>
                  </div>

                  {/* Log items */}
                  <div className="mt-4 pt-4 border-t border-white/10">
                      <div 
                         className="text-xs mb-3 font-bold opacity-70 flex items-center gap-1.5 cursor-pointer hover:opacity-100"
                         onClick={() => setShowAutoTagLogs(!showAutoTagLogs)}
                      >
                         <ChevronDown size={14} className={`transition-transform ${showAutoTagLogs ? '' : '-rotate-90'}`}/> 
                         处理日志 <span className="opacity-50 font-normal">({autoTagQueue[0]?.isRetag ? '重新打标' : '未打标'}队列)</span>
                      </div>
                      
                      {showAutoTagLogs && (
                          <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar animate-in fade-in slide-in-from-top-2">
                             {autoTagQueue.map((item, idx) => {
                                 if (item.status === 'review') return null; // Exclude review items from logs to avoid duplication/clutter

                                 return (
                                 <div key={item.char.id + idx} className={`flex flex-col p-3 rounded-xl border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#0f111a] border-white/5'} ${item.status === 'success' ? 'border-green-500/30 bg-green-500/5' : ''}`}>
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            {item.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-500/30"></div>}
                                            {item.status === 'processing' && <RefreshCw size={14} className="animate-spin text-blue-500" />}
                                            {item.status === 'success' && <Check size={14} className="text-green-500" />}
                                            {item.status === 'fail' && <AlertTriangle size={14} className="text-red-500" />}
                                            <span className={`font-bold text-sm truncate max-w-[120px] ${theme === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>{item.char.name}</span>
                                        </div>
                                        <div>
                                            {item.status === 'pending' && <span className="text-xs opacity-50">等待中</span>}
                                            {item.status === 'processing' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-500 font-bold">处理中</span>}
                                            {item.status === 'success' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-500 font-bold">已保存</span>}
                                            {item.status === 'fail' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 font-bold">失败 {item.retries > 0 ? `(${item.retries})` : ''}</span>}
                                        </div>
                                    </div>

                                    {item.status !== 'review' && item.generatedTags && item.generatedTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {item.generatedTags.map((tag: string) => (
                                                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 border border-green-500/20">{tag}</span>
                                            ))}
                                        </div>
                                    )}
                                    {item.error && (
                                        <div className="text-[10px] text-red-400 mt-1">{item.error}</div>
                                    )}
                                 </div>
                             )})}
                          </div>
                      )}
                  </div>

                  {/* Tag Replacement UI (Separated from logs) */}
                  {autoTagQueue.some(i => i.status === 'review') && (
                      <div className="mt-4 pt-4 border-t border-white/10">
                          <div className="flex justify-between items-center mb-3">
                              <div className="text-xs font-bold flex items-center gap-1.5 text-amber-500">
                                  <Sparkles size={14} />
                                  待确认替换标签 / 合并 ({autoTagQueue.filter(i => i.status === 'review').length})
                              </div>
                              <div className="flex gap-2">
                                  <button
                                      onClick={() => {
                                          const newQ = [...autoTagQueue];
                                          let updated = 0;
                                          newQ.forEach((item, idx) => {
                                              if (item.status === 'review') {
                                                  newQ[idx] = { ...item, status: 'fail', error: '批量拒绝' };
                                                  updated++;
                                              }
                                          });
                                          setAutoTagQueue(newQ);
                                          autoTagQueueRef.current = newQ;
                                          setAutoTagProgress(p => ({ ...p, current: p.current + updated, fail: p.fail + updated }));
                                      }}
                                      className={`px-2 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold transition-all ${theme === 'light' ? 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'}`}
                                  >
                                      <Trash2 size={12}/> 全部拒绝
                                  </button>
                                  <button
                                      onClick={() => {
                                          const newQ = [...autoTagQueue];
                                          let updated = 0;
                                          newQ.forEach((item, idx) => {
                                              if (item.status === 'review') {
                                                  onUpdate?.({ ...item.char, tags: item.generatedTags });
                                                  newQ[idx] = { ...item, status: 'success' };
                                                  updated++;
                                              }
                                          });
                                          setAutoTagQueue(newQ);
                                          autoTagQueueRef.current = newQ;
                                          setAutoTagProgress(p => ({ ...p, current: p.current + updated, success: p.success + updated }));
                                      }}
                                      className="px-2 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 transition-all shadow-sm"
                                  >
                                      <Check size={12}/> 全部覆盖
                                  </button>
                                  <button
                                      onClick={() => {
                                          const newQ = [...autoTagQueue];
                                          let updated = 0;
                                          newQ.forEach((item, idx) => {
                                              if (item.status === 'review') {
                                                  const mergedTags = Array.from(new Set([...(item.char.tags || []), ...(item.generatedTags || [])]));
                                                  onUpdate?.({ ...item.char, tags: mergedTags });
                                                  newQ[idx] = { ...item, status: 'success', generatedTags: mergedTags };
                                                  updated++;
                                              }
                                          });
                                          setAutoTagQueue(newQ);
                                          autoTagQueueRef.current = newQ;
                                          setAutoTagProgress(p => ({ ...p, current: p.current + updated, success: p.success + updated }));
                                      }}
                                      className={`px-2 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold transition-all ${theme === 'light' ? 'bg-slate-200 hover:bg-slate-300 text-slate-700' : 'bg-white/10 hover:bg-white/20 text-gray-200'}`}
                                  >
                                      <FolderPlus size={12}/> 全部合并
                                  </button>
                              </div>
                          </div>

                          <div className="max-h-80 overflow-y-auto space-y-3 pr-2 custom-scrollbar animate-in fade-in slide-in-from-top-2">
                              {autoTagQueue.map((item, idx) => {
                                  if (item.status !== 'review') return null;
                                  
                                  const removeOldTag = (tagToRemove: string) => {
                                      const newQ = [...autoTagQueue];
                                      newQ[idx] = { 
                                          ...item, 
                                          char: { 
                                              ...item.char, 
                                              tags: (item.char.tags || []).filter((t: string) => t !== tagToRemove) 
                                          } 
                                      };
                                      setAutoTagQueue(newQ);
                                      autoTagQueueRef.current = newQ;
                                  };

                                  const removeNewTag = (tagToRemove: string) => {
                                      const newQ = [...autoTagQueue];
                                      newQ[idx] = { 
                                          ...item, 
                                          generatedTags: (item.generatedTags || []).filter(t => t !== tagToRemove) 
                                      };
                                      setAutoTagQueue(newQ);
                                      autoTagQueueRef.current = newQ;
                                  };

                                  return (
                                      <div key={item.char.id + idx} className={`p-3 rounded-lg flex flex-col gap-3 ${theme === 'light' ? 'bg-slate-50 border border-slate-200' : 'bg-black/20 border border-white/5'}`}>
                                          <div className="flex items-center gap-2 border-b pb-2 mb-1 border-opacity-10 border-white">
                                              <AsyncAvatar charId={item.char.id} initialUrl={item.char.avatarUrl} alt={item.char.name} className="w-8 h-8 rounded-full object-cover" />
                                              <span className={`font-bold text-sm ${theme === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>{item.char.name}</span>
                                          </div>
                                          <div className="flex flex-col gap-3">
                                              {/* Old */}
                                              <div className={`flex flex-col p-3 rounded-xl border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#151720] border-white/5'}`}>
                                                  <div className="flex items-center gap-2 mb-2">
                                                      <span className="text-sm font-bold opacity-70">旧标签</span>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1.5 min-h-[32px] items-center">
                                                      {(!item.char.tags || item.char.tags.length === 0) && <span className="text-xs opacity-40 py-1">无</span>}
                                                      {(item.char.tags || []).map((tag: string) => {
                                                          const isDuplicate = item.generatedTags?.includes(tag);
                                                          return (
                                                          <span key={tag} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded border group transition-colors ${
                                                              isDuplicate 
                                                                ? (theme === 'light' ? 'bg-blue-600 text-white border-blue-700 shadow-sm' : 'bg-blue-600/60 text-white border-blue-400 font-bold') 
                                                                : (theme === 'light' ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-slate-500/10 border-slate-500/20 opacity-70')
                                                          }`}>
                                                              {tag}
                                                              <button onClick={() => removeOldTag(tag)} className={`opacity-60 hover:opacity-100 transition-colors ml-1 p-0.5 rounded ${isDuplicate ? 'hover:bg-black/20 hover:text-white text-white/80' : 'hover:bg-slate-500/20 hover:text-red-500'}`}>
                                                                  <X size={12} />
                                                              </button>
                                                          </span>
                                                      )})}
                                                  </div>
                                              </div>
                                              
                                              {/* New */}
                                              <div className={`flex flex-col p-3 rounded-xl border ${theme === 'light' ? 'bg-[#f8fafc] border-blue-200 shadow-sm' : 'bg-blue-900/10 border-blue-500/30'}`}>
                                                  <div className="flex items-center gap-2 mb-2">
                                                      <span className="text-sm font-bold text-blue-500">AI 生成新标签</span>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1.5 min-h-[32px] items-center">
                                                      {(item.generatedTags || []).map((tag: string) => {
                                                          const isDuplicate = (item.char.tags || []).includes(tag);
                                                          return (
                                                          <span key={tag} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded border group transition-colors ${
                                                              isDuplicate 
                                                                ? (theme === 'light' ? 'bg-blue-600 text-white border-blue-700 shadow-sm' : 'bg-blue-600/60 text-white border-blue-400 font-bold') 
                                                                : (theme === 'light' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-blue-500/10 text-blue-400 border-blue-500/20')
                                                          }`}>
                                                              {tag}
                                                              <button onClick={() => removeNewTag(tag)} className={`opacity-60 hover:opacity-100 transition-colors ml-1 p-0.5 rounded ${isDuplicate ? 'hover:bg-black/20 hover:text-white text-white/80' : 'hover:bg-blue-500/20 hover:text-red-500 text-blue-500/80'}`}>
                                                                  <X size={12} />
                                                              </button>
                                                          </span>
                                                      )})}
                                                  </div>
                                              </div>
                                          </div>
                                          
                                          <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-opacity-10 border-white">
                                              <button 
                                                  onClick={() => {
                                                      const newQ = [...autoTagQueue];
                                                      newQ[idx] = { ...item, status: 'fail', error: '用户已丢弃' };
                                                      setAutoTagQueue(newQ);
                                                      autoTagQueueRef.current = newQ;
                                                      setAutoTagProgress(p => ({ ...p, current: p.current + 1, fail: p.fail + 1 }));
                                                  }}
                                                  className={`px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${theme === 'light' ? 'bg-slate-200/50 hover:bg-slate-200 text-slate-600' : 'bg-white/10 hover:bg-red-500/20 text-gray-400 hover:text-red-400'}`}
                                              >
                                                  <Trash2 size={14}/> 丢弃
                                              </button>
                                              <button 
                                                  onClick={() => {
                                                      const mergedTags = Array.from(new Set([...(item.char.tags || []), ...(item.generatedTags || [])]));
                                                      onUpdate?.({ ...item.char, tags: mergedTags });
                                                      const newQ = [...autoTagQueue];
                                                      newQ[idx] = { ...item, status: 'success', generatedTags: mergedTags };
                                                      setAutoTagQueue(newQ);
                                                      autoTagQueueRef.current = newQ;
                                                      setAutoTagProgress(p => ({ ...p, current: p.current + 1, success: p.success + 1 }));
                                                  }}
                                                  className={`px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${theme === 'light' ? 'bg-slate-200 hover:bg-slate-300 text-slate-700' : 'bg-white/10 hover:bg-white/20 text-gray-200'}`}
                                              >
                                                  <FolderPlus size={14}/> 合并旧标签
                                              </button>
                                              <button 
                                                  onClick={() => {
                                                      onUpdate?.({ ...item.char, tags: item.generatedTags });
                                                      const newQ = [...autoTagQueue];
                                                      newQ[idx] = { ...item, status: 'success' };
                                                      setAutoTagQueue(newQ);
                                                      autoTagQueueRef.current = newQ;
                                                      setAutoTagProgress(p => ({ ...p, current: p.current + 1, success: p.success + 1 }));
                                                  }}
                                                  className="px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 transition-all shadow-sm"
                                              >
                                                  <Check size={14}/> 覆盖替换
                                              </button>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Floating Auto Tag Mini Window */}
      {!showAutoTagModal && autoTagQueue.length > 0 && autoTagState !== 'idle' && autoTagState !== 'stopped' && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top fade-in duration-300 rounded-2xl shadow-xl border px-4 py-3 min-w-[280px] flex flex-col gap-2 cursor-pointer transition-all hover:scale-105 ${theme === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-white/10 text-white backdrop-blur-md'}`}
             onClick={() => setShowAutoTagModal(true)}
          >
              <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                      <RefreshCw size={16} className={`text-blue-500 ${autoTagState === 'running' ? 'animate-spin' : ''}`} />
                      <span className="font-bold text-sm">
                          {autoTagState === 'running' ? '正在后台打标...' : '后台打标已暂停'}
                      </span>
                  </div>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold opacity-70">
                  <span>进度: {autoTagProgress.current} / {autoTagProgress.total}</span>
                  <div className="flex gap-2 text-green-500">
                     <span>(成功: {autoTagProgress.success})</span>
                  </div>
              </div>
          </div>
      )}

      {/* AI Recommend Background Widget */}
      {!showAIRecommendModal && !hideAiRecommendWidget && (aiRecommendLoading || aiRecommendResults) && isActive && (
          <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top fade-in duration-300 rounded-2xl shadow-xl border p-3 flex items-center gap-4 cursor-pointer transition-all hover:scale-105 hover:shadow-2xl ${theme === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/95 border-indigo-500/30 text-white backdrop-blur-xl shadow-indigo-900/20'}`}
             onClick={() => setShowAIRecommendModal(true)}
          >
              <div className={`p-2 rounded-xl ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-indigo-500/20 text-indigo-400'}`}>
                  {aiRecommendLoading ? <RefreshCw size={20} className="animate-spin" /> : <Sparkles size={20} />}
              </div>
              <div className="flex flex-col pr-4">
                  <span className={`font-bold text-sm ${theme === 'light' ? 'text-indigo-900' : 'text-indigo-100'}`}>
                      {aiRecommendLoading ? 'AI 正在后台为您精选...' : '✨ AI 精选推荐已完成'}
                  </span>
                  <span className="text-xs opacity-70 mt-0.5">
                      {aiRecommendLoading ? '您可以继续浏览其他页面' : `共为您找到 ${aiRecommendResults?.length || 0} 个结果，点击查看`}
                  </span>
              </div>
              {!aiRecommendLoading && (
                  <button 
                      onClick={(e) => { 
                          e.stopPropagation(); 
                          setHideAiRecommendWidget(true); 
                      }} 
                      className={`absolute top-2 right-2 p-1 rounded-md opacity-40 hover:opacity-100 transition-opacity ${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-white'}`}
                      title="关闭悬浮窗"
                  >
                      <X size={14} />
                  </button>
              )}
          </div>
      )}

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
                                             <AsyncAvatar charId={char.id} initialUrl={char.avatarUrl} alt={char.name} className={`w-20 h-20 rounded-xl object-cover border ${theme === 'light' ? 'bg-gray-100 border-gray-100' : 'bg-slate-700 border-white/10'}`} />
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
                                                     {!isLeft && ((otherChar.qrList && otherChar.qrList.length > 0) || (otherChar.tags && otherChar.tags.length > 0) || otherChar.sourceUrl) && (
                                                         <button onClick={() => {
                                                             if (window.confirm(`确定要从左侧卡片合并 QR、标签及来源链接配置吗？这会覆盖当前卡的 QR。`)) {
                                                                 if (onUpdate) {
                                                                     onUpdate({
                                                                         ...char,
                                                                         qrList: otherChar.qrList?.length ? otherChar.qrList : char.qrList,
                                                                         extra_qr_data: otherChar.extra_qr_data || char.extra_qr_data,
                                                                         qrFileName: otherChar.qrFileName || char.qrFileName,
                                                                         tags: Array.from(new Set([...(char.tags || []), ...(otherChar.tags || [])])),
                                                                         sourceUrl: otherChar.sourceUrl || char.sourceUrl
                                                                     });
                                                                     alert("扩展配置合并成功！");
                                                                 }
                                                             }
                                                         }} className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${theme === 'light' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300' : 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50 border-purple-800'}`} title="从左侧卡片合并配置 (QR、标签、来源链接)">
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
                                                     {isLeft && ((otherChar.qrList && otherChar.qrList.length > 0) || (otherChar.tags && otherChar.tags.length > 0) || otherChar.sourceUrl) && (
                                                         <button onClick={() => {
                                                             if (window.confirm(`确定要从右侧卡片合并 QR、标签及来源链接配置吗？这会覆盖当前卡的 QR。`)) {
                                                                 if (onUpdate) {
                                                                     onUpdate({
                                                                         ...char,
                                                                         qrList: otherChar.qrList?.length ? otherChar.qrList : char.qrList,
                                                                         extra_qr_data: otherChar.extra_qr_data || char.extra_qr_data,
                                                                         qrFileName: otherChar.qrFileName || char.qrFileName,
                                                                         tags: Array.from(new Set([...(char.tags || []), ...(otherChar.tags || [])])),
                                                                         sourceUrl: otherChar.sourceUrl || char.sourceUrl
                                                                     });
                                                                     alert("扩展配置合并成功！");
                                                                 }
                                                             }
                                                         }} className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${theme === 'light' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300' : 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50 border-purple-800'}`} title="从右侧卡片合并配置 (QR、标签、来源链接)">
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
                    <AsyncAvatar 
                        charId={viewCharacter.id}
                        initialUrl={viewCharacter.avatarUrl}
                        alt={viewCharacter.name} 
                        className="w-32 h-48 object-cover rounded-xl shadow-lg shrink-0 bg-gray-900" 
                    />
                    <div className="flex-1 space-y-3 min-w-0">
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

                        <div className="flex flex-wrap gap-1.5 mt-2 overflow-hidden max-h-[48px]">
                            {viewCharacter.tags && viewCharacter.tags.length > 0 ? (
                                viewCharacter.tags.map((tag: string, i: number) => (
                                    <span key={i} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${theme === 'light' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                                        {tag}
                                    </span>
                                ))
                            ) : (
                                <span className="text-[10px] opacity-40 font-bold italic">未发现标签</span>
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

      {drawingCards.length > 0 && (
          <TarotCardDraw 
              characters={drawingCards} 
              onComplete={() => setDrawingCards([])} 
              onJump={(char) => {
                 onSelect(char);
                 setDrawingCards([]);
              }}
              onRedraw={() => {
                 const randomChar = characters[Math.floor(Math.random() * characters.length)];
                 setDrawingCards([randomChar]);
              }}
              theme={theme} 
          />
      )}

      {/* API Config Modal */}
      <ApiConfigModal 
        isOpen={showApiConfigModal}
        onClose={() => setShowApiConfigModal(false)}
        theme={theme}
      />

    </div>
  );
};

export default CharacterList;
