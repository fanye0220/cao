
export interface QrItem {
  id: number;
  label: string;
  message: string;
  preventAutoExecute?: boolean;
  showLabel?: boolean;
  title?: string;
  contextList?: any[];
  isHidden?: boolean;
  executeOnStartup?: boolean;
  executeOnUser?: boolean;
  executeOnAi?: boolean;
  executeOnChatChange?: boolean;
  executeOnGroupMemberDraft?: boolean;
  executeOnNewChat?: boolean;
  automationId?: string;
  [key: string]: any;
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  enabled?: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  entries: CharacterBookEntry[];
}

export interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  firstMessage: string;
  alternate_greetings?: string[];
  avatarUrl: string;
  scenario?: string;
  character_book?: CharacterBook;
  tags?: string[];
  qrList?: QrItem[];
  originalFilename?: string;
  sourceUrl?: string;
  cardUrl?: string;
  creator_notes?: string;
  importDate?: number;
  extra_qr_data?: any;         // 原始QR文件完整数据（含idIndex等所有字段）
  _rawCardData?: any;          // 导入时的原始完整卡片数据，导出时用于精确还原
  qrFileName?: string;
  isFavorite?: boolean;
  folder?: string;
  importFormat?: 'png' | 'json' | 'unknown';
  updatedAt?: number;
  fileLastModified?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export type ViewMode = 'list' | 'edit';
export type Theme = 'dark' | 'light';
