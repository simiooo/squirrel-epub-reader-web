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
  autoSync: boolean;
  syncInterval?: number;
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
  size: number;
  checksum: string;
  remoteModifiedAt: string;
  localModifiedAt?: string;
  syncStatus: string;
  version: number;
  metadata: BookMetadata;
  cover?: string;
  cached?: boolean;
  cachedAt?: string;
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
