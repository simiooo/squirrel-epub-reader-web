export interface BookMetadata {
  title: string;
  author: string;
  description?: string;
  language?: string;
  publisher?: string;
  publicationDate?: string;
  identifier?: string;
}

export interface Chapter {
  id: string;
  title: string;
  href: string;
  level: number;
  children?: Chapter[];
}

export interface Book {
  id: string;
  metadata: BookMetadata;
  cover?: string;
  file: Blob;
  /** 书籍格式：epub 或 pdf */
  format?: 'epub' | 'pdf';
  /** 文件 SHA-256 校验和，用于唯一性校验 */
  checksum: string;
  addedAt: Date;
  updatedAt: Date;
}

export interface ReadingProgress {
  bookId: string;
  currentChapter: string;
  currentPosition: number;
  lastReadAt: Date;
  totalProgress: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  position: number;
  text: string;
  createdAt: Date;
}

export interface ParsedChapter {
  id: string;
  title: string;
  href: string;
  level: number;
  content: string;
}

export interface ParsedEpub {
  metadata: BookMetadata;
  cover?: string;
  tableOfContents: Chapter[];
  chapters: ParsedChapter[];
}

export interface EpubImage {
  id: string;
  path: string;
  blob: Blob;
  mimeType: string;
}

export interface StoredConnector {
  id: string;
  name: string;
  type: string;
  settings: Record<string, unknown>;
  lastSyncAt?: string;
  createdAt: string;
  authStatus?: string;
  authToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface StoredCloudBook {
  id: string;
  bookId: string;
  connectorId: string;
  remotePath: string;
  /** 封面在云端的路径 */
  coverPath?: string;
  /** 元信息在云端的路径 */
  metadataPath?: string;
  size: number;
  /** 封面大小（字节） */
  coverSize?: number;
  checksum: string;
  /** 封面校验和 */
  coverChecksum?: string;
  /** 元信息校验和 */
  metadataChecksum?: string;
  remoteModifiedAt: string;
  localModifiedAt?: string;
  syncStatus: string;
  version: number;
  metadata: BookMetadata;
  cover?: string;
  cached?: boolean;
  cachedAt?: string;
  /** 各部分同步状态 */
  partsSyncStatus?: {
    metadata: 'synced' | 'pending' | 'missing';
    cover: 'synced' | 'pending' | 'missing';
    book: 'synced' | 'pending' | 'missing';
  };
}

export interface SyncRecord {
  id: string;
  bookId: string;
  connectorId: string;
  action: 'upload' | 'download' | 'delete';
  status: 'pending' | 'completed' | 'failed' | 'conflict';
  timestamp: string;
  conflictData?: unknown;
  errorMessage?: string;
}

export interface ConflictInfo {
  bookId: string;
  connectorId: string;
  localChecksum: string;
  remoteChecksum: string;
  localModifiedAt: Date;
  remoteModifiedAt: Date;
  localSize: number;
  remoteSize: number;
}
