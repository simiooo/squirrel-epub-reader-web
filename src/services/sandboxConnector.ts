/**
 * 沙箱连接器适配器
 * 
 * 作用：
 * 1. 在主应用中实现CloudStorageConnector接口
 * 2. 将所有操作转发到Service Worker沙箱执行
 * 3. 管理连接器生命周期
 * 4. 处理双向通信
 */

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

interface SandboxResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * 沙箱连接器 - 主应用中的包装器
 */
export class SandboxConnector implements CloudStorageConnector {
  readonly type: string;
  readonly displayName: string;
  
  config: ConnectorConfig;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private messagePort: MessagePort | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: number;
  }>();
  private requestId = 0;
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private _authStatus: AuthStatus = 'unauthenticated';
  private userCode: string;

  constructor(
    config: ConnectorConfig,
    userCode: string
  ) {
    this.config = config;
    this.type = config.type;
    this.displayName = config.name;
    this.userCode = userCode;
  }

  /**
   * 初始化沙箱连接
   */
  async initialize(): Promise<void> {
    // 1. 注册Service Worker
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported');
    }

    this.swRegistration = await navigator.serviceWorker.register('/sandbox-sw.js');
    
    // 等待Service Worker激活
    await navigator.serviceWorker.ready;

    // 2. 建立通信通道
    const channel = new MessageChannel();
    this.messagePort = channel.port1;
    
    this.messagePort.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.messagePort.start();

    // 3. 初始化连接器
    const result = await this.sendRequest('INIT_CONNECTOR', {
      connectorType: this.type,
      config: this.config.settings,
      code: this.userCode,
    });

    const initResult = result as { success: boolean; error?: string };
    if (!initResult.success) {
      throw new Error(initResult.error || '初始化失败');
    }

    // 4. 监听Service Worker消息
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'SANDBOX_MESSAGE') {
        this.handleSandboxEvent(event.data.payload);
      }
    });
  }

  /**
   * 发送请求到Service Worker
   */
  private sendRequest(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestId}_${Date.now()}`;
      
      // 设置超时
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${type}`));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      // 发送消息到Service Worker
      if (this.swRegistration?.active) {
        this.swRegistration.active.postMessage({
          type: 'SANDBOX_REQUEST',
          requestId,
          payload: {
            connectorId: this.config.id,
            type,
            ...payload,
          },
        }, [this.messagePort!]);
      } else {
        reject(new Error('Service Worker not ready'));
      }
    });
  }

  /**
   * 处理Service Worker响应
   */
  private handleMessage(data: { type: string; requestId: string; payload: SandboxResponse }): void {
    if (data.type !== 'SANDBOX_RESPONSE') return;

    const pending = this.pendingRequests.get(data.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timeout);
    this.pendingRequests.delete(data.requestId);

    if (data.payload.success) {
      pending.resolve(data.payload.data);
    } else {
      pending.reject(new Error(data.payload.error || 'Unknown error'));
    }
  }

  /**
   * 处理沙箱事件
   */
  private handleSandboxEvent(payload: { type: string; connectorId: string; event?: Record<string, unknown> }): void {
    if (payload.connectorId !== this.config.id) return;

    switch (payload.type) {
      case 'EVENT':
        this.handleEvent(payload.event!);
        break;
      default:
        break;
    }
  }

  /**
   * 处理连接器事件
   */
  private handleEvent(event: Record<string, unknown>): void {
    const listeners = this.eventListeners.get(event.type as string);
    if (listeners) {
      listeners.forEach(cb => {
        try {
          cb(event.payload);
        } catch (error) {
          console.error('Event handler error:', error);
        }
      });
    }
  }

  // ==================== 认证相关 ====================

  getAuthStatus(): AuthStatus {
    return this._authStatus;
  }

  async authenticate(): Promise<boolean> {
    const result = await this.sendRequest('AUTHENTICATE') as { success: boolean; authUrl?: string; error?: string };
    
    if (result.success && result.authUrl) {
      // 打开OAuth窗口
      const popup = window.open(
        result.authUrl,
        'oauth',
        'width=600,height=600,menubar=no,toolbar=no,location=no,status=no'
      );

      if (!popup) {
        throw new Error('Popup blocked');
      }

      // 等待OAuth回调
      return new Promise((resolve) => {
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            resolve(true);
          }
        }, 500);
      });
    }

    return result.success;
  }

  async handleAuthCallback(callbackData: Record<string, string>): Promise<boolean> {
    const result = await this.sendRequest('HANDLE_AUTH_CALLBACK', { callbackData }) as { success: boolean };
    return result.success;
  }

  async refreshToken(): Promise<boolean> {
    const result = await this.sendRequest('REFRESH_TOKEN') as { success: boolean };
    return result.success;
  }

  async logout(): Promise<void> {
    await this.sendRequest('LOGOUT');
    this._authStatus = 'unauthenticated';
  }

  // ==================== 连接管理 ====================

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    return await this.sendRequest('TEST_CONNECTION') as { success: boolean; message?: string };
  }

  async updateConfig(config: Partial<ConnectorConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await this.sendRequest('UPDATE_CONFIG', { config: this.config.settings });
  }

  // ==================== 书籍操作 ====================

  async uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata> {
    const arrayBuffer = await fileData.arrayBuffer();
    const result = await this.sendRequest('UPLOAD_BOOK', {
      bookId,
      fileData: arrayBuffer,
      metadata: {
        ...metadata,
        localModifiedAt: metadata.localModifiedAt.toISOString(),
        remoteModifiedAt: metadata.remoteModifiedAt.toISOString(),
      },
    }) as { success: boolean; remotePath: string; size: number; checksum: string };

    return {
      ...metadata,
      remotePath: result.remotePath,
      size: result.size,
      checksum: result.checksum,
    };
  }

  async downloadBook(remotePath: string): Promise<Blob> {
    const result = await this.sendRequest('DOWNLOAD_BOOK', { remotePath }) as { 
      success: boolean; 
      fileData: ArrayBuffer;
    };

    return new Blob([result.fileData]);
  }

  async deleteBook(paths: {
    remotePath: string;
    coverPath?: string;
    metadataPath?: string;
  }): Promise<void> {
    await this.sendRequest('DELETE_BOOK', { paths });
  }

  async listBooks(): Promise<CloudBookMetadata[]> {
    const result = await this.sendRequest('LIST_BOOKS') as {
      success: boolean;
      books: Array<{
        bookId: string;
        remotePath: string;
        size: number;
        checksum: string;
        modifiedAt: string;
      }>;
    };

    return result.books.map(book => ({
      bookId: book.bookId,
      remotePath: book.remotePath,
      metadataPath: `${book.remotePath.replace('/books/', '/metadata/').replace('.epub', '.json')}`,
      size: book.size,
      checksum: book.checksum,
      localModifiedAt: new Date(book.modifiedAt),
      remoteModifiedAt: new Date(book.modifiedAt),
      syncStatus: 'synced',
      version: 1,
    }));
  }

  async bookExists(remotePath: string): Promise<boolean> {
    const result = await this.sendRequest('BOOK_EXISTS', { remotePath }) as { 
      success: boolean; 
      exists: boolean;
    };
    return result.exists;
  }

  // ==================== 阅读进度操作 ====================

  async uploadProgress(
    bookId: string,
    progress: CloudReadingProgress
  ): Promise<void> {
    await this.sendRequest('UPLOAD_PROGRESS', {
      bookId,
      progress: {
        ...progress,
        lastReadAt: progress.lastReadAt.toISOString(),
      },
    });
  }

  async downloadProgress(bookId: string): Promise<CloudReadingProgress | null> {
    const result = await this.sendRequest('DOWNLOAD_PROGRESS', { bookId }) as {
      success: boolean;
      progress: {
        currentChapter: string;
        currentPosition: number;
        lastReadAt: string;
        totalProgress: number;
        deviceId: string;
        version: number;
      } | null;
    };

    if (!result.progress) return null;

    return {
      bookId,
      currentChapter: result.progress.currentChapter,
      currentPosition: result.progress.currentPosition,
      lastReadAt: new Date(result.progress.lastReadAt),
      totalProgress: result.progress.totalProgress,
      deviceId: result.progress.deviceId,
      version: result.progress.version,
    };
  }

  async listAllProgress(): Promise<CloudReadingProgress[]> {
    const result = await this.sendRequest('LIST_ALL_PROGRESS') as {
      success: boolean;
      progressList: Array<{
        bookId: string;
        currentChapter: string;
        currentPosition: number;
        lastReadAt: string;
        totalProgress: number;
        deviceId: string;
        version: number;
      }>;
    };

    return result.progressList.map(p => ({
      bookId: p.bookId,
      currentChapter: p.currentChapter,
      currentPosition: p.currentPosition,
      lastReadAt: new Date(p.lastReadAt),
      totalProgress: p.totalProgress,
      deviceId: p.deviceId,
      version: p.version,
    }));
  }

  // ==================== 书签操作 ====================

  async uploadBookmarks(
    bookId: string,
    bookmarks: CloudBookmark[]
  ): Promise<void> {
    await this.sendRequest('UPLOAD_BOOKMARKS', {
      bookId,
      bookmarks: bookmarks.map(b => ({
        ...b,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  }

  async downloadBookmarks(bookId: string): Promise<CloudBookmark[]> {
    const result = await this.sendRequest('DOWNLOAD_BOOKMARKS', { bookId }) as {
      success: boolean;
      bookmarks: Array<{
        id: string;
        chapterId: string;
        position: number;
        text: string;
        createdAt: string;
        color?: string;
        note?: string;
      }>;
    };

    return result.bookmarks.map(b => ({
      id: b.id,
      bookId,
      chapterId: b.chapterId,
      position: b.position,
      text: b.text,
      createdAt: new Date(b.createdAt),
      color: b.color,
      note: b.note,
    }));
  }

  async deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
    await this.sendRequest('DELETE_BOOKMARK', { bookId, bookmarkId });
  }

  // ==================== 同步操作 ====================

  async sync(options?: SyncOptions): Promise<SyncResult> {
    const result = await this.sendRequest('SYNC', { options }) as SyncResult;
    return result;
  }

  async syncBook(bookId: string, options?: SyncOptions): Promise<SyncResult> {
    const result = await this.sendRequest('SYNC_BOOK', { bookId, options }) as SyncResult;
    return result;
  }

  async syncBookProgress(bookId: string, _options?: SyncOptions): Promise<void> {
    await this.syncBook(bookId);
  }

  async syncBookBookmarks(bookId: string, _options?: SyncOptions): Promise<void> {
    await this.syncBook(bookId);
  }

  async resolveConflict(
    _conflict: SyncConflict,
    _resolution: 'local' | 'remote' | 'merge'
  ): Promise<void> {
    // 冲突解决逻辑可以在沙箱中实现，也可以通过主应用处理
    throw new Error('Conflict resolution not implemented in sandbox');
  }

  // ==================== 事件监听 ====================

  onAuthStatusChange(callback: (status: AuthStatus) => void): () => void {
    return this.addEventListener('auth_status_changed', (payload) => {
      const typedPayload = payload as { status: AuthStatus };
      this._authStatus = typedPayload.status;
      callback(typedPayload.status);
    });
  }

  onSyncProgress(callback: (progress: number, message: string) => void): () => void {
    return this.addEventListener('sync_progress', (payload) => {
      const typedPayload = payload as { progress: number; message: string };
      callback(typedPayload.progress, typedPayload.message);
    });
  }

  /**
   * 添加事件监听器
   */
  private addEventListener(eventType: string, callback: (payload: unknown) => void): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    
    this.eventListeners.get(eventType)!.add(callback);
    
    return () => {
      this.eventListeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * 销毁连接器
   */
  async dispose(): Promise<void> {
    await this.sendRequest('DISPOSE_CONNECTOR');
    
    if (this.messagePort) {
      this.messagePort.close();
      this.messagePort = null;
    }

    this.eventListeners.clear();
    this.pendingRequests.clear();
  }

  // ==================== 分离存储操作（转发到沙箱）====================

  async uploadBookWithParts(
    bookId: string,
    bookData: Blob,
    coverData: Blob | null,
    metadata: CloudBookMetadata,
    fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata,
    format: 'epub' | 'pdf' = 'epub'
  ): Promise<CloudBookMetadata> {
    const result = await this.sendRequest('UPLOAD_BOOK_WITH_PARTS', {
      bookId,
      bookData: await this.blobToBase64(bookData),
      coverData: coverData ? await this.blobToBase64(coverData) : null,
      metadata,
      fullMetadata,
      format,
    }) as { success: boolean; metadata: CloudBookMetadata };
    return result.metadata;
  }

  async downloadBookWithParts(
    metadata: CloudBookMetadata
  ): Promise<{
    bookData: Blob;
    coverData: Blob | null;
    fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata;
  }> {
    const result = await this.sendRequest('DOWNLOAD_BOOK_WITH_PARTS', { metadata }) as {
      success: boolean;
      bookData: string;
      coverData: string | null;
      fullMetadata: import('../types/cloudStorage').CloudBookFullMetadata;
    };

    return {
      bookData: await this.base64ToBlob(result.bookData, 'application/epub+zip'),
      coverData: result.coverData ? await this.base64ToBlob(result.coverData, 'image/jpeg') : null,
      fullMetadata: result.fullMetadata,
    };
  }

  async downloadBookMetadata(
    metadataPath: string
  ): Promise<import('../types/cloudStorage').CloudBookFullMetadata> {
    const result = await this.sendRequest('DOWNLOAD_BOOK_METADATA', { metadataPath }) as {
      success: boolean;
      metadata: import('../types/cloudStorage').CloudBookFullMetadata;
    };
    return result.metadata;
  }

  async checkBookPartsExists(
    metadata: CloudBookMetadata
  ): Promise<{
    metadata: boolean;
    cover: boolean;
    book: boolean;
  }> {
    const result = await this.sendRequest('CHECK_BOOK_PARTS_EXISTS', { metadata }) as {
      success: boolean;
      exists: {
        metadata: boolean;
        cover: boolean;
        book: boolean;
      };
    };
    return result.exists;
  }

  // ==================== 辅助方法 ====================

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private async base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }
}
