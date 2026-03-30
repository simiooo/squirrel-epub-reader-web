import Dexie, { type Table } from 'dexie';
import type { Book, ReadingProgress, Bookmark, StoredConnector, StoredCloudBook, SyncRecord } from '../types';

export class EpubDatabase extends Dexie {
  books!: Table<Book, string>;
  progress!: Table<ReadingProgress, string>;
  bookmarks!: Table<Bookmark, string>;
  modelCache!: Table<{ key: string; data: Blob; mimeType: string; cachedAt: number }, string>;
  connectors!: Table<StoredConnector, string>;
  cloudBooks!: Table<StoredCloudBook, string>;
  syncRecords!: Table<SyncRecord, string>;

  constructor() {
    super('EpubReaderDB');
    this.version(4).stores({
      books: 'id, &metadata.identifier, addedAt',
      progress: 'bookId',
      bookmarks: 'id, bookId, chapterId, createdAt',
      modelCache: 'key',
      connectors: 'id, type, createdAt',
      cloudBooks: 'id, bookId, connectorId, &remotePath, syncStatus, cachedAt',
      syncRecords: 'id, bookId, connectorId, status, timestamp',
    }).upgrade(tx => {
      // 升级：移除 connectors 表中的 autoSync 和 syncInterval 字段
      return tx.table('connectors').toCollection().modify(connector => {
        delete (connector as Record<string, unknown>).autoSync;
        delete (connector as Record<string, unknown>).syncInterval;
      });
    });
    
    this.version(5).stores({
      cloudBooks: 'id, bookId, connectorId, &remotePath, checksum, syncStatus, cachedAt',
    });
  }
}

export const db = new EpubDatabase();

// Book operations
export async function addBook(book: Book): Promise<string> {
  const id = await db.books.add(book);
  return id as string;
}

export async function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id);
}

export async function getAllBooks(): Promise<Book[]> {
  return db.books.orderBy('addedAt').reverse().toArray();
}

export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', db.books, db.progress, db.bookmarks, db.cloudBooks, async () => {
    // 删除本地书籍前，先更新云端书籍的缓存状态
    const cloudBook = await db.cloudBooks.where('bookId').equals(id).first();
    if (cloudBook) {
      cloudBook.cached = false;
      cloudBook.cachedAt = new Date().toISOString();
      await db.cloudBooks.put(cloudBook);
    }
    
    await db.books.delete(id);
    await db.progress.delete(id);
    await db.bookmarks.where('bookId').equals(id).delete();
  });
}

export async function updateBook(book: Book): Promise<void> {
  await db.books.put(book);
}

// Reading progress operations
export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await db.progress.put(progress);
}

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  return db.progress.get(bookId);
}

// Bookmark operations
export async function addBookmark(bookmark: Bookmark): Promise<string> {
  const id = await db.bookmarks.add(bookmark);
  return id as string;
}

export async function getBookmarks(bookId: string): Promise<Bookmark[]> {
  return db.bookmarks.where('bookId').equals(bookId).sortBy('createdAt');
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

export async function deleteBookmarkByPosition(
  bookId: string,
  chapterId: string,
  position: number
): Promise<void> {
  await db.bookmarks
    .where({ bookId, chapterId, position })
    .delete();
}

const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export async function getCachedModel(key: string): Promise<Blob | null> {
  const cached = await db.modelCache.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.cachedAt > CACHE_EXPIRY) {
    await db.modelCache.delete(key);
    return null;
  }
  
  return cached.data;
}

export async function cacheModel(key: string, data: Blob, mimeType: string): Promise<void> {
  await db.modelCache.put({
    key,
    data,
    mimeType,
    cachedAt: Date.now(),
  });
}

export async function loadCachedModel(key: string, url: string): Promise<string> {
  const cached = await getCachedModel(key);
  
  if (cached) {
    return URL.createObjectURL(cached);
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  
  const blob = await response.blob();
  await cacheModel(key, blob, blob.type);
  
  return URL.createObjectURL(blob);
}

// ==================== Connector Operations ====================

export async function addConnector(connector: StoredConnector): Promise<string> {
  const id = await db.connectors.add(connector);
  return id as string;
}

export async function getConnector(id: string): Promise<StoredConnector | undefined> {
  return db.connectors.get(id);
}

export async function getAllConnectors(): Promise<StoredConnector[]> {
  return db.connectors.toArray();
}

export async function updateConnector(connector: StoredConnector): Promise<void> {
  await db.connectors.put(connector);
}

export async function deleteConnector(id: string): Promise<void> {
  await db.transaction('rw', db.connectors, db.cloudBooks, db.syncRecords, async () => {
    await db.connectors.delete(id);
    await db.cloudBooks.where('connectorId').equals(id).delete();
    await db.syncRecords.where('connectorId').equals(id).delete();
  });
}

// ==================== Cloud Book Operations ====================

export async function addCloudBook(cloudBook: StoredCloudBook): Promise<string> {
  const id = await db.cloudBooks.add(cloudBook);
  return id as string;
}

export async function getCloudBook(id: string): Promise<StoredCloudBook | undefined> {
  return db.cloudBooks.get(id);
}

export async function getCloudBooksByConnector(connectorId: string): Promise<StoredCloudBook[]> {
  return db.cloudBooks.where('connectorId').equals(connectorId).toArray();
}

export async function getAllCloudBooks(): Promise<StoredCloudBook[]> {
  return db.cloudBooks.toArray();
}

export async function updateCloudBook(cloudBook: StoredCloudBook): Promise<void> {
  await db.cloudBooks.put(cloudBook);
}

export async function deleteCloudBook(id: string): Promise<void> {
  await db.cloudBooks.delete(id);
}

export async function findCloudBookByChecksum(checksum: string): Promise<StoredCloudBook | undefined> {
  return db.cloudBooks.where('checksum').equals(checksum).first();
}

export async function findCloudBookByBookId(bookId: string): Promise<StoredCloudBook | undefined> {
  return db.cloudBooks.where('bookId').equals(bookId).first();
}

// ==================== Sync Record Operations ====================

export async function addSyncRecord(record: SyncRecord): Promise<string> {
  const id = await db.syncRecords.add(record);
  return id as string;
}

export async function getSyncRecordsByBook(bookId: string): Promise<SyncRecord[]> {
  return db.syncRecords.where('bookId').equals(bookId).sortBy('timestamp');
}

export async function getPendingSyncRecords(): Promise<SyncRecord[]> {
  return db.syncRecords.where('status').equals('pending').toArray();
}

export async function updateSyncRecord(record: SyncRecord): Promise<void> {
  await db.syncRecords.put(record);
}

export async function deleteSyncRecord(id: string): Promise<void> {
  await db.syncRecords.delete(id);
}
