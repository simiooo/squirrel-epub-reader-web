import Dexie, { type Table } from 'dexie';
import type { Book, ReadingProgress, Bookmark } from '../types';

export class EpubDatabase extends Dexie {
  books!: Table<Book, string>;
  progress!: Table<ReadingProgress, string>;
  bookmarks!: Table<Bookmark, string>;
  modelCache!: Table<{ key: string; data: Blob; mimeType: string; cachedAt: number }, string>;

  constructor() {
    super('EpubReaderDB');
    this.version(2).stores({
      books: 'id, &metadata.identifier, addedAt',
      progress: 'bookId',
      bookmarks: 'id, bookId, chapterId, createdAt',
      modelCache: 'key',
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
  await db.transaction('rw', db.books, db.progress, db.bookmarks, async () => {
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
