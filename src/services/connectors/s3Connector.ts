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
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  CopyObjectCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import type {
  CloudStorageConnector,
  ConnectorConfig,
  CloudBookMetadata,
  CloudReadingProgress,
  CloudBookmark,
  UploadProgress,
  SyncOptions,
} from '../../types/cloudStorage';
import { BaseCloudStorageConnector } from '../baseCloudStorageConnector';
import type { Bookmark } from '../../types';

interface S3Settings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  rootPath?: string;
  forcePathStyle?: boolean;
}

export class S3Connector extends BaseCloudStorageConnector implements CloudStorageConnector {
  readonly type = 's3';
  readonly displayName: string;
  
  private s3Client: S3Client | null = null;
  private bucket: string;
  private rootPath: string;

  private readonly MULTIPART_THRESHOLD = 20 * 1024 * 1024;
  private readonly PART_SIZE = 5 * 1024 * 1024;

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
      
      const isBackblaze = settings.endpoint.includes('backblazeb2.com');
      const isR2 = settings.endpoint.includes('.r2.cloudflarestorage.com');
      const isNonAws = isBackblaze || isR2;
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

  private extractRegionFromEndpoint(endpoint: string): string | null {
    try {
      const url = new URL(endpoint);
      const host = url.host;
      
      const match = host.match(/s3\.([^.]+)\.(backblazeb2|amazonaws)\.com/);
      if (match) {
        return match[1];
      }
      
      if (host.includes('.r2.cloudflarestorage.com')) {
        return 'auto';
      }
      
      const spacesMatch = host.match(/^([^.]+)\.digitaloceanspaces\.com/);
      if (spacesMatch) {
        return spacesMatch[1];
      }
      
      return null;
    } catch {
      return null;
    }
  }

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

  // ==================== Book Upload (Atomic) ====================

  async uploadBookWithParts(
    bookId: string,
    bookData: Blob,
    coverData: Blob | null,
    metadata: CloudBookMetadata,
    fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata,
    format: 'epub' | 'pdf' = 'epub'
  ): Promise<CloudBookMetadata> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const uploadId = crypto.randomUUID();
    const extension = format === 'pdf' ? 'pdf' : 'epub';
    const tempPrefix = `${this.rootPath}/_temp/${uploadId}`;

    const bookKey = `${this.rootPath}/books/${bookId}.${extension}`;
    const metadataKey = `${this.rootPath}/metadata/${bookId}.json`;
    const coverKey = coverData ? `${this.rootPath}/covers/${bookId}.cover` : undefined;

    const tempBookKey = `${tempPrefix}/books/${bookId}.${extension}`;
    const tempMetadataKey = `${tempPrefix}/metadata/${bookId}.json`;
    const tempCoverKey = coverData ? `${tempPrefix}/covers/${bookId}.cover` : undefined;

    const bookChecksum = await this.generateChecksum(bookData);
    const metadataChecksum = await this.generateChecksum(new Blob([JSON.stringify(fullMetadata)]));
    let coverChecksum: string | undefined;

    try {
      await this.uploadToTemp(tempBookKey, bookData, {
        'book-id': bookId,
        'checksum': bookChecksum,
      });

      if (coverData && tempCoverKey) {
        coverChecksum = await this.generateChecksum(coverData);
        await this.uploadToTemp(tempCoverKey, coverData, {
          'book-id': bookId,
          'checksum': coverChecksum,
        });
      }

      const completeMetadata: import('../../types/cloudStorage').CloudBookFullMetadata = {
        ...fullMetadata,
        bookPath: bookKey,
        coverPath: coverKey,
        size: bookData.size,
        coverSize: coverData?.size,
        checksum: bookChecksum,
        coverChecksum,
        metadataChecksum,
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

      await this.uploadToTemp(tempMetadataKey, new Blob([JSON.stringify(completeMetadata)]));

      await this.commitUpload(uploadId, bookId, {
        [tempBookKey]: bookKey,
        [tempMetadataKey]: metadataKey,
        ...(tempCoverKey && coverKey ? { [tempCoverKey]: coverKey } : {}),
      });

      await this.rollbackUpload(uploadId);

      return {
        ...metadata,
        remotePath: bookKey,
        coverPath: coverKey,
        metadataPath: metadataKey,
        checksum: bookChecksum,
        coverChecksum,
        metadataChecksum,
        size: bookData.size,
        coverSize: coverData?.size,
        partsSyncStatus: completeMetadata.partsSyncStatus,
      };
    } catch (error) {
      await this.rollbackUpload(uploadId);
      throw error;
    }
  }

  async uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata> {
    const fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata = {
      bookId,
      metadata: { title: 'Unknown', author: 'Unknown' },
      bookPath: '',
      size: fileData.size,
      checksum: '',
      remoteModifiedAt: new Date().toISOString(),
      localModifiedAt: metadata.localModifiedAt.toISOString(),
      version: 1,
      partsSyncStatus: {
        metadata: 'pending',
        cover: 'missing',
        book: 'synced',
      },
    };

    return this.uploadBookWithParts(bookId, fileData, null, metadata, fullMetadata);
  }

  // ==================== Book Download ====================

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

    const chunks: Uint8Array[] = [];
    const reader = response.Body as ReadableStream<Uint8Array>;
    
    if (reader instanceof ReadableStream) {
      const streamReader = reader.getReader();
      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;
        chunks.push(value);
      }
    } else {
      const byteArray = await response.Body.transformToByteArray();
      return new Blob([byteArray as unknown as BlobPart], { type: 'application/epub+zip' });
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new Blob([combined], { type: 'application/epub+zip' });
  }

  async downloadBookWithParts(
    metadata: CloudBookMetadata
  ): Promise<{
    bookData: Blob;
    coverData: Blob | null;
    fullMetadata: import('../../types/cloudStorage').CloudBookFullMetadata;
  }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const fullMetadata = await this.downloadBookMetadata(metadata.metadataPath);
    const bookData = await this.downloadBook(metadata.remotePath);

    let coverData: Blob | null = null;
    if (metadata.coverPath) {
      try {
        coverData = await this.downloadCover(metadata.coverPath);
      } catch (error) {
        console.warn(`Failed to download cover for ${metadata.bookId}:`, error);
      }
    }

    return { bookData, coverData, fullMetadata };
  }

  async downloadBookMetadata(
    metadataPath: string
  ): Promise<import('../../types/cloudStorage').CloudBookFullMetadata> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: metadataPath,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('Empty metadata response body');
    }

    const text = await response.Body.transformToString();
    const meta = JSON.parse(text);

    return {
      ...meta,
      localModifiedAt: meta.localModifiedAt,
      remoteModifiedAt: meta.remoteModifiedAt,
    };
  }

  private async downloadCover(coverPath: string): Promise<Blob> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: coverPath,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('Empty cover response body');
    }

    const byteArray = await response.Body.transformToByteArray();
    return new Blob([byteArray as unknown as BlobPart], { type: 'image/jpeg' });
  }

  // ==================== Book Management ====================

  async deleteBook(paths: {
    remotePath: string;
    coverPath?: string;
    metadataPath?: string;
  }): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const { remotePath, coverPath, metadataPath } = paths;
    const keysToDelete = [remotePath];
    if (coverPath) keysToDelete.push(coverPath);
    if (metadataPath) keysToDelete.push(metadataPath);

    for (const key of keysToDelete) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        });
        await this.s3Client.send(command);
      } catch (error) {
        console.warn(`Failed to delete ${key}:`, error);
      }
    }
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
          remotePath: meta.bookPath || `${this.rootPath}/books/${meta.bookId}.epub`,
          coverPath: meta.coverPath,
          metadataPath: obj.Key,
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

  async checkBookPartsExists(
    metadata: CloudBookMetadata
  ): Promise<{
    metadata: boolean;
    cover: boolean;
    book: boolean;
  }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const results = { metadata: false, cover: false, book: false };

    try {
      const metadataCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: metadata.metadataPath,
      });
      await this.s3Client.send(metadataCommand);
      results.metadata = true;
    } catch {
      results.metadata = false;
    }

    try {
      if (metadata.coverPath) {
        const coverCommand = new HeadObjectCommand({
          Bucket: this.bucket,
          Key: metadata.coverPath,
        });
        await this.s3Client.send(coverCommand);
        results.cover = true;
      }
    } catch {
      results.cover = false;
    }

    try {
      const bookCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: metadata.remotePath,
      });
      await this.s3Client.send(bookCommand);
      results.book = true;
    } catch {
      results.book = false;
    }

    return results;
  }

  // ==================== Progress ====================

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

  // ==================== Bookmarks ====================

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

  // ==================== Multipart Upload ====================

  private async uploadWithMultipart(
    key: string,
    blob: Blob,
    metadata?: Record<string, string>,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const totalParts = Math.ceil(blob.size / this.PART_SIZE);
    const startTime = Date.now();
    let uploadedBytes = 0;

    const createResponse = await this.s3Client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: this.getContentType(key),
      Metadata: metadata,
    }));

    if (!createResponse.UploadId) {
      throw new Error('Failed to create multipart upload');
    }

    const uploadId = createResponse.UploadId;

    try {
      const etags: { ETag: string; PartNumber: number }[] = [];

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * this.PART_SIZE;
        const end = Math.min(start + this.PART_SIZE, blob.size);
        const partBlob = blob.slice(start, end);
        const partBuffer = await partBlob.arrayBuffer();

        const uploadResponse = await this.s3Client.send(new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: new Uint8Array(partBuffer),
        }));

        if (!uploadResponse.ETag) {
          throw new Error(`Failed to upload part ${partNumber}`);
        }

        etags.push({ ETag: uploadResponse.ETag, PartNumber: partNumber });
        uploadedBytes = end;

        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
          onProgress({
            loaded: uploadedBytes,
            total: blob.size,
            percent: Math.round((uploadedBytes / blob.size) * 100),
            speed,
          });
        }
      }

      await this.s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: etags },
      }));
    } catch (error) {
      try {
        await this.s3Client.send(new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }));
      } catch {
        // Ignore abort errors
      }
      throw error;
    }
  }

  async resumeMultipartUpload(
    key: string,
    uploadId: string,
    blob: Blob,
    totalParts: number,
    partSize: number,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const startTime = Date.now();
    let uploadedBytes = 0;

    try {
      const listResponse = await this.s3Client.send(new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }));

      const existingParts = new Map(
        listResponse.Parts?.map(p => [p.PartNumber, p.ETag]) || []
      );

      const etags: { ETag: string; PartNumber: number }[] = [];

      for (const [partNum, etag] of existingParts) {
        if (etag && partNum !== undefined) {
          etags.push({ ETag: etag, PartNumber: partNum });
        }
      }

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (existingParts.has(partNumber)) continue;

        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, blob.size);
        const partBlob = blob.slice(start, end);
        const partBuffer = await partBlob.arrayBuffer();

        const uploadResponse = await this.s3Client.send(new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: new Uint8Array(partBuffer),
        }));

        if (!uploadResponse.ETag) {
          throw new Error(`Failed to upload part ${partNumber}`);
        }

        etags.push({ ETag: uploadResponse.ETag, PartNumber: partNumber });
        uploadedBytes = end;

        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
          onProgress({
            loaded: uploadedBytes,
            total: blob.size,
            percent: Math.round((uploadedBytes / blob.size) * 100),
            speed,
          });
        }
      }

      await this.s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: etags },
      }));
    } catch (error) {
      throw error;
    }
  }

  // ==================== Atomic Upload Helpers ====================

  private async uploadToTemp(
    key: string,
    data: Blob,
    metadata?: Record<string, string>
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    if (data.size > this.MULTIPART_THRESHOLD) {
      await this.uploadWithMultipart(key, data, metadata);
    } else {
      const arrayBuffer = await data.arrayBuffer();
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: new Uint8Array(arrayBuffer),
        ContentType: this.getContentType(key),
        Metadata: metadata,
      }));
    }
  }

  private async commitUpload(
    _uploadId: string,
    _bookId: string,
    copyMap: Record<string, string>
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    for (const [sourceKey, destKey] of Object.entries(copyMap)) {
      await this.s3Client.send(new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destKey,
      }));
    }
  }

  async rollbackUpload(uploadId: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const tempPrefix = `${this.rootPath}/_temp/${uploadId}/`;

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: tempPrefix,
      });

      const response = await this.s3Client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            await this.s3Client.send(new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: obj.Key,
            }));
          }
        }
      }
    } catch (error) {
      console.warn('Failed to rollback temp files:', error);
    }
  }

  async cleanupTempFiles(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const tempPrefix = `${this.rootPath}/_temp/`;
    let deletedCount = 0;

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: tempPrefix,
      });

      const response = await this.s3Client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && obj.LastModified) {
            const fileAge = Date.now() - obj.LastModified.getTime();
            if (fileAge > maxAge) {
              await this.s3Client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: obj.Key,
              }));
              deletedCount++;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup temp files:', error);
    }

    return deletedCount;
  }

  // ==================== Sync Methods ====================

  protected async syncSingleBookProgress(bookId: string, _options?: SyncOptions): Promise<void> {
    const { getProgress, saveProgress } = await import('../../db');

    const localProgress = await getProgress(bookId);
    const remoteProgress = await this.downloadProgress(bookId);

    if (!localProgress && !remoteProgress) return;

    if (!remoteProgress && localProgress) {
      const cloudProgress: CloudReadingProgress = {
        bookId,
        currentChapter: localProgress.currentChapter,
        currentPosition: localProgress.currentPosition,
        lastReadAt: new Date(localProgress.lastReadAt),
        totalProgress: localProgress.totalProgress,
        deviceId: 'local',
        version: Date.now(),
      };
      await this.uploadProgress(bookId, cloudProgress);
      return;
    }

    if (remoteProgress && !localProgress) {
      await saveProgress({
        bookId,
        currentChapter: remoteProgress.currentChapter,
        currentPosition: remoteProgress.currentPosition,
        lastReadAt: remoteProgress.lastReadAt,
        totalProgress: remoteProgress.totalProgress,
      });
      return;
    }

    if (localProgress && remoteProgress) {
      const localTime = new Date(localProgress.lastReadAt).getTime();
      const remoteTime = remoteProgress.lastReadAt.getTime();

      let merged: CloudReadingProgress;

      if (remoteTime > localTime) {
        merged = {
          ...remoteProgress,
          currentPosition: Math.max(localProgress.currentPosition, remoteProgress.currentPosition),
          version: Date.now(),
        };
      } else {
        merged = {
          bookId,
          currentChapter: localProgress.currentChapter,
          currentPosition: Math.max(localProgress.currentPosition, remoteProgress.currentPosition),
          lastReadAt: new Date(localProgress.lastReadAt),
          totalProgress: Math.max(localProgress.totalProgress, remoteProgress.totalProgress),
          deviceId: 'local',
          version: Date.now(),
        };
      }

      await this.uploadProgress(bookId, merged);

      await saveProgress({
        bookId,
        currentChapter: merged.currentChapter,
        currentPosition: merged.currentPosition,
        lastReadAt: merged.lastReadAt,
        totalProgress: merged.totalProgress,
      });
    }
  }

  protected async syncSingleBookBookmarks(bookId: string, _options?: SyncOptions): Promise<void> {
    const { getBookmarks, addBookmark, deleteBookmark } = await import('../../db');

    const localBookmarks = await getBookmarks(bookId);
    const remoteBookmarks = await this.downloadBookmarks(bookId);

    if (localBookmarks.length === 0 && remoteBookmarks.length === 0) return;

    const bookmarkMap = new Map<string, CloudBookmark>();

    for (const bm of remoteBookmarks) {
      const key = `${bm.chapterId}:${bm.position}`;
      bookmarkMap.set(key, bm);
    }

    for (const bm of localBookmarks) {
      const key = `${bm.chapterId}:${bm.position}`;
      const existing = bookmarkMap.get(key);
      if (!existing || new Date(bm.createdAt) > new Date(existing.createdAt)) {
        bookmarkMap.set(key, {
          id: bm.id,
          bookId: bm.bookId,
          chapterId: bm.chapterId,
          position: bm.position,
          text: bm.text,
          createdAt: new Date(bm.createdAt),
        });
      }
    }

    const mergedBookmarks = Array.from(bookmarkMap.values());

    await this.uploadBookmarks(bookId, mergedBookmarks);

    const mergedIds = new Set(mergedBookmarks.map(b => b.id));
    const localIds = new Set(localBookmarks.map(b => b.id));

    for (const bm of localBookmarks) {
      if (!mergedIds.has(bm.id)) {
        await deleteBookmark(bm.id);
      }
    }

    for (const bm of mergedBookmarks) {
      if (!localIds.has(bm.id)) {
        await addBookmark({
          id: bm.id,
          bookId: bm.bookId,
          chapterId: bm.chapterId,
          position: bm.position,
          text: bm.text,
          createdAt: new Date(bm.createdAt),
        } as Bookmark);
      }
    }
  }

  // ==================== Utility Methods ====================

  private getContentType(key: string): string {
    if (key.endsWith('.pdf')) return 'application/pdf';
    if (key.endsWith('.epub')) return 'application/epub+zip';
    if (key.endsWith('.json')) return 'application/json';
    if (key.endsWith('.cover')) return 'image/jpeg';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
  }
}
