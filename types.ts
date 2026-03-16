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
  alternate_greetings?: string[];
  avatarUrl: string;
  scenario?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  creator?: string;
  character_version?: string;
  extensions?: any;
  character_book?: CharacterBook;
  tags?: string[];
  qrList?: QrItem[];
  originalFilename?: string;
  sourceUrl?: string;
  cardUrl?: string;
  importDate?: number;
  fileLastModified?: number;
  extra_qr_data?: any;
  qrFileName?: string;
  isFavorite?: boolean;
  folder?: string;
  importFormat?: 'png' | 'json' | 'unknown';
  updatedAt?: number;
}

export type ViewMode = 'list' | 'edit';
export type Theme = 'dark' | 'light';
