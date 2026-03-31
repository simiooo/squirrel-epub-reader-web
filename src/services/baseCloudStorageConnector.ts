import type {
  CloudStorageConnector,
  ConnectorConfig,
  CloudBookMetadata,
  CloudReadingProgress,
  CloudBookmark,
  SyncResult,
  SyncOptions,
  SyncConflict,
  AuthStatus,
} from '../types/cloudStorage';

/**
 * 云存储连接器抽象基类
 * 
 * 提供了通用的连接器功能实现，具体云存储服务可以继承此类
 */
export abstract class BaseCloudStorageConnector implements CloudStorageConnector {
  abstract readonly type: string;
  abstract readonly displayName: string;
  
  config: ConnectorConfig;
  
  protected authStatus: AuthStatus = 'unauthenticated';
  protected authListeners = new Set<(status: AuthStatus) => void>();
  protected syncProgressListeners = new Set<(progress: number, message: string) => void>();

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  // ==================== 认证相关（抽象方法）====================
  
  abstract authenticate(): Promise<boolean>;
  abstract handleAuthCallback(callbackData: Record<string, string>): Promise<boolean>;
  abstract refreshToken(): Promise<boolean>;
  abstract logout(): Promise<void>;

  // ==================== 连接管理（抽象方法）====================
  
  abstract testConnection(): Promise<{ success: boolean; message?: string }>;

  // ==================== 书籍操作（抽象方法）====================
  
  abstract uploadBookWithParts(
    bookId: string,
    bookData: Blob,
    coverData: Blob | null,
    metadata: CloudBookMetadata,
    fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata,
    format?: 'epub' | 'pdf'
  ): Promise<CloudBookMetadata>;
  
  abstract uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata>;
  
  abstract downloadBookWithParts(metadata: CloudBookMetadata): Promise<{
    bookData: Blob;
    coverData: Blob | null;
    fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata;
  }>;
  
  abstract downloadBook(remotePath: string): Promise<Blob>;
  
  abstract deleteBook(paths: {
    remotePath: string;
    coverPath?: string;
    metadataPath?: string;
  }): Promise<void>;
  
  abstract listBooks(): Promise<CloudBookMetadata[]>;
  
  abstract downloadBookMetadata(metadataPath: string): Promise<import('../types/cloudStorage').CloudBookFullMetadata>;
  
  abstract checkBookPartsExists(metadata: CloudBookMetadata): Promise<{
    metadata: boolean;
    cover: boolean;
    book: boolean;
  }>;
  
  abstract bookExists(remotePath: string): Promise<boolean>;

  // ==================== 阅读进度操作（抽象方法）====================
  
  abstract uploadProgress(
    bookId: string,
    progress: CloudReadingProgress
  ): Promise<void>;
  
  abstract downloadProgress(bookId: string): Promise<CloudReadingProgress | null>;
  
  abstract listAllProgress(): Promise<CloudReadingProgress[]>;

  // ==================== 书签操作（抽象方法）====================
  
  abstract uploadBookmarks(
    bookId: string,
    bookmarks: CloudBookmark[]
  ): Promise<void>;
  
  abstract downloadBookmarks(bookId: string): Promise<CloudBookmark[]>;
  
  abstract deleteBookmark(bookId: string, bookmarkId: string): Promise<void>;

  // ==================== 同步操作（默认实现，可覆盖）====================
  
  async sync(options?: SyncOptions): Promise<SyncResult> {
    const opts = {
      syncBooks: true,
      syncProgress: true,
      syncBookmarks: true,
      conflictStrategy: 'newest_wins' as const,
      ...options,
    };

    const result: SyncResult = {
      success: true,
      timestamp: new Date(),
      booksUpdated: 0,
      progressUpdated: 0,
      bookmarksUpdated: 0,
      conflicts: [],
      errors: [],
    };

    try {
      // 1. 同步书籍
      if (opts.syncBooks) {
        this.emitSyncProgress(10, '正在同步书籍...');
        const bookResult = await this.syncBooks(opts);
        result.booksUpdated = bookResult.updated;
        result.conflicts.push(...bookResult.conflicts);
      }

      // 2. 同步阅读进度
      if (opts.syncProgress) {
        this.emitSyncProgress(50, '正在同步阅读进度...');
        const progressResult = await this.syncAllProgressData(opts);
        result.progressUpdated = progressResult.updated;
        result.conflicts.push(...progressResult.conflicts);
      }

      // 3. 同步书签
      if (opts.syncBookmarks) {
        this.emitSyncProgress(80, '正在同步书签...');
        const bookmarkResult = await this.syncAllBookmarks(opts);
        result.bookmarksUpdated = bookmarkResult.updated;
        result.conflicts.push(...bookmarkResult.conflicts);
      }

      this.emitSyncProgress(100, '同步完成');
      
      // 更新最后同步时间
      this.config.lastSyncAt = new Date();

      return result;
    } catch (error) {
      result.success = false;
      result.errors?.push(error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }

  async syncBook(bookId: string, options?: SyncOptions): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      timestamp: new Date(),
      booksUpdated: 0,
      progressUpdated: 0,
      bookmarksUpdated: 0,
      conflicts: [],
    };

    try {
      if (options?.syncBooks !== false) {
        await this.syncSingleBook(bookId, options);
        result.booksUpdated = 1;
      }

      if (options?.syncProgress !== false) {
        await this.syncSingleBookProgress(bookId, options);
        result.progressUpdated = 1;
      }

      if (options?.syncBookmarks !== false) {
        await this.syncSingleBookBookmarks(bookId, options);
        result.bookmarksUpdated = await this.getBookmarkCount(bookId);
      }

      return result;
    } catch (error) {
      result.success = false;
      throw error;
    }
  }

  async syncBookProgress(bookId: string, options?: SyncOptions): Promise<void> {
    await this.syncSingleBookProgress(bookId, options);
  }

  async syncBookBookmarks(bookId: string, options?: SyncOptions): Promise<void> {
    await this.syncSingleBookBookmarks(bookId, options);
  }

  async resolveConflict(
    _conflict: SyncConflict,
    _resolution: 'local' | 'remote' | 'merge'
  ): Promise<void> {
    // 默认实现，子类可以覆盖
    throw new Error('冲突解决需要在子类中实现');
  }

  // ==================== 事件监听（默认实现）====================
  
  onAuthStatusChange(callback: (status: AuthStatus) => void): () => void {
    this.authListeners.add(callback);
    return () => {
      this.authListeners.delete(callback);
    };
  }

  onSyncProgress(callback: (progress: number, message: string) => void): () => void {
    this.syncProgressListeners.add(callback);
    return () => {
      this.syncProgressListeners.delete(callback);
    };
  }

  // ==================== 实用方法（默认实现）====================
  
  getAuthStatus(): AuthStatus {
    return this.authStatus;
  }

  async updateConfig(config: Partial<ConnectorConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
  }

  // ==================== 受保护方法（供子类使用）====================
  
  protected setAuthStatus(status: AuthStatus): void {
    if (this.authStatus !== status) {
      this.authStatus = status;
      this.authListeners.forEach(cb => {
        try {
          cb(status);
        } catch (error) {
          console.error('Auth status callback error:', error);
        }
      });
    }
  }

  protected emitSyncProgress(progress: number, message: string, options?: SyncOptions): void {
    this.syncProgressListeners.forEach(cb => {
      try {
        cb(progress, message);
      } catch (error) {
        console.error('Sync progress callback error:', error);
      }
    });
    
    if (options?.onProgress) {
      options.onProgress(progress, message);
    }
  }

  /**
   * 生成云端存储路径
   */
  protected getRemotePath(type: 'book' | 'progress' | 'bookmark', bookId: string): string {
    const basePath = this.config.settings.basePath as string || '/SquirrelReader';
    switch (type) {
      case 'book':
        return `${basePath}/books/${bookId}.epub`;
      case 'progress':
        return `${basePath}/progress/${bookId}.json`;
      case 'bookmark':
        return `${basePath}/bookmarks/${bookId}.json`;
      default:
        return `${basePath}/${bookId}`;
    }
  }

  /**
   * 生成校验和
   */
  protected async generateChecksum(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 计算文件大小
   */
  protected formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 带重试的请求包装器
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delay = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
      }
    }
    
    throw lastError;
  }

  // ==================== 受保护方法（供子类使用）====================
  
  protected async syncBooks(_options: SyncOptions): Promise<{ updated: number; conflicts: SyncConflict[] }> {
    throw new Error('syncBooks must be implemented by subclass');
  }

  protected async syncAllProgressData(_options: SyncOptions): Promise<{ updated: number; conflicts: SyncConflict[] }> {
    throw new Error('syncAllProgressData must be implemented by subclass');
  }

  protected async syncAllBookmarks(_options: SyncOptions): Promise<{ updated: number; conflicts: SyncConflict[] }> {
    throw new Error('syncAllBookmarks must be implemented by subclass');
  }

  protected async syncSingleBook(_bookId: string, _options?: SyncOptions): Promise<void> {
    throw new Error('syncSingleBook must be implemented by subclass');
  }

  protected async syncSingleBookProgress(_bookId: string, _options?: SyncOptions): Promise<void> {
    throw new Error('syncSingleBookProgress must be implemented by subclass');
  }

  protected async syncSingleBookBookmarks(_bookId: string, _options?: SyncOptions): Promise<void> {
    throw new Error('syncSingleBookBookmarks must be implemented by subclass');
  }

  protected async getBookmarkCount(bookId: string): Promise<number> {
    const bookmarks = await this.downloadBookmarks(bookId);
    return bookmarks.length;
  }
}