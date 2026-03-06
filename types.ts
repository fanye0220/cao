
export interface QrItem {
  id: number;
  label: string;
  message: string;
  preventAutoExecute?: boolean;
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
  alternate_greetings?: string[]; // Added: Alternate greetings support
  avatarUrl: string;
  scenario?: string;
  character_book?: CharacterBook;
  tags?: string[]; // Added: Tags support
  qrList?: QrItem[];
  originalFilename?: string;
  sourceUrl?: string;
  cardUrl?: string;
  creator_notes?: string;
  importDate?: number;
  extra_qr_data?: any; // Store full QR JSON object for export
  qrFileName?: string;
  isFavorite?: boolean;
  folder?: string;
  importFormat?: 'png' | 'json' | 'unknown';
  updatedAt?: number;
  fileLastModified?: number; // 文件的真实修改时间（来自file.lastModified）
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export type ViewMode = 'list' | 'edit';
export type Theme = 'dark' | 'light';
