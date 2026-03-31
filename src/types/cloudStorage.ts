/**
 * 云存储连接器核心接口定义
 * 
 * 设计原则：
 * 1. 解耦：连接器与具体云存储实现完全解耦
 * 2. 可扩展：用户可以轻松添加新的连接器
 * 3. 幂等性：同步操作支持冲突解决
 * 4. 离线优先：支持本地缓存和离线操作
 */

// ==================== 基础类型定义 ====================

/**
 * 连接器认证状态
 */
export type AuthStatus = 
  | 'unauthenticated'   // 未认证
  | 'authenticating'    // 认证中
  | 'authenticated'     // 已认证
  | 'expired'           // 认证已过期
  | 'error';            // 认证错误

/**
 * 连接器配置信息
 */
export interface ConnectorConfig {
  /** 唯一标识符 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 连接器类型标识 */
  type: string;
  /** 用户自定义配置 */
  settings: Record<string, unknown>;
  /** 最后同步时间 */
  lastSyncAt?: Date;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 存储元数据 - 用于云端书籍索引
 */
export interface CloudBookMetadata {
  /** 书籍ID */
  bookId: string;
  /** 书籍在云端的路径 */
  remotePath: string;
  /** 封面在云端的路径 */
  coverPath?: string;
  /** 元信息文件在云端的路径 */
  metadataPath: string;
  /** 文件大小（字节） */
  size: number;
  /** 封面文件大小（字节） */
  coverSize?: number;
  /** 文件校验和 */
  checksum: string;
  /** 封面校验和 */
  coverChecksum?: string;
  /** 元信息校验和 */
  metadataChecksum?: string;
  /** 云端最后修改时间 */
  remoteModifiedAt: Date;
  /** 本地最后修改时间 */
  localModifiedAt: Date;
  /** 同步状态 */
  syncStatus: SyncStatus;
  /** 版本号（用于冲突解决） */
  version: number;
  /** 各部分同步状态 */
  partsSyncStatus?: {
    metadata: 'synced' | 'pending' | 'missing';
    cover: 'synced' | 'pending' | 'missing';
    book: 'synced' | 'pending' | 'missing';
  };
}

/**
 * 同步状态
 */
export type SyncStatus = 
  | 'synced'      // 已同步
  | 'pending'     // 等待同步
  | 'conflict'    // 存在冲突
  | 'error'       // 同步错误
  | 'local_only'  // 仅本地存在
  | 'remote_only'; // 仅云端存在

/**
 * 书籍完整元数据 - 存储在云端
 */
export interface CloudBookFullMetadata {
  /** 书籍ID */
  bookId: string;
  /** 书籍元信息 */
  metadata: {
    title: string;
    author: string;
    description?: string;
    language?: string;
    publisher?: string;
    publicationDate?: string;
    identifier?: string;
  };
  /** 封面图片路径（相对于存储根目录） */
  coverPath?: string;
  /** 书籍文件路径（相对于存储根目录） */
  bookPath: string;
  /** 元信息文件路径（相对于存储根目录） */
  metadataPath?: string;
  /** 文件大小（字节） */
  size: number;
  /** 封面大小（字节） */
  coverSize?: number;
  /** 文件校验和 */
  checksum: string;
  /** 封面校验和 */
  coverChecksum?: string;
  /** 元信息校验和 */
  metadataChecksum?: string;
  /** 云端最后修改时间 */
  remoteModifiedAt: string;
  /** 本地最后修改时间 */
  localModifiedAt: string;
  /** 版本号 */
  version: number;
  /** 各部分同步状态 */
  partsSyncStatus: {
    metadata: 'synced' | 'pending' | 'missing';
    cover: 'synced' | 'pending' | 'missing';
    book: 'synced' | 'pending' | 'missing';
  };
  /** 书籍格式（epub 或 pdf） */
  format?: 'epub' | 'pdf';
}

/**
 * 阅读进度同步数据
 */
export interface CloudReadingProgress {
  bookId: string;
  currentChapter: string;
  currentPosition: number;
  lastReadAt: Date;
  totalProgress: number;
  /** 设备标识 */
  deviceId: string;
  /** 版本时间戳 */
  version: number;
}

/**
 * 书签同步数据
 */
export interface CloudBookmark {
  id: string;
  bookId: string;
  chapterId: string;
  position: number;
  text: string;
  createdAt: Date;
  /** 书签颜色/分类 */
  color?: string;
  /** 笔记内容 */
  note?: string;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  timestamp: Date;
  /** 更新的书籍数量 */
  booksUpdated: number;
  /** 更新的进度数量 */
  progressUpdated: number;
  /** 更新的书签数量 */
  bookmarksUpdated: number;
  /** 冲突列表 */
  conflicts: SyncConflict[];
  /** 错误信息 */
  errors?: string[];
}

/**
 * 同步冲突
 */
export interface SyncConflict {
  type: 'book' | 'progress' | 'bookmark';
  id: string;
  localVersion: unknown;
  remoteVersion: unknown;
  localTimestamp: Date;
  remoteTimestamp: Date;
}

/**
 * 同步选项
 */
export interface SyncOptions {
  /** 同步书籍文件 */
  syncBooks?: boolean;
  /** 同步阅读进度 */
  syncProgress?: boolean;
  /** 同步书签 */
  syncBookmarks?: boolean;
  /** 冲突解决策略 */
  conflictStrategy?: 'local_wins' | 'remote_wins' | 'newest_wins' | 'manual';
  /** 是否强制覆盖 */
  force?: boolean;
  /** 进度回调 */
  onProgress?: (progress: number, message: string) => void;
}

// ==================== 连接器接口定义 ====================

/**
 * 云存储连接器接口
 * 
 * 所有云存储实现必须实现此接口
 */
export interface CloudStorageConnector {
  /** 连接器类型标识（如 'dropbox', 'googledrive', 's3'） */
  readonly type: string;
  
  /** 连接器显示名称 */
  readonly displayName: string;
  
  /** 连接器配置 */
  config: ConnectorConfig;
  
  // ==================== 认证相关 ====================
  
  /**
   * 获取当前认证状态
   */
  getAuthStatus(): AuthStatus;
  
  /**
   * 启动认证流程
   * @returns 认证是否成功启动
   */
  authenticate(): Promise<boolean>;
  
  /**
   * 处理认证回调（用于OAuth2等）
   * @param callbackData 回调数据（URL参数、token等）
   * @returns 认证结果
   */
  handleAuthCallback(callbackData: Record<string, string>): Promise<boolean>;
  
  /**
   * 刷新访问令牌
   * @returns 刷新是否成功
   */
  refreshToken(): Promise<boolean>;
  
  /**
   * 登出/撤销授权
   */
  logout(): Promise<void>;
  
  // ==================== 连接管理 ====================
  
  /**
   * 测试连接是否可用
   * @returns 连接测试结果
   */
  testConnection(): Promise<{ success: boolean; message?: string }>;
  
  /**
   * 更新连接器配置
   * @param config 新配置
   */
  updateConfig(config: Partial<ConnectorConfig>): Promise<void>;
  
  // ==================== 书籍操作 ====================
  
  /**
   * 上传书籍到云端（分离存储版本）
   * @param bookId 书籍ID
   * @param bookData 书籍文件数据
   * @param coverData 封面图片数据（可选）
   * @param metadata 书籍完整元数据
   * @param fullMetadata 书籍完整元信息对象
   * @param format 书籍格式（epub 或 pdf）
   * @returns 云端书籍元数据
   */
  uploadBookWithParts(
    bookId: string,
    bookData: Blob,
    coverData: Blob | null,
    metadata: CloudBookMetadata,
    fullMetadata: CloudBookFullMetadata,
    format?: 'epub' | 'pdf'
  ): Promise<CloudBookMetadata>;
  
  /**
   * 上传书籍到云端（兼容旧版本）
   * @param bookId 书籍ID
   * @param fileData 书籍文件数据
   * @param metadata 书籍元数据
   * @returns 云端书籍元数据
   */
  uploadBook(
    bookId: string,
    fileData: Blob,
    metadata: CloudBookMetadata
  ): Promise<CloudBookMetadata>;
  
  /**
   * 从云端下载书籍（分离存储版本）
   * @param metadata 云端书籍元数据
   * @returns 包含书籍文件、封面和元信息的对象
   */
  downloadBookWithParts(metadata: CloudBookMetadata): Promise<{
    bookData: Blob;
    coverData: Blob | null;
    fullMetadata: CloudBookFullMetadata;
  }>;
  
  /**
   * 从云端下载书籍
   * @param remotePath 云端路径
   * @returns 书籍文件数据
   */
  downloadBook(remotePath: string): Promise<Blob>;
  
  /**
   * 删除云端书籍（包括书籍文件、封面和元信息）
   * @param paths 包含书籍、封面和元信息路径的对象
   */
  deleteBook(paths: {
    remotePath: string;
    coverPath?: string;
    metadataPath?: string;
  }): Promise<void>;
  
  /**
   * 获取云端书籍列表（包含完整元信息）
   * @returns 云端书籍元数据列表
   */
  listBooks(): Promise<CloudBookMetadata[]>;
  
  /**
   * 获取云端书籍完整元信息
   * @param metadataPath 元信息文件路径
   * @returns 完整元信息对象
   */
  downloadBookMetadata(metadataPath: string): Promise<CloudBookFullMetadata>;
  
  /**
   * 检查云端书籍各部分是否存在
   * @param metadata 云端书籍元数据
   * @returns 各部分是否存在
   */
  checkBookPartsExists(metadata: CloudBookMetadata): Promise<{
    metadata: boolean;
    cover: boolean;
    book: boolean;
  }>;
  
  /**
   * 检查云端书籍是否存在
   * @param remotePath 云端路径
   * @returns 是否存在
   */
  bookExists(remotePath: string): Promise<boolean>;
  
  // ==================== 阅读进度操作 ====================
  
  /**
   * 上传阅读进度
   * @param bookId 书籍ID
   * @param progress 阅读进度数据
   */
  uploadProgress(
    bookId: string,
    progress: CloudReadingProgress
  ): Promise<void>;
  
  /**
   * 下载阅读进度
   * @param bookId 书籍ID
   * @returns 阅读进度数据，如果不存在返回null
   */
  downloadProgress(bookId: string): Promise<CloudReadingProgress | null>;
  
  /**
   * 获取所有阅读进度
   * @returns 阅读进度列表
   */
  listAllProgress(): Promise<CloudReadingProgress[]>;
  
  // ==================== 书签操作 ====================
  
  /**
   * 上传书签
   * @param bookId 书籍ID
   * @param bookmarks 书签列表
   */
  uploadBookmarks(
    bookId: string,
    bookmarks: CloudBookmark[]
  ): Promise<void>;
  
  /**
   * 下载书签
   * @param bookId 书籍ID
   * @returns 书签列表
   */
  downloadBookmarks(bookId: string): Promise<CloudBookmark[]>;
  
  /**
   * 删除书签
   * @param bookId 书籍ID
   * @param bookmarkId 书签ID
   */
  deleteBookmark(bookId: string, bookmarkId: string): Promise<void>;
  
  // ==================== 同步操作 ====================
  
  /**
   * 执行完整同步
   * @param options 同步选项
   * @returns 同步结果
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
  
  /**
   * 同步单本书籍
   * @param bookId 书籍ID
   * @param options 同步选项
   * @returns 同步结果
   */
  syncBook(bookId: string, options?: SyncOptions): Promise<SyncResult>;
  
  /**
   * 同步单本书的阅读进度
   * @param bookId 书籍ID
   */
  syncBookProgress(bookId: string, options?: SyncOptions): Promise<void>;
  
  /**
   * 同步单本书的书签
   * @param bookId 书籍ID
   */
  syncBookBookmarks(bookId: string, options?: SyncOptions): Promise<void>;
  
  /**
   * 解决同步冲突
   * @param conflict 冲突信息
   * @param resolution 解决方案（'local' | 'remote' | 'merge'）
   */
  resolveConflict(
    conflict: SyncConflict,
    resolution: 'local' | 'remote' | 'merge'
  ): Promise<void>;
  
  // ==================== 事件监听 ====================
  
  /**
   * 监听认证状态变化
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  onAuthStatusChange(callback: (status: AuthStatus) => void): () => void;
  
  /**
   * 监听同步进度
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  onSyncProgress(callback: (progress: number, message: string) => void): () => void;
}

/**
 * 上传进度
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  speed: number;
}

/**
 * 下载进度
 */
export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * 上传会话（用于断点续传）
 */
export interface UploadSession {
  uploadId: string;
  bookId: string;
  connectorId: string;
  key: string;
  totalSize: number;
  uploadedParts: number[];
  totalParts: number;
  partSize: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * 进度同步结果
 */
export interface SyncProgressResult {
  success: boolean;
  strategy: 'local_wins' | 'remote_wins' | 'merge';
  localVersion?: CloudReadingProgress;
  remoteVersion?: CloudReadingProgress;
  mergedVersion?: CloudReadingProgress;
}

/**
 * 书签同步结果
 */
export interface SyncBookmarkResult {
  success: boolean;
  added: number;
  removed: number;
  merged: number;
}

// ==================== 连接器工厂 ====================

/**
 * 连接器构造函数类型
 */
export type ConnectorConstructor = new (
  config: ConnectorConfig
) => CloudStorageConnector;

/**
 * 连接器注册表
 */
export interface ConnectorRegistry {
  /**
   * 注册连接器类型
   * @param type 类型标识
   * @param constructor 连接器构造函数
   */
  register(type: string, constructor: ConnectorConstructor): void;
  
  /**
   * 创建连接器实例
   * @param type 类型标识
   * @param config 连接器配置
   * @returns 连接器实例
   */
  create(type: string, config: ConnectorConfig): CloudStorageConnector;
  
  /**
   * 获取已注册的连接器类型列表
   * @returns 类型列表
   */
  getRegisteredTypes(): string[];
  
  /**
   * 获取连接器类型信息
   * @param type 类型标识
   * @returns 类型信息（名称、描述、所需配置项等）
   */
  getTypeInfo(type: string): ConnectorTypeInfo | undefined;
}

/**
 * 连接器类型信息
 */
export interface ConnectorTypeInfo {
  type: string;
  displayName: string;
  description: string;
  icon?: string;
  /** 需要的配置字段 */
  requiredSettings: SettingField[];
  /** 可选的配置字段 */
  optionalSettings: SettingField[];
  /** 支持的认证方式 */
  authMethods: ('oauth2' | 'api_key' | 'credentials')[];
  /** 官方文档链接 */
  documentationUrl?: string;
}

/**
 * 配置字段定义
 */
export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'url';
  description?: string;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required: boolean;
}

// ==================== 存储管理器接口 ====================

/**
 * 多连接器存储管理器
 * 
 * 管理多个云存储连接器的生命周期和同步
 */
export interface MultiCloudStorageManager {
  /**
   * 注册连接器实例
   * @param connector 连接器实例
   */
  registerConnector(connector: CloudStorageConnector): void;
  
  /**
   * 移除连接器
   * @param connectorId 连接器ID
   */
  unregisterConnector(connectorId: string): void;
  
  /**
   * 获取所有已注册的连接器
   * @returns 连接器列表
   */
  getConnectors(): CloudStorageConnector[];
  
  /**
   * 获取指定连接器
   * @param connectorId 连接器ID
   * @returns 连接器实例
   */
  getConnector(connectorId: string): CloudStorageConnector | undefined;
  
  /**
   * 同步所有连接器
   * @param options 同步选项
   * @returns 各连接器的同步结果
   */
  syncAll(options?: SyncOptions): Promise<Map<string, SyncResult>>;
  
  /**
   * 同步指定连接器
   * @param connectorId 连接器ID
   * @param options 同步选项
   * @returns 同步结果
   */
  syncConnector(
    connectorId: string,
    options?: SyncOptions
  ): Promise<SyncResult>;
  
  /**
   * 同步单本书籍到所有连接器
   * @param bookId 书籍ID
   * @param options 同步选项
   */
  syncBookToAll(bookId: string, options?: SyncOptions): Promise<void>;
  
  /**
   * 监听连接器变化
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  onConnectorsChange(
    callback: (connectors: CloudStorageConnector[]) => void
  ): () => void;
  
  /**
   * 监听全局同步状态
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  onGlobalSyncStatus(
    callback: (status: { 
      syncing: boolean; 
      progress: number; 
      message: string 
    }) => void
  ): () => void;
}

// ==================== 存储事件类型 ====================

/**
 * 存储事件
 */
export type StorageEvent = 
  | { type: 'auth_status_changed'; connectorId: string; status: AuthStatus }
  | { type: 'sync_started'; connectorId: string; timestamp: Date }
  | { type: 'sync_completed'; connectorId: string; result: SyncResult }
  | { type: 'sync_failed'; connectorId: string; error: Error }
  | { type: 'conflict_detected'; connectorId: string; conflict: SyncConflict }
  | { type: 'book_uploaded'; connectorId: string; bookId: string }
  | { type: 'book_downloaded'; connectorId: string; bookId: string }
  | { type: 'progress_synced'; connectorId: string; bookId: string }
  | { type: 'connector_registered'; connectorId: string }
  | { type: 'connector_unregistered'; connectorId: string };

/**
 * 存储事件监听器
 */
export type StorageEventListener = (event: StorageEvent) => void;

// ==================== 错误类型 ====================

/**
 * 存储操作错误
 */
export class StorageError extends Error {
  readonly code: string;
  readonly connectorType?: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    connectorType?: string,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.connectorType = connectorType;
    this.recoverable = recoverable;
  }
}

/**
 * 认证错误
 */
export class AuthError extends StorageError {
  readonly originalError?: Error;

  constructor(
    message: string,
    originalError?: Error
  ) {
    super(message, 'AUTH_ERROR', undefined, true);
    this.name = 'AuthError';
    this.originalError = originalError;
  }
}

/**
 * 同步错误
 */
export class SyncError extends StorageError {
  readonly conflicts?: SyncConflict[];
  readonly partialSuccess: boolean;

  constructor(
    message: string,
    conflicts?: SyncConflict[],
    partialSuccess: boolean = false
  ) {
    super(message, 'SYNC_ERROR', undefined, partialSuccess);
    this.name = 'SyncError';
    this.conflicts = conflicts;
    this.partialSuccess = partialSuccess;
  }
}

/**
 * 网络错误
 */
export class NetworkError extends StorageError {
  readonly retryable: boolean;

  constructor(
    message: string,
    retryable: boolean = true
  ) {
    super(message, 'NETWORK_ERROR', undefined, retryable);
    this.name = 'NetworkError';
    this.retryable = retryable;
  }
}
