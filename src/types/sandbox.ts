/**
 * Service Worker 沙箱隔离层 - 安全架构设计
 * 
 * 安全目标：
 * 1. 防止恶意连接器代码访问主应用上下文
 * 2. 限制连接器的API访问权限
 * 3. 防止XSS和代码注入攻击
 * 4. 通过进程隔离保护用户数据
 * 
 * 架构设计：
 * 主应用 <-> 通信层(postMessage) <-> Service Worker <-> 沙箱环境
 */

// ==================== 沙箱通信协议 ====================

/**
 * 从主应用发送到Service Worker的消息类型
 */
export type SandboxRequest = 
  | { type: 'INIT_CONNECTOR'; connectorId: string; connectorType: string; config: Record<string, unknown> }
  | { type: 'AUTHENTICATE'; connectorId: string }
  | { type: 'HANDLE_AUTH_CALLBACK'; connectorId: string; callbackData: Record<string, string> }
  | { type: 'REFRESH_TOKEN'; connectorId: string }
  | { type: 'LOGOUT'; connectorId: string }
  | { type: 'TEST_CONNECTION'; connectorId: string }
  | { type: 'UPLOAD_BOOK'; connectorId: string; bookId: string; fileData: ArrayBuffer; metadata: Record<string, unknown> }
  | { type: 'DOWNLOAD_BOOK'; connectorId: string; remotePath: string }
  | { type: 'DELETE_BOOK'; connectorId: string; remotePath: string }
  | { type: 'LIST_BOOKS'; connectorId: string }
  | { type: 'BOOK_EXISTS'; connectorId: string; remotePath: string }
  | { type: 'UPLOAD_PROGRESS'; connectorId: string; bookId: string; progress: Record<string, unknown> }
  | { type: 'DOWNLOAD_PROGRESS'; connectorId: string; bookId: string }
  | { type: 'LIST_ALL_PROGRESS'; connectorId: string }
  | { type: 'UPLOAD_BOOKMARKS'; connectorId: string; bookId: string; bookmarks: Record<string, unknown>[] }
  | { type: 'DOWNLOAD_BOOKMARKS'; connectorId: string; bookId: string }
  | { type: 'DELETE_BOOKMARK'; connectorId: string; bookId: string; bookmarkId: string }
  | { type: 'SYNC'; connectorId: string; options?: Record<string, unknown> }
  | { type: 'SYNC_BOOK'; connectorId: string; bookId: string; options?: Record<string, unknown> }
  | { type: 'DISPOSE_CONNECTOR'; connectorId: string }
  | { type: 'UPDATE_CONFIG'; connectorId: string; config: Record<string, unknown> };

/**
 * 从Service Worker发送回主应用的响应/事件类型
 */
export type SandboxResponse = 
  | { type: 'INIT_COMPLETE'; connectorId: string; success: boolean; error?: string }
  | { type: 'AUTH_RESULT'; connectorId: string; success: boolean; error?: string }
  | { type: 'AUTH_CALLBACK_HANDLED'; connectorId: string; success: boolean; error?: string }
  | { type: 'TOKEN_REFRESHED'; connectorId: string; success: boolean; error?: string }
  | { type: 'LOGOUT_COMPLETE'; connectorId: string; success: boolean }
  | { type: 'CONNECTION_TESTED'; connectorId: string; success: boolean; message?: string }
  | { type: 'BOOK_UPLOADED'; connectorId: string; bookId: string; metadata: Record<string, unknown> }
  | { type: 'BOOK_DOWNLOADED'; connectorId: string; remotePath: string; fileData: ArrayBuffer }
  | { type: 'BOOK_DELETED'; connectorId: string; remotePath: string }
  | { type: 'BOOKS_LISTED'; connectorId: string; books: Record<string, unknown>[] }
  | { type: 'BOOK_EXISTS_RESULT'; connectorId: string; remotePath: string; exists: boolean }
  | { type: 'PROGRESS_UPLOADED'; connectorId: string; bookId: string }
  | { type: 'PROGRESS_DOWNLOADED'; connectorId: string; bookId: string; progress: Record<string, unknown> | null }
  | { type: 'ALL_PROGRESS_LISTED'; connectorId: string; progressList: Record<string, unknown>[] }
  | { type: 'BOOKMARKS_UPLOADED'; connectorId: string; bookId: string }
  | { type: 'BOOKMARKS_DOWNLOADED'; connectorId: string; bookId: string; bookmarks: Record<string, unknown>[] }
  | { type: 'BOOKMARK_DELETED'; connectorId: string; bookId: string; bookmarkId: string }
  | { type: 'SYNC_COMPLETE'; connectorId: string; result: Record<string, unknown> }
  | { type: 'SYNC_FAILED'; connectorId: string; error: string }
  | { type: 'CONFIG_UPDATED'; connectorId: string; success: boolean }
  | { type: 'DISPOSE_COMPLETE'; connectorId: string }
  // 事件通知
  | { type: 'AUTH_STATUS_CHANGED'; connectorId: string; status: string }
  | { type: 'SYNC_PROGRESS'; connectorId: string; progress: number; message: string }
  | { type: 'CONFLICT_DETECTED'; connectorId: string; conflict: Record<string, unknown> }
  | { type: 'ERROR'; connectorId: string; error: string; code?: string };

/**
 * 沙箱通信消息包装器
 */
export interface SandboxMessage {
  /** 消息ID，用于匹配请求和响应 */
  id: string;
  /** 消息方向：request | response | event */
  direction: 'request' | 'response' | 'event';
  /** 消息时间戳 */
  timestamp: number;
  /** 消息载荷 */
  payload: SandboxRequest | SandboxResponse;
}

// ==================== 沙箱安全策略 ====================

/**
 * 沙箱权限配置
 */
export interface SandboxPermissions {
  /** 允许访问的网络域 */
  allowedDomains: string[];
  /** 允许的API端点（正则表达式模式） */
  allowedApiPatterns: string[];
  /** 允许的操作 */
  allowedOperations: ('fetch' | 'storage' | 'auth' | 'crypto')[];
  /** 最大存储使用量（字节） */
  maxStorageSize: number;
  /** 请求超时时间（毫秒） */
  requestTimeout: number;
  /** 允许的最大重试次数 */
  maxRetries: number;
}

/**
 * 默认沙箱权限配置
 */
export const DEFAULT_SANDBOX_PERMISSIONS: SandboxPermissions = {
  allowedDomains: [
    'api.dropboxapi.com',
    'content.dropboxapi.com',
    'www.googleapis.com',
    's3.amazonaws.com',
    '*.s3.amazonaws.com',
  ],
  allowedApiPatterns: [
    '^https://api.dropboxapi.com/.*$',
    '^https://content.dropboxapi.com/.*$',
    '^https://www.googleapis.com/drive/.*$',
    '^https://s3.[a-z0-9-]+.amazonaws.com/.*$',
  ],
  allowedOperations: ['fetch', 'storage', 'auth', 'crypto'],
  maxStorageSize: 100 * 1024 * 1024, // 100MB
  requestTimeout: 30000, // 30秒
  maxRetries: 3,
};

/**
 * 连接器代码沙箱配置
 */
export interface ConnectorSandboxConfig {
  /** 连接器ID */
  connectorId: string;
  /** 连接器类型 */
  connectorType: string;
  /** 连接器代码（经过验证的） */
  connectorCode: string;
  /** 用户配置 */
  userConfig: Record<string, unknown>;
  /** 沙箱权限 */
  permissions: SandboxPermissions;
  /** 版本号 */
  version: string;
  /** 创建时间 */
  createdAt: Date;
}

// ==================== 代码验证接口 ====================

/**
 * 代码验证结果
 */
export interface CodeValidationResult {
  /** 验证是否通过 */
  valid: boolean;
  /** 验证错误信息 */
  errors: string[];
  /** 警告信息 */
  warnings: string[];
  /** 代码分析信息 */
  analysis: {
    /** 检测到的危险API调用 */
    dangerousApis: string[];
    /** 外部依赖列表 */
    dependencies: string[];
    /** 代码复杂度评分 */
    complexity: number;
    /** 代码大小（字节） */
    size: number;
  };
}

/**
 * 代码验证器接口
 */
export interface CodeValidator {
  /**
   * 验证连接器代码
   * @param code 待验证的代码
   * @returns 验证结果
   */
  validate(code: string): CodeValidationResult;
  
  /**
   * 扫描代码中的危险模式
   * @param code 待扫描的代码
   * @returns 发现的问题
   */
  scanForDangerousPatterns(code: string): string[];
  
  /**
   * 检查依赖安全性
   * @param dependencies 依赖列表
   * @returns 不安全的依赖
   */
  checkDependencies(dependencies: string[]): string[];
}

// ==================== 沙箱管理器接口 ====================

/**
 * Service Worker沙箱管理器
 */
export interface SandboxManager {
  /**
   * 初始化沙箱环境
   */
  initialize(): Promise<void>;
  
  /**
   * 注册连接器到沙箱
   * @param config 沙箱配置
   * @returns 注册结果
   */
  registerConnector(config: ConnectorSandboxConfig): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 向沙箱发送请求
   * @param request 请求消息
   * @returns 响应Promise
   */
  sendRequest<T extends SandboxResponse>(
    request: SandboxRequest,
    timeout?: number
  ): Promise<T>;
  
  /**
   * 监听沙箱事件
   * @param eventType 事件类型
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  onEvent<T extends SandboxResponse>(
    eventType: T['type'],
    callback: (payload: T) => void
  ): () => void;
  
  /**
   * 注销连接器
   * @param connectorId 连接器ID
   */
  unregisterConnector(connectorId: string): Promise<void>;
  
  /**
   * 销毁沙箱环境
   */
  dispose(): Promise<void>;
  
  /**
   * 获取沙箱状态
   */
  getStatus(): {
    initialized: boolean;
    activeConnectors: string[];
    memoryUsage: number;
    lastError?: string;
  };
}

// ==================== 安全错误类型 ====================

/**
 * 沙箱安全错误
 */
export class SandboxError extends Error {
  readonly code: string;
  readonly connectorId?: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    connectorId?: string,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    this.connectorId = connectorId;
    this.recoverable = recoverable;
  }
}

/**
 * 代码验证错误
 */
export class CodeValidationError extends SandboxError {
  readonly validationErrors: string[];

  constructor(
    message: string,
    validationErrors: string[]
  ) {
    super(message, 'CODE_VALIDATION_ERROR', undefined, false);
    this.name = 'CodeValidationError';
    this.validationErrors = validationErrors;
  }
}

/**
 * 权限拒绝错误
 */
export class PermissionDeniedError extends SandboxError {
  readonly operation: string;
  readonly resource: string;

  constructor(
    message: string,
    operation: string,
    resource: string,
    connectorId: string
  ) {
    super(message, 'PERMISSION_DENIED', connectorId, false);
    this.name = 'PermissionDeniedError';
    this.operation = operation;
    this.resource = resource;
  }
}

/**
 * 超时错误
 */
export class SandboxTimeoutError extends SandboxError {
  readonly operation: string;
  readonly timeout: number;

  constructor(
    message: string,
    operation: string,
    timeout: number,
    connectorId: string
  ) {
    super(message, 'TIMEOUT', connectorId, true);
    this.name = 'SandboxTimeoutError';
    this.operation = operation;
    this.timeout = timeout;
  }
}

// ==================== 安全审计日志 ====================

/**
 * 安全审计日志条目
 */
export interface SecurityAuditLog {
  id: string;
  timestamp: Date;
  connectorId?: string;
  operation: string;
  resource?: string;
  success: boolean;
  errorMessage?: string;
  /** 请求的IP/来源 */
  source?: string;
  /** 额外的上下文信息 */
  metadata?: Record<string, unknown>;
}

/**
 * 安全审计日志管理器
 */
export interface SecurityAuditLogger {
  /**
   * 记录审计日志
   * @param entry 日志条目
   */
  log(entry: Omit<SecurityAuditLog, 'id' | 'timestamp'>): void;
  
  /**
   * 获取审计日志
   * @param filters 过滤条件
   * @returns 日志列表
   */
  getLogs(filters?: {
    connectorId?: string;
    operation?: string;
    startTime?: Date;
    endTime?: Date;
    success?: boolean;
  }): SecurityAuditLog[];
  
  /**
   * 清除旧日志
   * @param before 清除此时间之前的日志
   */
  clearOldLogs(before: Date): void;
  
  /**
   * 导出日志
   * @returns 日志数据
   */
  exportLogs(): string;
}
