/**
 * Google Drive 云存储连接器
 * 
 * 使用 PKCE (Proof Key for Code Exchange) 流程进行无后端 OAuth 认证
 * 支持 Google Drive API v3
 */

import type {
  CloudStorageConnector,
  ConnectorConfig,
  CloudBookMetadata,
  CloudReadingProgress,
  CloudBookmark,
} from '../../types/cloudStorage';
import { BaseCloudStorageConnector } from '../baseCloudStorageConnector';

interface GoogleDriveSettings {
  clientId: string;
  rootPath?: string;
}

interface GoogleToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

interface GoogleFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  parents?: string[];
}

/**
 * Google Drive 连接器
 */
export class GoogleDriveConnector extends BaseCloudStorageConnector implements CloudStorageConnector {
  readonly type = 'googledrive';
  readonly displayName: string;
  
  private clientId: string;
  private rootPath: string;
  private accessToken: string | null = null;
  private storedRefreshToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private folderId: string | undefined;
  
  private authResolve: ((value: boolean) => void) | null = null;
  private authReject: ((reason: Error) => void) | null = null;

  constructor(config: ConnectorConfig) {
    super(config);
    this.displayName = config.name || 'Google Drive';
    
    const settings = config.settings as unknown as GoogleDriveSettings;
    this.clientId = settings.clientId || '';
    this.rootPath = settings.rootPath || 'SquirrelReader';
    
    this.loadTokenFromStorage();
  }

  private loadTokenFromStorage(): void {
    try {
      const stored = localStorage.getItem(`gdrive_token_${this.config.id}`);
      if (stored) {
        const token: GoogleToken = JSON.parse(stored);
        this.accessToken = token.access_token;
        this.storedRefreshToken = token.refresh_token;
        this.tokenExpiresAt = Date.now() + (token.expires_in - 60) * 1000;
        this.setAuthStatus('authenticated');
      }
      
      this.folderId = localStorage.getItem(`gdrive_folder_${this.config.id}`) ?? undefined;
    } catch {
      // Token not found or invalid
    }
  }

  private saveTokenToStorage(token: GoogleToken): void {
    try {
      localStorage.setItem(`gdrive_token_${this.config.id}`, JSON.stringify(token));
      this.accessToken = token.access_token;
      this.storedRefreshToken = token.refresh_token;
      this.tokenExpiresAt = Date.now() + (token.expires_in - 60) * 1000;
    } catch {
      console.error('Failed to save Google Drive token');
    }
  }

  private clearTokenFromStorage(): void {
    localStorage.removeItem(`gdrive_token_${this.config.id}`);
    localStorage.removeItem(`gdrive_folder_${this.config.id}`);
    this.accessToken = null;
    this.storedRefreshToken = null;
    this.tokenExpiresAt = 0;
    this.folderId = undefined;
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    if (Date.now() >= this.tokenExpiresAt && this.storedRefreshToken) {
      await this.refreshToken();
    }
  }

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

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
    if (!this.clientId) {
      throw new Error('Google Client ID not configured');
    }

    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();

    sessionStorage.setItem('gdrive_code_verifier', codeVerifier);
    sessionStorage.setItem('gdrive_state', state);
    sessionStorage.setItem('gdrive_connector_id', this.config.id);

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const scope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly';
    
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const width = 600;
    const height = 600;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    const authWindow = window.open(
      authUrl.toString(),
      'google-auth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (!authWindow) {
      throw new Error('Failed to open authorization window. Please allow popups.');
    }

    return new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;

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

      setTimeout(() => {
        if (this.authResolve) {
          this.authResolve = null;
          this.authReject = null;
          reject(new Error('Authorization timeout'));
        }
      }, 300000);
    });
  }

  async handleAuthCallback(callbackData: Record<string, string>): Promise<boolean> {
    try {
      const { code, state } = callbackData;

      const storedState = sessionStorage.getItem('gdrive_state');
      if (state !== storedState) {
        throw new Error('Invalid state parameter');
      }

      const codeVerifier = sessionStorage.getItem('gdrive_code_verifier');
      if (!codeVerifier) {
        throw new Error('Code verifier not found');
      }

      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const token = await this.exchangeCodeForToken(code, codeVerifier, redirectUri);

      this.saveTokenToStorage(token);
      this.setAuthStatus('authenticated');

      // 确保根文件夹存在
      await this.ensureRootFolder();

      sessionStorage.removeItem('gdrive_code_verifier');
      sessionStorage.removeItem('gdrive_state');
      sessionStorage.removeItem('gdrive_connector_id');

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
  ): Promise<GoogleToken> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
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
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          refresh_token: this.storedRefreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        this.clearTokenFromStorage();
        this.setAuthStatus('expired');
        return false;
      }

      const token: GoogleToken = await response.json();
      if (!token.refresh_token && this.storedRefreshToken) {
        token.refresh_token = this.storedRefreshToken;
      }
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
        await fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
          method: 'POST',
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
      
      const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
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

  private async ensureRootFolder(): Promise<string> {
    if (this.folderId) {
      return this.folderId;
    }

    await this.ensureValidToken();

    // 查找现有文件夹
    const query = `name='${this.rootPath}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (searchResponse.ok) {
      const data = await searchResponse.json();
      if (data.files && data.files.length > 0) {
        const foundId = data.files[0].id;
        this.folderId = foundId;
        localStorage.setItem(`gdrive_folder_${this.config.id}`, foundId);
        return foundId;
      }
    }

    // 创建文件夹
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: this.rootPath,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createResponse.ok) {
      throw new Error('Failed to create root folder');
    }

    const folder = await createResponse.json();
    const createdId = folder.id;
    this.folderId = createdId;
    localStorage.setItem(`gdrive_folder_${this.config.id}`, createdId);
    return createdId;
  }

  private async createSubfolder(name: string, parentId: string): Promise<string> {
    const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (searchResponse.ok) {
      const data = await searchResponse.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
    }

    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create ${name} folder`);
    }

    const folder = await createResponse.json();
    return folder.id;
  }

  private async uploadFile(name: string, parentId: string, data: Blob, _mimeType: string): Promise<string> {
    const metadata = { name, parents: [parentId] };
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', data);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${error}`);
    }

    const file = await response.json();
    return file.id;
  }

  private async downloadFile(fileId: string): Promise<Blob> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return response.blob();
  }

  private async deleteFile(fileId: string): Promise<void> {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  private async findFile(name: string, parentId: string): Promise<GoogleFile | null> {
    const query = `name='${name}' and '${parentId}' in parents and trashed=false`;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,size,modifiedTime)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  async uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const booksFolderId = await this.createSubfolder('books', rootFolderId);
    const metadataFolderId = await this.createSubfolder('metadata', rootFolderId);

    await this.uploadFile(`${bookId}.epub`, booksFolderId, fileData, 'application/epub+zip');

    const checksum = await this.generateChecksum(fileData);
    const metaData = {
      bookId,
      checksum,
      size: fileData.size,
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: metadata.localModifiedAt.toISOString(),
      version: 1,
    };
    
    await this.uploadFile(
      `${bookId}.json`,
      metadataFolderId,
      new Blob([JSON.stringify(metaData)], { type: 'application/json' }),
      'application/json'
    );

    return {
      ...metadata,
      remotePath: bookId,
      checksum,
      size: fileData.size,
    };
  }

  async downloadBook(remotePath: string): Promise<Blob> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const booksFolderId = await this.createSubfolder('books', rootFolderId);
    
    const file = await this.findFile(`${remotePath}.epub`, booksFolderId);
    if (!file) {
      throw new Error('Book not found');
    }
    
    return this.downloadFile(file.id);
  }

  async deleteBook(remotePath: string): Promise<void> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const booksFolderId = await this.createSubfolder('books', rootFolderId);
    
    const file = await this.findFile(`${remotePath}.epub`, booksFolderId);
    if (file) {
      await this.deleteFile(file.id);
    }
  }

  async listBooks(): Promise<CloudBookMetadata[]> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const metadataFolderId = await this.createSubfolder('metadata', rootFolderId);

    const query = `'${metadataFolderId}' in parents and trashed=false`;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,size,modifiedTime)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const books: CloudBookMetadata[] = [];

    for (const file of data.files || []) {
      if (!file.name.endsWith('.json')) continue;

      try {
        const content = await this.downloadFile(file.id);
        const text = await content.text();
        const meta = JSON.parse(text);

        books.push({
          bookId: meta.bookId,
          remotePath: meta.bookPath || file.id,
          coverPath: meta.coverPath,
          metadataPath: file.id,
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
        console.error(`Failed to load metadata for ${file.name}:`, error);
      }
    }

    return books;
  }

  async bookExists(remotePath: string): Promise<boolean> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const booksFolderId = await this.createSubfolder('books', rootFolderId);
    
    const file = await this.findFile(`${remotePath}.epub`, booksFolderId);
    return file !== null;
  }

  async uploadProgress(bookId: string, progress: CloudReadingProgress): Promise<void> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const progressFolderId = await this.createSubfolder('progress', rootFolderId);

    const data = {
      ...progress,
      lastReadAt: progress.lastReadAt.toISOString(),
    };

    const existing = await this.findFile(`${bookId}.json`, progressFolderId);
    if (existing) {
      await this.deleteFile(existing.id);
    }

    await this.uploadFile(
      `${bookId}.json`,
      progressFolderId,
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      'application/json'
    );
  }

  async downloadProgress(bookId: string): Promise<CloudReadingProgress | null> {
    try {
      await this.ensureValidToken();
      const rootFolderId = await this.ensureRootFolder();
      const progressFolderId = await this.createSubfolder('progress', rootFolderId);

      const file = await this.findFile(`${bookId}.json`, progressFolderId);
      if (!file) return null;

      const content = await this.downloadFile(file.id);
      const text = await content.text();
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
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const progressFolderId = await this.createSubfolder('progress', rootFolderId);

    const query = `'${progressFolderId}' in parents and trashed=false`;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const progressList: CloudReadingProgress[] = [];

    for (const file of data.files || []) {
      if (!file.name.endsWith('.json')) continue;

      try {
        const bookId = file.name.replace('.json', '');
        const progress = await this.downloadProgress(bookId);
        if (progress) {
          progressList.push(progress);
        }
      } catch (error) {
        console.error(`Failed to load progress for ${file.name}:`, error);
      }
    }

    return progressList;
  }

  async uploadBookmarks(bookId: string, bookmarks: CloudBookmark[]): Promise<void> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();
    const bookmarksFolderId = await this.createSubfolder('bookmarks', rootFolderId);

    const data = bookmarks.map(b => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }));

    const existing = await this.findFile(`${bookId}.json`, bookmarksFolderId);
    if (existing) {
      await this.deleteFile(existing.id);
    }

    await this.uploadFile(
      `${bookId}.json`,
      bookmarksFolderId,
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      'application/json'
    );
  }

  async downloadBookmarks(bookId: string): Promise<CloudBookmark[]> {
    try {
      await this.ensureValidToken();
      const rootFolderId = await this.ensureRootFolder();
      const bookmarksFolderId = await this.createSubfolder('bookmarks', rootFolderId);

      const file = await this.findFile(`${bookId}.json`, bookmarksFolderId);
      if (!file) return [];

      const content = await this.downloadFile(file.id);
      const text = await content.text();
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
    fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata
  ): Promise<CloudBookMetadata> {
    await this.ensureValidToken();
    const rootFolderId = await this.ensureRootFolder();

    const booksFolderId = await this.createSubfolder('books', rootFolderId);
    const metadataFolderId = await this.createSubfolder('metadata', rootFolderId);
    const coversFolderId = coverData ? await this.createSubfolder('covers', rootFolderId) : undefined;

    // 1. 上传书籍文件
    const existingBook = await this.findFile(`${bookId}.epub`, booksFolderId);
    if (existingBook) {
      await this.deleteFile(existingBook.id);
    }
    const bookFileId = await this.uploadFile(
      `${bookId}.epub`,
      booksFolderId,
      bookData,
      'application/epub+zip'
    );

    // 2. 上传封面（如果有）
    let coverFileId: string | undefined;
    if (coverData && coversFolderId) {
      const existingCover = await this.findFile(`${bookId}.cover`, coversFolderId);
      if (existingCover) {
        await this.deleteFile(existingCover.id);
      }
      coverFileId = await this.uploadFile(
        `${bookId}.cover`,
        coversFolderId,
        coverData,
        'image/jpeg'
      );
    }

    // 3. 准备完整元数据
    const completeMetadata: import('../../types/cloudStorage').CloudBookFullMetadata = {
      ...fullMetadata,
      bookPath: bookFileId,
      coverPath: coverFileId,
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
    };

    // 4. 上传元数据
    const existingMeta = await this.findFile(`${bookId}.json`, metadataFolderId);
    if (existingMeta) {
      await this.deleteFile(existingMeta.id);
    }
    const metadataFileId = await this.uploadFile(
      `${bookId}.json`,
      metadataFolderId,
      new Blob([JSON.stringify(completeMetadata)], { type: 'application/json' }),
      'application/json'
    );

    return {
      ...metadata,
      remotePath: bookFileId,
      coverPath: coverFileId,
      metadataPath: metadataFileId,
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
    const content = await this.downloadFile(metadataPath);
    const text = await content.text();
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