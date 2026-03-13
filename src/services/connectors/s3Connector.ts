/**
 * S3兼容存储连接器 - 使用AWS SDK
 * 
 * 支持：
 * - AWS S3
 * - Backblaze B2
 * - 阿里云OSS
 * - 腾讯云COS
 * - MinIO
 * - 任何S3兼容存储
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type {
  CloudStorageConnector,
  ConnectorConfig,
  CloudBookMetadata,
  CloudReadingProgress,
  CloudBookmark,
} from '../../types/cloudStorage';
import { BaseCloudStorageConnector } from '../baseCloudStorageConnector';

interface S3Settings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  rootPath?: string;
  forcePathStyle?: boolean;
}

/**
 * S3兼容存储连接器 - 使用AWS SDK
 */
export class S3Connector extends BaseCloudStorageConnector implements CloudStorageConnector {
  readonly type = 's3';
  readonly displayName: string;
  
  private s3Client: S3Client | null = null;
  private bucket: string;
  private rootPath: string;

  constructor(config: ConnectorConfig) {
    super(config);
    this.displayName = config.name || 'S3 Compatible Storage';
    this.rootPath = (config.settings.rootPath as string) || '/SquirrelReader';
    this.bucket = (config.settings.bucket as string) || '';
    
    this.initClient();
  }

  private initClient(): void {
    const settings = this.config.settings as unknown as S3Settings;
    
    if (settings.endpoint && settings.bucket && settings.accessKeyId && settings.secretAccessKey) {
      const region = settings.region || this.extractRegionFromEndpoint(settings.endpoint) || 'us-east-1';
      
      // 检测是否应该使用路径格式
      // Backblaze B2和Cloudflare R2通常需要路径格式来避免CORS问题
      const isBackblaze = settings.endpoint.includes('backblazeb2.com');
      const isR2 = settings.endpoint.includes('.r2.cloudflarestorage.com');
      const isNonAws = isBackblaze || isR2;
      // 对于非AWS服务，默认启用路径格式以避免CORS问题
      const forcePathStyle = settings.forcePathStyle ?? isNonAws;

      this.s3Client = new S3Client({
        region,
        endpoint: settings.endpoint,
        credentials: {
          accessKeyId: settings.accessKeyId,
          secretAccessKey: settings.secretAccessKey,
        },
        forcePathStyle,
      });
      
      this.authStatus = 'authenticated';
    } else {
      this.authStatus = 'unauthenticated';
    }
  }

  /**
   * 从endpoint URL中提取region
   * 
   * 支持：
   * - AWS S3: s3.<region>.amazonaws.com
   * - Backblaze B2: s3.<region>.backblazeb2.com
   * - Cloudflare R2: <id>.r2.cloudflarestorage.com (返回 'auto')
   * - DigitalOcean Spaces: <region>.digitaloceanspaces.com
   */
  private extractRegionFromEndpoint(endpoint: string): string | null {
    try {
      const url = new URL(endpoint);
      const host = url.host;
      
      // 匹配 s3.<region>.backblazeb2.com 或 s3.<region>.amazonaws.com 格式
      const match = host.match(/s3\.([^.]+)\.(backblazeb2|amazonaws)\.com/);
      if (match) {
        return match[1];
      }
      
      // 匹配 Cloudflare R2: xxx.r2.cloudflarestorage.com
      if (host.includes('.r2.cloudflarestorage.com')) {
        return 'auto';
      }
      
      // 匹配 DigitalOcean Spaces: <region>.digitaloceanspaces.com
      const spacesMatch = host.match(/^([^.]+)\.digitaloceanspaces\.com/);
      if (spacesMatch) {
        return spacesMatch[1];
      }
      
      return null;
    } catch {
      return null;
    }
  }

  // S3不需要OAuth认证流程，直接使用API密钥
  async authenticate(): Promise<boolean> {
    return this.authStatus === 'authenticated';
  }

  async handleAuthCallback(_callbackData: Record<string, string>): Promise<boolean> {
    return true;
  }

  async refreshToken(): Promise<boolean> {
    return true;
  }

  async logout(): Promise<void> {
    this.s3Client = null;
    this.authStatus = 'unauthenticated';
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    if (!this.s3Client) {
      return { success: false, message: 'S3 client not initialized' };
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1,
        Prefix: this.rootPath + '/',
      });
      
      await this.s3Client.send(command);
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      return { success: false, message: errorMessage };
    }
  }

  async uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const key = `${this.rootPath}/books/${bookId}.epub`;
    const arrayBuffer = await fileData.arrayBuffer();
    const checksum = await this.generateChecksum(fileData);

    // 上传文件
    const putCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: new Uint8Array(arrayBuffer),
      ContentType: 'application/epub+zip',
    });

    await this.s3Client.send(putCommand);

    // 上传元数据
    const metaDataKey = `${this.rootPath}/metadata/${bookId}.json`;
    const metaData = {
      bookId,
      checksum,
      size: fileData.size,
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: metadata.localModifiedAt.toISOString(),
      version: 1,
    };

    const metaPutCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: metaDataKey,
      Body: JSON.stringify(metaData),
      ContentType: 'application/json',
    });

    await this.s3Client.send(metaPutCommand);

    return {
      ...metadata,
      remotePath: key,
      checksum,
      size: fileData.size,
    };
  }

  async downloadBook(remotePath: string): Promise<Blob> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
    });

    const response = await this.s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // 将响应流转换为Blob
    const chunks: Uint8Array[] = [];
    const reader = response.Body as ReadableStream<Uint8Array>;
    
    // 如果是ReadableStream
    if (reader instanceof ReadableStream) {
      const streamReader = reader.getReader();
      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;
        chunks.push(value);
      }
    } else {
      // 如果是其他类型（如Blob），直接转换
      const byteArray = await response.Body.transformToByteArray();
      return new Blob([byteArray.buffer as ArrayBuffer], { type: 'application/epub+zip' });
    }

    // 合并所有chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new Blob([combined.buffer as ArrayBuffer], { type: 'application/epub+zip' });
  }

  async deleteBook(remotePath: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
    });

    await this.s3Client.send(command);
  }

  async listBooks(): Promise<CloudBookMetadata[]> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const prefix = `${this.rootPath}/metadata/`;
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.s3Client.send(command);
    const books: CloudBookMetadata[] = [];

    if (!response.Contents) {
      return books;
    }

    for (const obj of response.Contents) {
      if (!obj.Key || !obj.Key.endsWith('.json')) continue;

      try {
        const getCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: obj.Key,
        });

        const data = await this.s3Client.send(getCommand);
        
        if (!data.Body) continue;
        
        const text = await data.Body.transformToString();
        const meta = JSON.parse(text);

        books.push({
          bookId: meta.bookId,
          remotePath: `${this.rootPath}/books/${meta.bookId}.epub`,
          size: meta.size,
          checksum: meta.checksum,
          localModifiedAt: new Date(meta.localModifiedAt),
          remoteModifiedAt: new Date(meta.remoteModifiedAt),
          syncStatus: 'synced',
          version: meta.version,
        });
      } catch (error) {
        console.error(`Failed to load metadata for ${obj.Key}:`, error);
      }
    }

    return books;
  }

  async bookExists(remotePath: string): Promise<boolean> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: remotePath,
      });

      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async uploadProgress(bookId: string, progress: CloudReadingProgress): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const key = `${this.rootPath}/progress/${bookId}.json`;
    const data = {
      ...progress,
      lastReadAt: progress.lastReadAt.toISOString(),
    };

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    });

    await this.s3Client.send(command);
  }

  async downloadProgress(bookId: string): Promise<CloudReadingProgress | null> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const key = `${this.rootPath}/progress/${bookId}.json`;
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        return null;
      }

      const text = await response.Body.transformToString();
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
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const prefix = `${this.rootPath}/progress/`;
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.s3Client.send(command);
    const progressList: CloudReadingProgress[] = [];

    if (!response.Contents) {
      return progressList;
    }

    for (const obj of response.Contents) {
      if (!obj.Key || !obj.Key.endsWith('.json')) continue;

      try {
        const getCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: obj.Key,
        });

        const data = await this.s3Client.send(getCommand);
        
        if (!data.Body) continue;
        
        const text = await data.Body.transformToString();
        const json = JSON.parse(text);

        progressList.push({
          ...json,
          lastReadAt: new Date(json.lastReadAt),
        });
      } catch (error) {
        console.error(`Failed to load progress for ${obj.Key}:`, error);
      }
    }

    return progressList;
  }

  async uploadBookmarks(bookId: string, bookmarks: CloudBookmark[]): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const key = `${this.rootPath}/bookmarks/${bookId}.json`;
    const data = bookmarks.map(b => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }));

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    });

    await this.s3Client.send(command);
  }

  async downloadBookmarks(bookId: string): Promise<CloudBookmark[]> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const key = `${this.rootPath}/bookmarks/${bookId}.json`;
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        return [];
      }

      const text = await response.Body.transformToString();
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
}
