/**
 * 用户自定义连接器沙箱系统
 * 
 * 核心设计理念：
 * 1. 用户编写符合接口规范的JavaScript代码
 * 2. 代码在Service Worker沙箱中执行，完全隔离
 * 3. 通过结构化消息传递进行通信
 * 4. 严格限制API访问，只允许白名单中的操作
 * 
 * 用户代码结构：
 * ```javascript
 * class MyCustomConnector {
 *   constructor(config) {
 *     this.config = config;
 *     this.type = 'my-custom';
 *     this.displayName = 'My Custom Storage';
 *   }
 *   
 *   // 必须实现的接口方法...
 * }
 * 
 * // 导出连接器类
 * export default MyCustomConnector;
 * ```
 */

// ==================== 用户自定义连接器接口定义 ====================

/**
 * 用户自定义连接器必须实现的接口
 * 
 * 注意：用户编写的代码中只能使用沙箱提供的受限API，
 * 无法直接访问window、document、localStorage等浏览器API
 */
export interface UserCustomConnector {
  /** 连接器类型标识（唯一） */
  type: string;
  
  /** 显示名称 */
  displayName: string;
  
  /** 连接器配置 */
  config: Record<string, unknown>;
  
  // ==================== 认证相关 ====================
  
  /**
   * 获取认证状态
   * @returns 认证状态
   */
  getAuthStatus(): string;
  
  /**
   * 执行认证
   * 注意：在沙箱中无法打开弹窗，需要通过消息传递通知主应用处理OAuth
   * @returns 认证结果
   */
  authenticate(): Promise<{ success: boolean; authUrl?: string; error?: string }>;
  
  /**
   * 处理认证回调
   * @param callbackData 回调数据
   * @returns 处理结果
   */
  handleAuthCallback(callbackData: Record<string, string>): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 刷新访问令牌
   * @returns 刷新结果
   */
  refreshToken(): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 登出
   */
  logout(): Promise<void>;
  
  // ==================== 连接测试 ====================
  
  /**
   * 测试连接
   * @returns 测试结果
   */
  testConnection(): Promise<{ success: boolean; message?: string }>;
  
  // ==================== 书籍操作 ====================
  
  /**
   * 上传书籍
   * @param bookId 书籍ID
   * @param fileData 文件数据（ArrayBuffer）
   * @param metadata 元数据
   * @returns 上传结果
   */
  uploadBook(
    bookId: string,
    fileData: ArrayBuffer,
    metadata: Record<string, unknown>
  ): Promise<{ 
    success: boolean; 
    remotePath?: string; 
    size?: number;
    checksum?: string;
    error?: string 
  }>;
  
  /**
   * 下载书籍
   * @param remotePath 远程路径
   * @returns 书籍数据
   */
  downloadBook(remotePath: string): Promise<{ 
    success: boolean; 
    fileData?: ArrayBuffer;
    error?: string 
  }>;
  
  /**
   * 删除书籍
   * @param remotePath 远程路径
   */
  deleteBook(remotePath: string): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 列出所有书籍
   * @returns 书籍列表
   */
  listBooks(): Promise<{ 
    success: boolean; 
    books?: Array<{
      bookId: string;
      remotePath: string;
      size: number;
      checksum: string;
      modifiedAt: string;
    }>;
    error?: string 
  }>;
  
  /**
   * 检查书籍是否存在
   * @param remotePath 远程路径
   */
  bookExists(remotePath: string): Promise<{ success: boolean; exists: boolean; error?: string }>;
  
  // ==================== 阅读进度操作 ====================
  
  /**
   * 上传阅读进度
   * @param bookId 书籍ID
   * @param progress 进度数据
   */
  uploadProgress(
    bookId: string,
    progress: {
      currentChapter: string;
      currentPosition: number;
      lastReadAt: string;
      totalProgress: number;
      deviceId: string;
      version: number;
    }
  ): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 下载阅读进度
   * @param bookId 书籍ID
   * @returns 进度数据
   */
  downloadProgress(bookId: string): Promise<{ 
    success: boolean; 
    progress?: {
      currentChapter: string;
      currentPosition: number;
      lastReadAt: string;
      totalProgress: number;
      deviceId: string;
      version: number;
    } | null;
    error?: string 
  }>;
  
  /**
   * 列出所有进度
   * @returns 进度列表
   */
  listAllProgress(): Promise<{ success: boolean; progressList?: unknown[]; error?: string }>;
  
  // ==================== 书签操作 ====================
  
  /**
   * 上传书签
   * @param bookId 书籍ID
   * @param bookmarks 书签列表
   */
  uploadBookmarks(
    bookId: string,
    bookmarks: Array<{
      id: string;
      chapterId: string;
      position: number;
      text: string;
      createdAt: string;
      color?: string;
      note?: string;
    }>
  ): Promise<{ success: boolean; error?: string }>;
  
  /**
   * 下载书签
   * @param bookId 书籍ID
   * @returns 书签列表
   */
  downloadBookmarks(bookId: string): Promise<{ 
    success: boolean; 
    bookmarks?: unknown[];
    error?: string 
  }>;
  
  /**
   * 删除书签
   * @param bookId 书籍ID
   * @param bookmarkId 书签ID
   */
  deleteBookmark(bookId: string, bookmarkId: string): Promise<{ success: boolean; error?: string }>;
  
  // ==================== 同步操作 ====================
  
  /**
   * 执行完整同步
   * @param options 同步选项
   * @returns 同步结果
   */
  sync(options?: {
    syncBooks?: boolean;
    syncProgress?: boolean;
    syncBookmarks?: boolean;
    conflictStrategy?: string;
  }): Promise<{
    success: boolean;
    booksUpdated?: number;
    progressUpdated?: number;
    bookmarksUpdated?: number;
    conflicts?: unknown[];
    errors?: string[];
  }>;
  
  /**
   * 同步单本书籍
   * @param bookId 书籍ID
   * @param options 同步选项
   */
  syncBook(bookId: string, options?: Record<string, unknown>): Promise<unknown>;
}

// ==================== 沙箱提供的受限API ====================

/**
 * 沙箱环境暴露给用户的受限API
 * 
 * 这些API由Service Worker提供，用户代码只能使用这些API
 */
export interface SandboxAPI {
  /**
   * 受限制的网络请求
   * 只能访问白名单中的域名和URL模式
   */
  fetch: (url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: ArrayBuffer | string;
  }) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>;
  
  /**
   * 加密/哈希API
   */
  crypto: {
    /**
     * 计算SHA-256哈希
     */
    sha256: (data: ArrayBuffer) => Promise<string>;
    /**
     * 生成随机UUID
     */
    randomUUID: () => string;
  };
  
  /**
   * 编码/解码工具
   */
  encoding: {
    base64Encode: (data: ArrayBuffer) => string;
    base64Decode: (data: string) => ArrayBuffer;
    textEncode: (text: string) => Uint8Array;
    textDecode: (data: Uint8Array) => string;
  };
  
  /**
   * 日志记录（会被转发到主应用）
   */
  log: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  
  /**
   * 存储（连接器隔离的临时存储，非持久化）
   * 注意：此存储仅供当前连接器实例使用，不同连接器之间隔离
   */
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
  
  /**
   * 发送事件到主应用
   * 用于通知认证状态变化、同步进度等
   */
  emitEvent: (event: {
    type: string;
    payload?: Record<string, unknown>;
  }) => void;
}

// ==================== 用户代码模板 ====================

/**
 * 用户自定义连接器代码模板
 * 
 * 用户需要按照这个模板编写代码，必须实现所有必需的方法
 */
export const USER_CONNECTOR_TEMPLATE = `/**
 * 自定义连接器示例
 * 
 * 重要安全提示：
 * 1. 此代码将在沙箱环境中执行，无法访问浏览器DOM
 * 2. 只能使用沙箱提供的受限API
 * 3. 网络请求会被限制在白名单域名内
 * 4. 禁止使用eval、new Function等动态代码执行
 */

class CustomConnector {
  constructor(config, api) {
    // config: 用户配置的对象
    // api: 沙箱提供的受限API
    this.config = config;
    this.api = api;
    
    this.type = 'custom';
    this.displayName = config.name || 'Custom Connector';
    this.authStatus = 'unauthenticated';
  }

  // ==================== 认证相关 ====================
  
  getAuthStatus() {
    return this.authStatus;
  }

  async authenticate() {
    // 示例：返回需要用户在外部浏览器中访问的认证URL
    const authUrl = 'https://example.com/oauth/authorize?client_id=' + this.config.clientId;
    return { success: true, authUrl };
  }

  async handleAuthCallback(callbackData) {
    // 处理OAuth回调，提取token
    const { code } = callbackData;
    
    try {
      const response = await this.api.fetch('https://api.example.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        await this.api.storage.setItem('access_token', data.access_token);
        await this.api.storage.setItem('refresh_token', data.refresh_token);
        this.authStatus = 'authenticated';
        this.api.emitEvent({ type: 'auth_status_changed', payload: { status: 'authenticated' } });
        return { success: true };
      }
    } catch (error) {
      this.api.log.error('Authentication failed:', error);
      return { success: false, error: error.message };
    }
  }

  async refreshToken() {
    const refreshToken = await this.api.storage.getItem('refresh_token');
    if (!refreshToken) {
      return { success: false, error: 'No refresh token' };
    }

    try {
      const response = await this.api.fetch('https://api.example.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        await this.api.storage.setItem('access_token', data.access_token);
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async logout() {
    await this.api.storage.removeItem('access_token');
    await this.api.storage.removeItem('refresh_token');
    this.authStatus = 'unauthenticated';
    this.api.emitEvent({ type: 'auth_status_changed', payload: { status: 'unauthenticated' } });
  }

  // ==================== 连接测试 ====================
  
  async testConnection() {
    try {
      const token = await this.api.storage.getItem('access_token');
      if (!token) {
        return { success: false, message: '未认证' };
      }

      const response = await this.api.fetch('https://api.example.com/user', {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        return { success: true, message: '连接正常' };
      } else {
        return { success: false, message: '连接失败: ' + response.status };
      }
    } catch (error) {
      return { success: false, message: '连接错误: ' + error.message };
    }
  }

  // ==================== 书籍操作 ====================
  
  async uploadBook(bookId, fileData, metadata) {
    try {
      const token = await this.api.storage.getItem('access_token');
      const remotePath = '/books/' + bookId + '.epub';
      
      const response = await this.api.fetch('https://api.example.com/upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          'X-Book-Id': bookId,
        },
        body: fileData,
      });

      if (response.ok) {
        const checksum = await this.api.crypto.sha256(fileData);
        return {
          success: true,
          remotePath,
          size: fileData.byteLength,
          checksum,
        };
      } else {
        return { success: false, error: 'Upload failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadBook(remotePath) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/download?path=' + encodeURIComponent(remotePath), {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        const fileData = await response.arrayBuffer();
        return { success: true, fileData };
      } else {
        return { success: false, error: 'Download failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBook(remotePath) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/delete', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + token,
          'X-Path': remotePath,
        },
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listBooks() {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/books', {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          books: data.books.map(book => ({
            bookId: book.id,
            remotePath: book.path,
            size: book.size,
            checksum: book.checksum,
            modifiedAt: book.modified_at,
          })),
        };
      } else {
        return { success: false, error: 'List failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async bookExists(remotePath) {
    try {
      const result = await this.listBooks();
      if (result.success && result.books) {
        const exists = result.books.some(book => book.remotePath === remotePath);
        return { success: true, exists };
      }
      return { success: false, exists: false, error: result.error };
    } catch (error) {
      return { success: false, exists: false, error: error.message };
    }
  }

  // ==================== 阅读进度操作 ====================
  
  async uploadProgress(bookId, progress) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/progress/' + bookId, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(progress),
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadProgress(bookId) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/progress/' + bookId, {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        const progress = await response.json();
        return { success: true, progress };
      } else if (response.status === 404) {
        return { success: true, progress: null };
      } else {
        return { success: false, error: 'Download failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listAllProgress() {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/progress', {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, progressList: data.progress };
      } else {
        return { success: false, error: 'List failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== 书签操作 ====================
  
  async uploadBookmarks(bookId, bookmarks) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/bookmarks/' + bookId, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bookmarks }),
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadBookmarks(bookId) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/bookmarks/' + bookId, {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, bookmarks: data.bookmarks };
      } else if (response.status === 404) {
        return { success: true, bookmarks: [] };
      } else {
        return { success: false, error: 'Download failed: ' + response.status };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBookmark(bookId, bookmarkId) {
    try {
      const token = await this.api.storage.getItem('access_token');
      
      const response = await this.api.fetch('https://api.example.com/bookmarks/' + bookId + '/' + bookmarkId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== 同步操作 ====================
  
  async sync(options = {}) {
    const result = {
      success: true,
      booksUpdated: 0,
      progressUpdated: 0,
      bookmarksUpdated: 0,
      conflicts: [],
      errors: [],
    };

    try {
      if (options.syncBooks !== false) {
        this.api.emitEvent({ type: 'sync_progress', payload: { progress: 10, message: '正在同步书籍...' } });
        const booksResult = await this.listBooks();
        if (booksResult.success) {
          result.booksUpdated = booksResult.books?.length || 0;
        }
      }

      if (options.syncProgress !== false) {
        this.api.emitEvent({ type: 'sync_progress', payload: { progress: 50, message: '正在同步阅读进度...' } });
        const progressResult = await this.listAllProgress();
        if (progressResult.success) {
          result.progressUpdated = progressResult.progressList?.length || 0;
        }
      }

      if (options.syncBookmarks !== false) {
        this.api.emitEvent({ type: 'sync_progress', payload: { progress: 80, message: '正在同步书签...' } });
        // 书签同步逻辑...
      }

      this.api.emitEvent({ type: 'sync_progress', payload: { progress: 100, message: '同步完成' } });
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(error.message);
      return result;
    }
  }

  async syncBook(bookId, options) {
    // 同步单本书籍的完整数据
    return this.sync({ ...options, bookId });
  }
}

// 导出连接器类
export default CustomConnector;
`;

// ==================== 代码验证规则 ====================

/**
 * 危险代码模式列表
 * 这些模式会被检测到并阻止执行
 */
export const DANGEROUS_PATTERNS = [
  // 动态代码执行
  { pattern: /\beval\s*\(/, description: '使用了eval()' },
  { pattern: /\bnew\s+Function\s*\(/, description: '使用了new Function()' },
  { pattern: /\bsetTimeout\s*\(\s*["'`]/, description: 'setTimeout使用了字符串参数' },
  { pattern: /\bsetInterval\s*\(\s*["'`]/, description: 'setInterval使用了字符串参数' },
  
  // DOM操作（在沙箱中不可用）
  { pattern: /\bdocument\b/, description: '访问了document对象' },
  { pattern: /\bwindow\b/, description: '访问了window对象' },
  { pattern: /\blocation\b/, description: '访问了location对象' },
  { pattern: /\blocalStorage\b/, description: '访问了localStorage' },
  { pattern: /\bsessionStorage\b/, description: '访问了sessionStorage' },
  { pattern: /\bindexedDB\b/, description: '访问了indexedDB' },
  
  // 危险API
  { pattern: /\bWorker\s*\(/, description: '尝试创建Web Worker' },
  { pattern: /\bSharedArrayBuffer\b/, description: '使用了SharedArrayBuffer' },
  { pattern: /\bAtomics\b/, description: '使用了Atomics API' },
  { pattern: /\bWebAssembly\b/, description: '使用了WebAssembly' },
  
  // 网络相关（应通过沙箱API）
  { pattern: /\bWebSocket\s*\(/, description: '使用了WebSocket' },
  { pattern: /\bXMLHttpRequest\b/, description: '使用了XMLHttpRequest' },
  { pattern: /\bfetch\b(?!\s*:\s*api\.fetch)/, description: '直接使用了fetch（应使用api.fetch）' },
  
  // 危险全局变量
  { pattern: /\bimportScripts\s*\(/, description: '使用了importScripts()' },
  { pattern: /\bnavigator\b/, description: '访问了navigator对象' },
  { pattern: /\bparent\b/, description: '访问了parent对象' },
  { pattern: /\btop\b/, description: '访问了top对象' },
  { pattern: /\bself\b/, description: '访问了self对象' },
  
  // 潜在的安全绕过
  { pattern: /constructor\s*\[\s*["']prototype["']\s*\]/, description: '尝试访问constructor.prototype' },
  { pattern: /__proto__/, description: '使用了__proto__' },
  { pattern: /prototype\s*\.\s*constructor/, description: '尝试修改原型链' },
];

/**
 * 代码复杂度限制
 */
export interface ComplexityLimits {
  maxLines: number;
  maxFunctions: number;
  maxNestingDepth: number;
  maxCyclomaticComplexity: number;
}

export const DEFAULT_COMPLEXITY_LIMITS: ComplexityLimits = {
  maxLines: 1000,
  maxFunctions: 50,
  maxNestingDepth: 5,
  maxCyclomaticComplexity: 20,
};

// ==================== 用户代码管理 ====================

/**
 * 用户自定义连接器注册信息
 */
export interface UserConnectorRegistration {
  /** 连接器ID */
  id: string;
  /** 连接器代码 */
  code: string;
  /** 代码版本 */
  version: string;
  /** 用户配置 */
  config: Record<string, unknown>;
  /** 代码验证结果 */
  validationResult: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  /** 注册时间 */
  registeredAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 代码编辑器配置
 */
export interface CodeEditorConfig {
  /** 编辑器主题 */
  theme: 'light' | 'dark';
  /** 字体大小 */
  fontSize: number;
  /** 是否显示行号 */
  showLineNumbers: boolean;
  /** 是否启用自动补全 */
  enableAutocomplete: boolean;
  /** 语法检查级别 */
  lintLevel: 'error' | 'warning' | 'off';
  /** 代码格式化选项 */
  formatOnSave: boolean;
}
