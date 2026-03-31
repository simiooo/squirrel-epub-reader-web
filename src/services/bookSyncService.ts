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
import { BaseCloudStorageConnector } from './baseCloudStorageConnector';
import type { Book, StoredCloudBook, StoredConnector, ConflictInfo } from '../types';
import type { CloudStorageConnector, CloudBookMetadata, SyncProgressResult, SyncBookmarkResult } from '../types/cloudStorage';

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
export function getConnectorInstance(connector: StoredConnector): CloudStorageConnector | null {
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

    // 准备基础元数据
    const metadata: CloudBookMetadata = {
      bookId,
      remotePath: '',
      metadataPath: '',
      size: book.file.size,
      checksum,
      remoteModifiedAt: new Date(),
      localModifiedAt: new Date(book.updatedAt),
      syncStatus: 'synced',
      version: 1,
    };

    // 准备完整元数据
    const fullMetadata = {
      bookId,
      metadata: book.metadata,
      bookPath: '',
      size: book.file.size,
      checksum,
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: book.updatedAt.toISOString(),
      version: 1,
      partsSyncStatus: {
        metadata: 'synced' as const,
        cover: book.cover ? 'synced' as const : 'missing' as const,
        book: 'synced' as const,
      },
    };

    // 转换封面为 Blob（如果有）
    let coverBlob: Blob | null = null;
    if (book.cover) {
      try {
        // base64 转换为 Blob
        const base64Data = book.cover.split(',')[1];
        if (base64Data) {
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          coverBlob = new Blob([byteArray], { type: 'image/jpeg' });
        }
      } catch (error) {
        console.warn('Failed to convert cover to blob:', error);
      }
    }

    // 使用新的分离存储方法上传
    const result = await connectorInstance.uploadBookWithParts(
      bookId,
      book.file,
      coverBlob,
      metadata,
      fullMetadata,
      book.format
    );

    onProgress?.({ stage: 'processing', progress: 80, message: '正在保存元数据...' });

    // 保存到本地数据库
    const cloudBook: StoredCloudBook = {
      id: generateUUID(),
      bookId,
      connectorId: connector.id,
      remotePath: result.remotePath,
      coverPath: result.coverPath,
      metadataPath: result.metadataPath,
      size: result.size,
      coverSize: result.coverSize,
      checksum: result.checksum,
      coverChecksum: result.coverChecksum,
      metadataChecksum: result.metadataChecksum,
      remoteModifiedAt: result.remoteModifiedAt.toISOString(),
      localModifiedAt: book.updatedAt.toISOString(),
      syncStatus: 'synced',
      version: result.version,
      metadata: book.metadata,
      cover: book.cover,
      cached: true,
      cachedAt: new Date().toISOString(),
      partsSyncStatus: result.partsSyncStatus || {
        metadata: 'synced',
        cover: book.cover ? 'synced' : 'missing',
        book: 'synced',
      },
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
      // 优先使用本地存储的 checksum，如果没有则重新计算
      const localChecksum = localBook.checksum || await generateChecksum(localBook.file);
      
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

    // 准备元数据对象
    const cloudMetadata: CloudBookMetadata = {
      bookId: cloudBook.bookId,
      remotePath: cloudBook.remotePath,
      coverPath: cloudBook.coverPath,
      metadataPath: cloudBook.metadataPath || `${connector.settings.rootPath || '/SquirrelReader'}/metadata/${cloudBook.bookId}.json`,
      size: cloudBook.size,
      coverSize: cloudBook.coverSize,
      checksum: cloudBook.checksum,
      coverChecksum: cloudBook.coverChecksum,
      metadataChecksum: cloudBook.metadataChecksum,
      remoteModifiedAt: new Date(cloudBook.remoteModifiedAt),
      localModifiedAt: new Date(cloudBook.localModifiedAt || cloudBook.remoteModifiedAt),
      syncStatus: 'synced',
      version: cloudBook.version,
      partsSyncStatus: cloudBook.partsSyncStatus,
    };

    // 检查云端各部分是否存在
    const partsExists = await connectorInstance.checkBookPartsExists(cloudMetadata);
    
    // 使用新的分离存储方法下载
    const { bookData, coverData, fullMetadata } = await connectorInstance.downloadBookWithParts(cloudMetadata);

    onProgress?.({ stage: 'processing', progress: 60, message: '正在验证数据完整性...' });

    // 验证书籍文件完整性
    const downloadedChecksum = await generateChecksum(bookData);
    if (downloadedChecksum !== cloudBook.checksum) {
      throw new Error('书籍文件校验失败，数据可能已损坏');
    }

    // 验证封面完整性（如果有）
    let coverBase64: string | undefined;
    if (coverData && cloudBook.coverChecksum) {
      const coverChecksum = await generateChecksum(coverData);
      if (coverChecksum !== cloudBook.coverChecksum) {
        console.warn('封面校验失败，将使用默认封面');
      } else {
        // 将封面 Blob 转换为 base64
        coverBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(coverData);
        });
      }
    }

    // 验证元信息完整性
    if (cloudBook.metadataChecksum) {
      const metadataBlob = new Blob([JSON.stringify(fullMetadata)]);
      const metadataChecksum = await generateChecksum(metadataBlob);
      if (metadataChecksum !== cloudBook.metadataChecksum) {
        console.warn('元信息校验失败');
      }
    }

    onProgress?.({ stage: 'processing', progress: 80, message: '正在保存到本地...' });

    // 优先使用云端元信息中的格式，否则根据 remotePath 判断
    const format: 'epub' | 'pdf' = fullMetadata.format 
      || (cloudBook.remotePath.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub');

    // 组装本地书籍对象，使用云端的完整元信息
    // 注意：downloadedChecksum 在上面已经计算过了
    const newBook: Book = {
      id: cloudBook.bookId,
      metadata: fullMetadata.metadata || cloudBook.metadata,
      cover: coverBase64 || cloudBook.cover,
      file: bookData,
      format,
      checksum: downloadedChecksum,
      addedAt: new Date(),
      updatedAt: new Date(),
    };

    await addBook(newBook);

    // 更新云端书籍状态和同步状态
    const updatedCloudBook: StoredCloudBook = {
      ...cloudBook,
      metadata: fullMetadata.metadata || cloudBook.metadata,
      cover: coverBase64 || cloudBook.cover,
      cached: true,
      cachedAt: new Date().toISOString(),
      partsSyncStatus: {
        metadata: partsExists.metadata ? 'synced' : 'missing',
        cover: partsExists.cover ? 'synced' : 'missing',
        book: partsExists.book ? 'synced' : 'missing',
      },
    };
    await updateCloudBook(updatedCloudBook);

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
      
      // 检查各部分是否存在
      let partsExists = { metadata: false, cover: false, book: false };
      try {
        partsExists = await connectorInstance.checkBookPartsExists(cloudBook);
      } catch (error) {
        console.warn(`Failed to check book parts for ${cloudBook.bookId}:`, error);
      }
      
      // 如果元信息存在，下载完整元信息
      let fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata | null = null;
      if (partsExists.metadata && cloudBook.metadataPath) {
        try {
          fullMetadata = await connectorInstance.downloadBookMetadata(cloudBook.metadataPath);
        } catch (error) {
          console.warn(`Failed to download metadata for ${cloudBook.bookId}:`, error);
        }
      }
      
      // 下载封面（如果存在且本地没有）
      let coverBase64: string | undefined = existing?.cover;
      if (partsExists.cover && cloudBook.coverPath && !existing?.cover) {
        try {
          const coverBlob = await connectorInstance.downloadBook(cloudBook.coverPath);
          coverBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(coverBlob);
          });
        } catch (error) {
          console.warn(`Failed to download cover for ${cloudBook.bookId}:`, error);
        }
      }
      
      const storedBook: StoredCloudBook = {
        id: existing?.id || generateUUID(),
        bookId: cloudBook.bookId,
        connectorId: connector.id,
        remotePath: cloudBook.remotePath,
        coverPath: cloudBook.coverPath,
        metadataPath: cloudBook.metadataPath,
        size: cloudBook.size,
        coverSize: cloudBook.coverSize,
        checksum: cloudBook.checksum,
        coverChecksum: cloudBook.coverChecksum,
        metadataChecksum: cloudBook.metadataChecksum,
        remoteModifiedAt: cloudBook.remoteModifiedAt.toISOString(),
        localModifiedAt: existing?.localModifiedAt || cloudBook.remoteModifiedAt.toISOString(),
        syncStatus: cloudBook.syncStatus,
        version: cloudBook.version,
        metadata: fullMetadata?.metadata || existing?.metadata || { title: 'Unknown', author: 'Unknown' },
        cover: coverBase64 || existing?.cover,
        cached: existing?.cached || false,
        cachedAt: existing?.cachedAt,
        partsSyncStatus: cloudBook.partsSyncStatus || {
          metadata: partsExists.metadata ? 'synced' : 'missing',
          cover: partsExists.cover ? 'synced' : 'missing',
          book: partsExists.book ? 'synced' : 'missing',
        },
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

export interface PartialSyncResult {
  success: boolean;
  syncedParts: {
    metadata: boolean;
    cover: boolean;
    book: boolean;
  };
  error?: string;
}

/**
 * 同步云端书籍的缺失部分
 * 用于处理只同步了部分信息的书籍，进行完整同步
 */
export async function syncCloudBookParts(
  cloudBook: StoredCloudBook,
  connector: StoredConnector,
  options: {
    syncMetadata?: boolean;
    syncCover?: boolean;
    syncBook?: boolean;
  } = {},
  onProgress?: ProgressCallback
): Promise<PartialSyncResult> {
  const { syncMetadata = true, syncCover = true, syncBook = false } = options;

  try {
    onProgress?.({ stage: 'preparing', progress: 0, message: '正在检查同步状态...' });

    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      return { success: false, syncedParts: { metadata: false, cover: false, book: false }, error: '无法创建连接器实例' };
    }

    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      return { success: false, syncedParts: { metadata: false, cover: false, book: false }, error: '连接器未认证' };
    }

    // 准备元数据对象
    const cloudMetadata: CloudBookMetadata = {
      bookId: cloudBook.bookId,
      remotePath: cloudBook.remotePath,
      coverPath: cloudBook.coverPath,
      metadataPath: cloudBook.metadataPath || `${connector.settings.rootPath || '/SquirrelReader'}/metadata/${cloudBook.bookId}.json`,
      size: cloudBook.size,
      coverSize: cloudBook.coverSize,
      checksum: cloudBook.checksum,
      coverChecksum: cloudBook.coverChecksum,
      metadataChecksum: cloudBook.metadataChecksum,
      remoteModifiedAt: new Date(cloudBook.remoteModifiedAt),
      localModifiedAt: new Date(cloudBook.localModifiedAt || cloudBook.remoteModifiedAt),
      syncStatus: 'synced',
      version: cloudBook.version,
      partsSyncStatus: cloudBook.partsSyncStatus,
    };

    // 检查云端各部分是否存在
    const partsExists = await connectorInstance.checkBookPartsExists(cloudMetadata);
    const syncedParts = {
      metadata: false,
      cover: false,
      book: false,
    };

    let updatedMetadata = { ...cloudBook.metadata };
    let updatedCover = cloudBook.cover;
    let updatedPartsSyncStatus: { metadata: 'synced' | 'pending' | 'missing'; cover: 'synced' | 'pending' | 'missing'; book: 'synced' | 'pending' | 'missing' } = {
      metadata: (cloudBook.partsSyncStatus?.metadata || 'missing') as 'synced' | 'pending' | 'missing',
      cover: (cloudBook.partsSyncStatus?.cover || 'missing') as 'synced' | 'pending' | 'missing',
      book: (cloudBook.partsSyncStatus?.book || 'missing') as 'synced' | 'pending' | 'missing',
    };

    // 同步元信息
    if (syncMetadata && partsExists.metadata && cloudMetadata.metadataPath) {
      onProgress?.({ stage: 'downloading', progress: 30, message: '正在同步元信息...' });
      try {
        const fullMetadata = await connectorInstance.downloadBookMetadata(cloudMetadata.metadataPath);
        updatedMetadata = fullMetadata.metadata || cloudBook.metadata;
        syncedParts.metadata = true;
        updatedPartsSyncStatus = { ...updatedPartsSyncStatus, metadata: 'synced' };
      } catch (error) {
        console.warn(`Failed to sync metadata for ${cloudBook.bookId}:`, error);
      }
    }

    // 同步封面
    if (syncCover && partsExists.cover && cloudMetadata.coverPath && !cloudBook.cover) {
      onProgress?.({ stage: 'downloading', progress: 60, message: '正在同步封面...' });
      try {
        const coverBlob = await connectorInstance.downloadBook(cloudMetadata.coverPath);
        const coverBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(coverBlob);
        });
        updatedCover = coverBase64;
        syncedParts.cover = true;
        updatedPartsSyncStatus = { ...updatedPartsSyncStatus, cover: 'synced' };
      } catch (error) {
        console.warn(`Failed to sync cover for ${cloudBook.bookId}:`, error);
      }
    }

    // 同步书籍文件（通常不需要，除非用户明确要求）
    if (syncBook && partsExists.book) {
      onProgress?.({ stage: 'downloading', progress: 90, message: '正在同步书籍文件...' });
      try {
        const bookData = await connectorInstance.downloadBook(cloudMetadata.remotePath);
        // 验证校验和
        const downloadedChecksum = await generateChecksum(bookData);
        if (downloadedChecksum === cloudBook.checksum) {
          syncedParts.book = true;
          updatedPartsSyncStatus = { ...updatedPartsSyncStatus, book: 'synced' };
        }
      } catch (error) {
        console.warn(`Failed to sync book for ${cloudBook.bookId}:`, error);
      }
    }

    // 更新本地云端记录
    onProgress?.({ stage: 'processing', progress: 95, message: '正在更新本地记录...' });
    await updateCloudBook({
      ...cloudBook,
      metadata: updatedMetadata,
      cover: updatedCover,
      partsSyncStatus: updatedPartsSyncStatus,
    });

    onProgress?.({ stage: 'completed', progress: 100, message: '同步完成' });

    return {
      success: syncedParts.metadata || syncedParts.cover || syncedParts.book,
      syncedParts,
    };
  } catch (error) {
    onProgress?.({ stage: 'error', progress: 0, message: '同步失败' });
    return {
      success: false,
      syncedParts: { metadata: false, cover: false, book: false },
      error: error instanceof Error ? error.message : '同步失败',
    };
  }
}

/**
 * 同步单本书的阅读进度
 */
export async function syncProgress(
  bookId: string,
  connector: StoredConnector
): Promise<SyncProgressResult> {
  try {
    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      return { success: false, strategy: 'merge' };
    }

    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      return { success: false, strategy: 'merge' };
    }

    await connectorInstance.syncBookProgress(bookId);

    return { success: true, strategy: 'merge' };
  } catch (error) {
    console.error(`Failed to sync progress for book ${bookId}:`, error);
    return { success: false, strategy: 'merge' };
  }
}

/**
 * 同步单本书的书签
 */
export async function syncBookmarks(
  bookId: string,
  connector: StoredConnector
): Promise<SyncBookmarkResult> {
  try {
    const connectorInstance = getConnectorInstance(connector);
    if (!connectorInstance) {
      return { success: false, added: 0, removed: 0, merged: 0 };
    }

    if (connectorInstance.getAuthStatus() !== 'authenticated') {
      return { success: false, added: 0, removed: 0, merged: 0 };
    }

    await connectorInstance.syncBookBookmarks(bookId);

    return { success: true, added: 0, removed: 0, merged: 0 };
  } catch (error) {
    console.error(`Failed to sync bookmarks for book ${bookId}:`, error);
    return { success: false, added: 0, removed: 0, merged: 0 };
  }
}