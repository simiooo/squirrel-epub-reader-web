/**
 * 书籍同步服务
 * 
 * 处理本地书籍上传到云端、云端书籍下载到本地，以及冲突管理
 */

import { db, getBook, addBook, getCloudBooksByConnector, addCloudBook, updateCloudBook, deleteCloudBook, findCloudBookByChecksum } from '../db';
import { generateBookId, generateChecksum } from '../utils/bookHash';
import { S3Connector } from './connectors/s3Connector';
import { DropboxConnector } from './connectors/dropboxConnector';
import { GoogleDriveConnector } from './connectors/googleDriveConnector';
import type { Book, StoredCloudBook, StoredConnector, ConflictInfo } from '../types';
import type { CloudStorageConnector, CloudBookMetadata } from '../types/cloudStorage';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface UploadResult {
  success: boolean;
  conflict?: ConflictInfo;
  cloudBook?: StoredCloudBook;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  conflict?: ConflictInfo;
  book?: Book;
  error?: string;
}

export interface SyncProgress {
  stage: 'preparing' | 'uploading' | 'downloading' | 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: SyncProgress) => void;

/**
 * 获取连接器实例
 */
function getConnectorInstance(connector: StoredConnector): CloudStorageConnector | null {
  const config = {
    id: connector.id,
    name: connector.name,
    type: connector.type,
    settings: connector.settings,
    createdAt: new Date(connector.createdAt),
  };

  switch (connector.type) {
    case 's3':
      return new S3Connector(config);
    case 'dropbox':
      return new DropboxConnector(config);
    case 'googledrive':
      return new GoogleDriveConnector(config);
    default:
      console.error(`Unknown connector type: ${connector.type}`);
      return null;
  }
}

/**
 * 上传书籍到云端
 */
export async function uploadBookToCloud(
  book: Book,
  connector: StoredConnector,
  onProgress?: ProgressCallback,
  _onConflict?: (conflict: ConflictInfo) => Promise<'local' | 'remote' | 'skip'>
): Promise<UploadResult> {
  try {
    onProgress?.({ stage: 'preparing', progress: 0, message: '正在准备上传...' });

    // 生成书籍哈希
    const checksum = await generateChecksum(book.file);
    const bookId = await generateBookId(book.file, book.metadata);

    // 检查云端是否已存在相同书籍
    const existingCloudBook = await findCloudBookByChecksum(checksum);
    if (existingCloudBook && existingCloudBook.connectorId === connector.id) {
      return {
        success: false,
        error: '该书籍已存在于该云存储中',
      };
    }

    // 获取连接器实例
    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      return { success: false, error: '无法创建连接器实例' };
    }

    // 检查认证状态
    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      return { success: false, error: '连接器未认证，请先完成认证' };
    }

    onProgress?.({ stage: 'uploading', progress: 20, message: '正在上传书籍...' });

    // 准备元数据
    const metadata: CloudBookMetadata = {
      bookId,
      remotePath: '',
      size: book.file.size,
      checksum,
      remoteModifiedAt: new Date(),
      localModifiedAt: new Date(book.updatedAt),
      syncStatus: 'synced',
      version: 1,
    };

    // 上传书籍
    const result = await connectorInstance.uploadBook(bookId, book.file, metadata);

    onProgress?.({ stage: 'processing', progress: 80, message: '正在保存元数据...' });

    // 保存到本地数据库
    const cloudBook: StoredCloudBook = {
      id: generateUUID(),
      bookId,
      connectorId: connector.id,
      remotePath: result.remotePath,
      size: result.size,
      checksum: result.checksum,
      remoteModifiedAt: result.remoteModifiedAt.toISOString(),
      localModifiedAt: book.updatedAt.toISOString(),
      syncStatus: 'synced',
      version: result.version,
      metadata: book.metadata,
      cover: book.cover,
      cached: true,
      cachedAt: new Date().toISOString(),
    };

    await addCloudBook(cloudBook);

    onProgress?.({ stage: 'completed', progress: 100, message: '上传完成' });

    return { success: true, cloudBook };
  } catch (error) {
    onProgress?.({ stage: 'error', progress: 0, message: '上传失败' });
    return {
      success: false,
      error: error instanceof Error ? error.message : '上传失败',
    };
  }
}

/**
 * 从云端下载书籍到本地
 */
export async function downloadBookFromCloud(
  cloudBook: StoredCloudBook,
  connector: StoredConnector,
  onProgress?: ProgressCallback,
  onConflict?: (conflict: ConflictInfo) => Promise<'local' | 'remote' | 'skip'>
): Promise<DownloadResult> {
  try {
    onProgress?.({ stage: 'preparing', progress: 0, message: '正在准备下载...' });

    // 检查本地是否已存在相同书籍（通过checksum）
    const existingBooks = await db.books.toArray();
    const localBook = existingBooks.find(b => b.id === cloudBook.bookId);

    if (localBook) {
      // 本地已存在，检查是否有冲突
      const localChecksum = await generateChecksum(localBook.file);
      
      if (localChecksum !== cloudBook.checksum) {
        // 存在冲突
        const conflict: ConflictInfo = {
          bookId: cloudBook.bookId,
          connectorId: cloudBook.connectorId,
          localChecksum,
          remoteChecksum: cloudBook.checksum,
          localModifiedAt: new Date(localBook.updatedAt),
          remoteModifiedAt: new Date(cloudBook.remoteModifiedAt),
          localSize: localBook.file.size,
          remoteSize: cloudBook.size,
        };

        if (onConflict) {
          const resolution = await onConflict(conflict);
          
          if (resolution === 'skip') {
            return { success: false, error: '用户取消下载' };
          }
          
          if (resolution === 'local') {
            // 保留本地版本，更新云端状态
            await updateCloudBook({
              ...cloudBook,
              cached: true,
              cachedAt: new Date().toISOString(),
            });
            return { success: true, book: localBook };
          }
          // resolution === 'remote' 继续下载覆盖本地
        } else {
          return { success: false, conflict, error: '存在冲突，需要用户选择' };
        }
      } else {
        // 内容相同，直接返回本地书籍
        await updateCloudBook({
          ...cloudBook,
          cached: true,
          cachedAt: new Date().toISOString(),
        });
        return { success: true, book: localBook };
      }
    }

    // 获取连接器实例
    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      return { success: false, error: '无法创建连接器实例' };
    }

    // 检查认证状态
    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      return { success: false, error: '连接器未认证，请先完成认证' };
    }

    onProgress?.({ stage: 'downloading', progress: 20, message: '正在下载书籍...' });

    // 下载书籍文件
    const file = await connectorInstance.downloadBook(cloudBook.remotePath);

    onProgress?.({ stage: 'processing', progress: 80, message: '正在保存到本地...' });

    // 保存到本地数据库
    const newBook: Book = {
      id: cloudBook.bookId,
      metadata: cloudBook.metadata,
      cover: cloudBook.cover,
      file,
      addedAt: new Date(),
      updatedAt: new Date(),
    };

    await addBook(newBook);

    // 更新云端书籍状态
    await updateCloudBook({
      ...cloudBook,
      cached: true,
      cachedAt: new Date().toISOString(),
    });

    onProgress?.({ stage: 'completed', progress: 100, message: '下载完成' });

    return { success: true, book: newBook };
  } catch (error) {
    onProgress?.({ stage: 'error', progress: 0, message: '下载失败' });
    return {
      success: false,
      error: error instanceof Error ? error.message : '下载失败',
    };
  }
}

/**
 * 刷新云端书籍列表
 */
export async function refreshCloudBooks(
  connector: StoredConnector,
  onProgress?: ProgressCallback
): Promise<StoredCloudBook[]> {
  try {
    onProgress?.({ stage: 'preparing', progress: 0, message: '正在获取云端书籍列表...' });

    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      throw new Error('无法创建连接器实例');
    }

    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      throw new Error('连接器未认证');
    }

    onProgress?.({ stage: 'downloading', progress: 30, message: '正在获取书籍列表...' });

    // 获取云端书籍列表
    const cloudBooks = await connectorInstance.listBooks();

    onProgress?.({ stage: 'processing', progress: 60, message: '正在更新本地缓存...' });

    // 获取本地已有的云端书籍
    const existingBooks = await getCloudBooksByConnector(connector.id);
    const existingMap = new Map(existingBooks.map(b => [b.bookId, b]));

    // 更新或添加云端书籍
    const updatedBooks: StoredCloudBook[] = [];
    
    for (const cloudBook of cloudBooks) {
      const existing = existingMap.get(cloudBook.bookId);
      
      const storedBook: StoredCloudBook = {
        id: existing?.id || generateUUID(),
        bookId: cloudBook.bookId,
        connectorId: connector.id,
        remotePath: cloudBook.remotePath,
        size: cloudBook.size,
        checksum: cloudBook.checksum,
        remoteModifiedAt: cloudBook.remoteModifiedAt.toISOString(),
        localModifiedAt: existing?.localModifiedAt || cloudBook.remoteModifiedAt.toISOString(),
        syncStatus: cloudBook.syncStatus,
        version: cloudBook.version,
        metadata: existing?.metadata || { title: 'Unknown', author: 'Unknown' },
        cover: existing?.cover,
        cached: existing?.cached || false,
        cachedAt: existing?.cachedAt,
      };

      if (existing) {
        await updateCloudBook(storedBook);
      } else {
        await addCloudBook(storedBook);
      }
      
      updatedBooks.push(storedBook);
    }

    // 删除云端已不存在的书籍（仅删除本地记录）
    const cloudBookIds = new Set(cloudBooks.map(b => b.bookId));
    for (const existing of existingBooks) {
      if (!cloudBookIds.has(existing.bookId)) {
        await deleteCloudBook(existing.id);
      }
    }

    onProgress?.({ stage: 'completed', progress: 100, message: '刷新完成' });

    return updatedBooks;
  } catch (error) {
    onProgress?.({ stage: 'error', progress: 0, message: '刷新失败' });
    throw error;
  }
}

/**
 * 检查书籍同步状态
 */
export async function checkBookSyncStatus(bookId: string): Promise<{
  isLocal: boolean;
  isCloud: boolean;
  cloudConnectors: StoredConnector[];
}> {
  const localBook = await getBook(bookId);
  const allConnectors = await db.connectors.toArray();
  const authenticatedConnectors = allConnectors.filter(c => c.authStatus === 'authenticated');
  
  const cloudConnectors: StoredConnector[] = [];
  
  for (const connector of authenticatedConnectors) {
    const cloudBooks = await getCloudBooksByConnector(connector.id);
    const exists = cloudBooks.some(b => b.bookId === bookId);
    if (exists) {
      cloudConnectors.push(connector);
    }
  }

  return {
    isLocal: !!localBook,
    isCloud: cloudConnectors.length > 0,
    cloudConnectors,
  };
}

/**
 * 批量同步所有云端书籍信息
 */
export async function syncAllCloudBooks(
  onProgress?: (connectorName: string, progress: SyncProgress) => void
): Promise<void> {
  const connectors = await db.connectors.where('authStatus').equals('authenticated').toArray();
  
  for (const connector of connectors) {
    try {
      await refreshCloudBooks(connector, (progress) => {
        onProgress?.(connector.name, progress);
      });
    } catch (error) {
      console.error(`Failed to sync connector ${connector.name}:`, error);
    }
  }
}