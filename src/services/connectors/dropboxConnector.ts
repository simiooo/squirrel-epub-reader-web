/**
 * Dropbox 云存储连接器
 * 
 * 使用 PKCE (Proof Key for Code Exchange) 流程进行无后端 OAuth 认证
 * 支持 Dropbox API v2
 */

import type {
  CloudStorageConnector,
  ConnectorConfig,
  CloudBookMetadata,
  CloudReadingProgress,
  CloudBookmark,
} from '../../types/cloudStorage';
import { BaseCloudStorageConnector } from '../baseCloudStorageConnector';

interface DropboxSettings {
  appKey: string;
  rootPath?: string;
}

interface DropboxToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Dropbox 连接器
 */
export class DropboxConnector extends BaseCloudStorageConnector implements CloudStorageConnector {
  readonly type = 'dropbox';
  readonly displayName: string;
  
  private appKey: string;
  private rootPath: string;
  private accessToken: string | null = null;
  private storedRefreshToken: string | null = null;
  private tokenExpiresAt: number = 0;
  
  // 用于存储回调的Promise解析函数
  private authResolve: ((value: boolean) => void) | null = null;
  private authReject: ((reason: Error) => void) | null = null;

  constructor(config: ConnectorConfig) {
    super(config);
    this.displayName = config.name || 'Dropbox';
    
    const settings = config.settings as unknown as DropboxSettings;
    this.appKey = settings.appKey || '';
    this.rootPath = settings.rootPath || '/SquirrelReader';
    
    // 尝试从存储加载token
    this.loadTokenFromStorage();
  }

  private loadTokenFromStorage(): void {
    try {
      const stored = localStorage.getItem(`dropbox_token_${this.config.id}`);
      if (stored) {
        const token: DropboxToken = JSON.parse(stored);
        this.accessToken = token.access_token;
        this.storedRefreshToken = token.refresh_token;
        this.tokenExpiresAt = Date.now() + (token.expires_in - 60) * 1000;
        this.setAuthStatus('authenticated');
      }
    } catch {
      // Token not found or invalid
    }
  }

  private saveTokenToStorage(token: DropboxToken): void {
    try {
      localStorage.setItem(`dropbox_token_${this.config.id}`, JSON.stringify(token));
      this.accessToken = token.access_token;
      this.storedRefreshToken = token.refresh_token;
      this.tokenExpiresAt = Date.now() + (token.expires_in - 60) * 1000;
    } catch {
      console.error('Failed to save Dropbox token');
    }
  }

  private clearTokenFromStorage(): void {
    localStorage.removeItem(`dropbox_token_${this.config.id}`);
    this.accessToken = null;
    this.storedRefreshToken = null;
    this.tokenExpiresAt = 0;
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    if (Date.now() >= this.tokenExpiresAt && this.refreshToken) {
      await this.refreshToken();
    }
  }

  /**
   * 生成PKCE code_verifier
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  /**
   * 从code_verifier生成code_challenge
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  private base64URLEncode(buffer: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async authenticate(): Promise<boolean> {
    if (!this.appKey) {
      throw new Error('Dropbox App Key not configured');
    }

    // 生成PKCE参数
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();

    // 存储code_verifier和state用于回调验证
    sessionStorage.setItem('dropbox_code_verifier', codeVerifier);
    sessionStorage.setItem('dropbox_state', state);
    sessionStorage.setItem('dropbox_connector_id', this.config.id);

    // 构建授权URL
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
    authUrl.searchParams.set('client_id', this.appKey);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('token_access_type', 'offline');

    // 打开授权窗口
    const width = 600;
    const height = 600;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    const authWindow = window.open(
      authUrl.toString(),
      'dropbox-auth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (!authWindow) {
      throw new Error('Failed to open authorization window. Please allow popups.');
    }

    return new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;

      // 监听授权窗口关闭
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkClosed);
          if (this.authResolve) {
            this.authResolve = null;
            this.authReject = null;
            reject(new Error('Authorization window closed'));
          }
        }
      }, 500);

      // 设置超时
      setTimeout(() => {
        if (this.authResolve) {
          this.authResolve = null;
          this.authReject = null;
          reject(new Error('Authorization timeout'));
        }
      }, 300000); // 5分钟超时
    });
  }

  async handleAuthCallback(callbackData: Record<string, string>): Promise<boolean> {
    try {
      const { code, state } = callbackData;

      // 验证state
      const storedState = sessionStorage.getItem('dropbox_state');
      if (state !== storedState) {
        throw new Error('Invalid state parameter');
      }

      // 获取code_verifier
      const codeVerifier = sessionStorage.getItem('dropbox_code_verifier');
      if (!codeVerifier) {
        throw new Error('Code verifier not found');
      }

      // 交换code获取token
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const token = await this.exchangeCodeForToken(code, codeVerifier, redirectUri);

      // 保存token
      this.saveTokenToStorage(token);
      this.setAuthStatus('authenticated');

      // 清理session storage
      sessionStorage.removeItem('dropbox_code_verifier');
      sessionStorage.removeItem('dropbox_state');
      sessionStorage.removeItem('dropbox_connector_id');

      // 解析认证Promise
      if (this.authResolve) {
        this.authResolve(true);
        this.authResolve = null;
        this.authReject = null;
      }

      return true;
    } catch (error) {
      if (this.authReject) {
        this.authReject(error instanceof Error ? error : new Error(String(error)));
        this.authResolve = null;
        this.authReject = null;
      }
      throw error;
    }
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<DropboxToken> {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: this.appKey,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    return response.json();
  }

  async refreshToken(): Promise<boolean> {
    if (!this.storedRefreshToken) {
      return false;
    }

    try {
      const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.storedRefreshToken,
          client_id: this.appKey,
        }),
      });

      if (!response.ok) {
        this.clearTokenFromStorage();
        this.setAuthStatus('expired');
        return false;
      }

      const token: DropboxToken = await response.json();
      this.saveTokenToStorage(token);
      return true;
    } catch {
      this.clearTokenFromStorage();
      this.setAuthStatus('error');
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.accessToken) {
        await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
      }
    } finally {
      this.clearTokenFromStorage();
      this.setAuthStatus('unauthenticated');
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.ensureValidToken();
      
      const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.ok) {
        return { success: true, message: 'Connection successful' };
      }
      
      return { success: false, message: `Connection failed: ${response.status}` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  private async dropboxApiRequest(endpoint: string, body?: unknown): Promise<unknown> {
    await this.ensureValidToken();

    const response = await fetch(`https://api.dropboxapi.com${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox API error: ${response.status} - ${error}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  private async uploadFile(path: string, data: Blob): Promise<void> {
    await this.ensureValidToken();

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'overwrite',
          autorename: false,
          mute: true,
        }),
      },
      body: data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox upload error: ${response.status} - ${error}`);
    }
  }

  private async downloadFile(path: string): Promise<Blob> {
    await this.ensureValidToken();

    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });

    if (!response.ok) {
      throw new Error(`Dropbox download error: ${response.status}`);
    }

    return response.blob();
  }

  async uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata> {
    const bookPath = `${this.rootPath}/books/${bookId}.epub`;
    await this.uploadFile(bookPath, fileData);

    const checksum = await this.generateChecksum(fileData);
    const metaPath = `${this.rootPath}/metadata/${bookId}.json`;
    const metaData = {
      bookId,
      checksum,
      size: fileData.size,
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: metadata.localModifiedAt.toISOString(),
      version: 1,
    };

    await this.uploadFile(metaPath, new Blob([JSON.stringify(metaData)], { type: 'application/json' }));

    return {
      ...metadata,
      remotePath: bookPath,
      checksum,
      size: fileData.size,
    };
  }

  async downloadBook(remotePath: string): Promise<Blob> {
    return this.downloadFile(remotePath);
  }

  async deleteBook(paths: {
    remotePath: string;
    coverPath?: string;
    metadataPath?: string;
  }): Promise<void> {
    const { remotePath, coverPath, metadataPath } = paths;

    // 删除所有相关文件
    const pathsToDelete = [remotePath];
    if (coverPath) pathsToDelete.push(coverPath);
    if (metadataPath) pathsToDelete.push(metadataPath);

    for (const path of pathsToDelete) {
      try {
        await this.dropboxApiRequest('/2/files/delete_v2', { path });
      } catch (error) {
        console.warn(`Failed to delete ${path}:`, error);
        // 继续删除其他文件，不中断流程
      }
    }
  }

  async listBooks(): Promise<CloudBookMetadata[]> {
    const result = await this.dropboxApiRequest('/2/files/list_folder', {
      path: `${this.rootPath}/metadata`,
      recursive: false,
    }) as { entries: Array<{ path: string; name: string; '.tag': string }> };

    const books: CloudBookMetadata[] = [];

    for (const entry of result.entries || []) {
      if (entry['.tag'] !== 'file' || !entry.name.endsWith('.json')) continue;

      try {
        const data = await this.downloadFile(entry.path);
        const text = await data.text();
        const meta = JSON.parse(text);

        books.push({
          bookId: meta.bookId,
          remotePath: meta.bookPath || `${this.rootPath}/books/${meta.bookId}.epub`,
          coverPath: meta.coverPath,
          metadataPath: entry.path,
          size: meta.size,
          coverSize: meta.coverSize,
          checksum: meta.checksum,
          coverChecksum: meta.coverChecksum,
          metadataChecksum: meta.metadataChecksum,
          localModifiedAt: new Date(meta.localModifiedAt),
          remoteModifiedAt: new Date(meta.remoteModifiedAt),
          syncStatus: 'synced',
          version: meta.version,
          partsSyncStatus: meta.partsSyncStatus || {
            metadata: 'synced',
            cover: meta.coverPath ? 'synced' : 'missing',
            book: 'synced',
          },
        });
      } catch (error) {
        console.error(`Failed to load metadata for ${entry.name}:`, error);
      }
    }

    return books;
  }

  async bookExists(remotePath: string): Promise<boolean> {
    try {
      await this.dropboxApiRequest('/2/files/get_metadata', { path: remotePath });
      return true;
    } catch {
      return false;
    }
  }

  async uploadProgress(bookId: string, progress: CloudReadingProgress): Promise<void> {
    const path = `${this.rootPath}/progress/${bookId}.json`;
    const data = {
      ...progress,
      lastReadAt: progress.lastReadAt.toISOString(),
    };
    await this.uploadFile(path, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  }

  async downloadProgress(bookId: string): Promise<CloudReadingProgress | null> {
    try {
      const data = await this.downloadFile(`${this.rootPath}/progress/${bookId}.json`);
      const text = await data.text();
      const json = JSON.parse(text);
      return {
        ...json,
        lastReadAt: new Date(json.lastReadAt),
      };
    } catch {
      return null;
    }
  }

  async listAllProgress(): Promise<CloudReadingProgress[]> {
    const result = await this.dropboxApiRequest('/2/files/list_folder', {
      path: `${this.rootPath}/progress`,
      recursive: false,
    }) as { entries: Array<{ path: string; name: string; '.tag': string }> };

    const progressList: CloudReadingProgress[] = [];

    for (const entry of result.entries || []) {
      if (entry['.tag'] !== 'file' || !entry.name.endsWith('.json')) continue;

      try {
        const bookId = entry.name.replace('.json', '');
        const progress = await this.downloadProgress(bookId);
        if (progress) {
          progressList.push(progress);
        }
      } catch (error) {
        console.error(`Failed to load progress for ${entry.name}:`, error);
      }
    }

    return progressList;
  }

  async uploadBookmarks(bookId: string, bookmarks: CloudBookmark[]): Promise<void> {
    const path = `${this.rootPath}/bookmarks/${bookId}.json`;
    const data = bookmarks.map(b => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }));
    await this.uploadFile(path, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  }

  async downloadBookmarks(bookId: string): Promise<CloudBookmark[]> {
    try {
      const data = await this.downloadFile(`${this.rootPath}/bookmarks/${bookId}.json`);
      const text = await data.text();
      const json = JSON.parse(text);
      return json.map((b: { createdAt: string }) => ({
        ...b,
        createdAt: new Date(b.createdAt),
      }));
    } catch {
      return [];
    }
  }

  async deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
    const bookmarks = await this.downloadBookmarks(bookId);
    const filtered = bookmarks.filter(b => b.id !== bookmarkId);
    await this.uploadBookmarks(bookId, filtered);
  }

  /**
   * 上传书籍到云端（分离存储版本）
   */
  async uploadBookWithParts(
    bookId: string,
    bookData: Blob,
    coverData: Blob | null,
    metadata: CloudBookMetadata,
    fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata,
    format: 'epub' | 'pdf' = 'epub'
  ): Promise<CloudBookMetadata> {
    const extension = format === 'pdf' ? 'pdf' : 'epub';
    const bookPath = `${this.rootPath}/books/${bookId}.${extension}`;
    const metadataPath = `${this.rootPath}/metadata/${bookId}.json`;
    const coverPath = coverData ? `${this.rootPath}/covers/${bookId}.cover` : undefined;

    // 1. 上传书籍文件
    await this.uploadFile(bookPath, bookData);

    // 2. 上传封面（如果有）
    if (coverData && coverPath) {
      await this.uploadFile(coverPath, coverData);
    }

    // 3. 准备完整元数据
    const completeMetadata: import('../../types/cloudStorage').CloudBookFullMetadata = {
      ...fullMetadata,
      bookPath,
      coverPath,
      size: bookData.size,
      coverSize: coverData?.size,
      checksum: await this.generateChecksum(bookData),
      coverChecksum: coverData ? await this.generateChecksum(coverData) : undefined,
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: fullMetadata.localModifiedAt,
      version: fullMetadata.version,
      partsSyncStatus: {
        metadata: 'synced',
        cover: coverData ? 'synced' : 'missing',
        book: 'synced',
      },
      format,
    };

    // 4. 上传元数据
    await this.uploadFile(
      metadataPath,
      new Blob([JSON.stringify(completeMetadata)], { type: 'application/json' })
    );

    return {
      ...metadata,
      remotePath: bookPath,
      coverPath,
      metadataPath,
      checksum: completeMetadata.checksum,
      coverChecksum: completeMetadata.coverChecksum,
      size: bookData.size,
      coverSize: coverData?.size,
      partsSyncStatus: completeMetadata.partsSyncStatus,
    };
  }

  /**
   * 下载书籍的所有部分
   */
  async downloadBookWithParts(
    metadata: CloudBookMetadata
  ): Promise<{
    bookData: Blob;
    coverData: Blob | null;
    fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata;
  }> {
    // 1. 下载完整元信息
    const fullMetadata = await this.downloadBookMetadata(metadata.metadataPath);

    // 2. 下载书籍文件
    const bookData = await this.downloadFile(metadata.remotePath);

    // 3. 下载封面（如果有）
    let coverData: Blob | null = null;
    if (metadata.coverPath) {
      try {
        coverData = await this.downloadFile(metadata.coverPath);
      } catch (error) {
        console.warn(`Failed to download cover for ${metadata.bookId}:`, error);
      }
    }

    return {
      bookData,
      coverData,
      fullMetadata,
    };
  }

  /**
   * 下载完整元信息
   */
  async downloadBookMetadata(
    metadataPath: string
  ): Promise<import('../../types/cloudStorage').CloudBookFullMetadata> {
    const data = await this.downloadFile(metadataPath);
    const text = await data.text();
    const meta = JSON.parse(text);

    return {
      ...meta,
      localModifiedAt: meta.localModifiedAt,
      remoteModifiedAt: meta.remoteModifiedAt,
    };
  }

  /**
   * 检查书籍各部分是否存在
   */
  async checkBookPartsExists(
    metadata: CloudBookMetadata
  ): Promise<{
    metadata: boolean;
    cover: boolean;
    book: boolean;
  }> {
    const results = {
      metadata: false,
      cover: false,
      book: false,
    };

    try {
      await this.downloadFile(metadata.metadataPath);
      results.metadata = true;
    } catch {
      results.metadata = false;
    }

    if (metadata.coverPath) {
      try {
        await this.downloadFile(metadata.coverPath);
        results.cover = true;
      } catch {
        results.cover = false;
      }
    }

    try {
      await this.downloadFile(metadata.remotePath);
      results.book = true;
    } catch {
      results.book = false;
    }

    return results;
  }
}