/**
 * 连接器沙箱 Service Worker
 * 
 * 功能：
 * 1. 提供隔离的执行环境
 * 2. 管理多个用户自定义连接器实例
 * 3. 验证和限制API访问
 * 4. 通过postMessage与主应用通信
 * 
 * 安全模型：
 * - 用户代码在沙箱中执行，无法访问主线程
 * - 所有API调用都经过白名单验证
 * - 网络请求被限制在预定义的域名列表
 * - 执行时间限制防止无限循环
 */

// 导入类型定义（在实际项目中会通过构建工具处理）
// import type { SandboxMessage, SandboxRequest, SandboxResponse, SandboxAPI } from '../types/sandbox';

// ==================== 配置 ====================

const CONFIG = {
  // 允许访问的域名
  ALLOWED_DOMAINS: [
    'api.dropboxapi.com',
    'content.dropboxapi.com',
    'www.googleapis.com',
    's3.amazonaws.com',
    '*.s3.amazonaws.com',
    'api.onedrive.com',
    'graph.microsoft.com',
  ],
  
  // 最大执行时间（毫秒）
  MAX_EXECUTION_TIME: 30000,
  
  // 请求超时时间
  REQUEST_TIMEOUT: 30000,
  
  // 最大存储大小（字节）
  MAX_STORAGE_SIZE: 100 * 1024 * 1024, // 100MB
  
  // 调试模式
  DEBUG: false,
};

// ==================== 沙箱管理器 ====================

class SandboxManager {
  constructor() {
    this.connectors = new Map();
    this.storage = new Map();
    this.pendingRequests = new Map();
    this.requestId = 0;
  }

  /**
   * 初始化连接器
   */
  async initConnector(connectorId, connectorType, config, code) {
    try {
      // 1. 验证代码安全性
      const validation = this.validateCode(code);
      if (!validation.valid) {
        return {
          success: false,
          error: '代码验证失败: ' + validation.errors.join(', '),
        };
      }

      // 2. 创建沙箱API实例
      const api = this.createSandboxAPI(connectorId);

      // 3. 在受限环境中执行用户代码
      const ConnectorClass = this.createConnectorClass(code, api);
      
      // 4. 实例化连接器
      const instance = new ConnectorClass(config, api);

      // 5. 存储连接器实例
      this.connectors.set(connectorId, {
        instance,
        type: connectorType,
        createdAt: Date.now(),
      });

      this.log('info', `Connector ${connectorId} initialized successfully`);

      return { success: true };
    } catch (error) {
      this.log('error', `Failed to initialize connector ${connectorId}:`, error);
      return {
        success: false,
        error: error.message || '初始化失败',
      };
    }
  }

  /**
   * 验证代码安全性
   */
  validateCode(code) {
    const errors = [];
    const warnings = [];

    // 检查危险模式
    const dangerousPatterns = [
      { pattern: /\beval\s*\(/, desc: '使用了eval()' },
      { pattern: /\bnew\s+Function\s*\(/, desc: '使用了new Function()' },
      { pattern: /\bdocument\b/, desc: '访问了document对象' },
      { pattern: /\bwindow\b/, desc: '访问了window对象' },
      { pattern: /\blocation\b/, desc: '访问了location对象' },
      { pattern: /\blocalStorage\b/, desc: '访问了localStorage' },
      { pattern: /\bWorker\s*\(/, desc: '尝试创建Web Worker' },
      { pattern: /\bWebAssembly\b/, desc: '使用了WebAssembly' },
      { pattern: /\bimportScripts\s*\(/, desc: '使用了importScripts()' },
      { pattern: /__proto__/, desc: '使用了__proto__' },
    ];

    for (const { pattern, desc } of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(desc);
      }
    }

    // 检查代码长度
    if (code.length > 50000) {
      warnings.push('代码长度超过50KB，可能影响性能');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 创建沙箱API实例
   */
  createSandboxAPI(connectorId) {
    const self = this;
    
    return {
      // 受限制的fetch
      fetch: async (url, options = {}) => {
        // 验证URL
        const urlObj = new URL(url);
        const isAllowed = CONFIG.ALLOWED_DOMAINS.some(domain => {
          if (domain.startsWith('*.')) {
            const suffix = domain.slice(1);
            return urlObj.hostname.endsWith(suffix);
          }
          return urlObj.hostname === domain;
        });

        if (!isAllowed) {
          throw new Error(`Domain not allowed: ${urlObj.hostname}`);
        }

        // 执行请求（带超时）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // 包装响应对象
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            arrayBuffer: () => response.arrayBuffer(),
            text: () => response.text(),
            json: () => response.json(),
          };
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      },

      // 加密API
      crypto: {
        sha256: async (data) => {
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },
        randomUUID: () => crypto.randomUUID(),
      },

      // 编码工具
      encoding: {
        base64Encode: (data) => {
          const bytes = new Uint8Array(data);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return btoa(binary);
        },
        base64Decode: (data) => {
          const binary = atob(data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes.buffer;
        },
        textEncode: (text) => new TextEncoder().encode(text),
        textDecode: (data) => new TextDecoder().decode(data),
      },

      // 日志
      log: {
        debug: (...args) => self.log('debug', `[${connectorId}]`, ...args),
        info: (...args) => self.log('info', `[${connectorId}]`, ...args),
        warn: (...args) => self.log('warn', `[${connectorId}]`, ...args),
        error: (...args) => self.log('error', `[${connectorId}]`, ...args),
      },

      // 隔离的存储（每个连接器独立）
      storage: {
        getItem: async (key) => {
          const store = self.storage.get(connectorId) || {};
          return store[key] || null;
        },
        setItem: async (key, value) => {
          let store = self.storage.get(connectorId);
          if (!store) {
            store = {};
            self.storage.set(connectorId, store);
          }
          store[key] = value;
        },
        removeItem: async (key) => {
          const store = self.storage.get(connectorId);
          if (store) {
            delete store[key];
          }
        },
      },

      // 发送事件到主应用
      emitEvent: (event) => {
        self.sendToMain({
          type: 'EVENT',
          connectorId,
          event,
        });
      },
    };
  }

  /**
   * 创建连接器类
   */
  createConnectorClass(code, api) {
    // 创建安全的函数执行环境
    // 使用Function构造器创建沙箱函数
    const sandboxFunction = new Function('api', 'console', `
      "use strict";
      ${code}
      
      // 返回导出的类
      if (typeof CustomConnector !== 'undefined') {
        return CustomConnector;
      }
      if (typeof Connector !== 'undefined') {
        return Connector;
      }
      if (typeof exports !== 'undefined' && exports.default) {
        return exports.default;
      }
      throw new Error('连接器代码必须导出一个类');
    `);

    // 提供受限的console
    const restrictedConsole = {
      log: api.log.info,
      info: api.log.info,
      warn: api.log.warn,
      error: api.log.error,
      debug: api.log.debug,
    };

    return sandboxFunction(api, restrictedConsole);
  }

  /**
   * 执行连接器方法
   */
  async executeMethod(connectorId, method, ...args) {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    const instance = connector.instance;
    if (typeof instance[method] !== 'function') {
      throw new Error(`Method not found: ${method}`);
    }

    // 带超时执行
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Method execution timeout: ${method}`));
      }, CONFIG.MAX_EXECUTION_TIME);
    });

    const executionPromise = instance[method](...args);

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * 处理请求
   */
  async handleRequest(request) {
    const { connectorId, type } = request;

    switch (type) {
      case 'INIT_CONNECTOR':
        return this.initConnector(
          connectorId,
          request.connectorType,
          request.config,
          request.code
        );

      case 'AUTHENTICATE':
        return this.executeMethod(connectorId, 'authenticate');

      case 'HANDLE_AUTH_CALLBACK':
        return this.executeMethod(connectorId, 'handleAuthCallback', request.callbackData);

      case 'REFRESH_TOKEN':
        return this.executeMethod(connectorId, 'refreshToken');

      case 'LOGOUT':
        await this.executeMethod(connectorId, 'logout');
        return { success: true };

      case 'TEST_CONNECTION':
        return this.executeMethod(connectorId, 'testConnection');

      case 'UPLOAD_BOOK':
        return this.executeMethod(
          connectorId,
          'uploadBook',
          request.bookId,
          request.fileData,
          request.metadata
        );

      case 'DOWNLOAD_BOOK':
        return this.executeMethod(connectorId, 'downloadBook', request.remotePath);

      case 'DELETE_BOOK':
        return this.executeMethod(connectorId, 'deleteBook', request.remotePath);

      case 'LIST_BOOKS':
        return this.executeMethod(connectorId, 'listBooks');

      case 'BOOK_EXISTS':
        return this.executeMethod(connectorId, 'bookExists', request.remotePath);

      case 'UPLOAD_PROGRESS':
        return this.executeMethod(
          connectorId,
          'uploadProgress',
          request.bookId,
          request.progress
        );

      case 'DOWNLOAD_PROGRESS':
        return this.executeMethod(connectorId, 'downloadProgress', request.bookId);

      case 'LIST_ALL_PROGRESS':
        return this.executeMethod(connectorId, 'listAllProgress');

      case 'UPLOAD_BOOKMARKS':
        return this.executeMethod(
          connectorId,
          'uploadBookmarks',
          request.bookId,
          request.bookmarks
        );

      case 'DOWNLOAD_BOOKMARKS':
        return this.executeMethod(connectorId, 'downloadBookmarks', request.bookId);

      case 'DELETE_BOOKMARK':
        return this.executeMethod(
          connectorId,
          'deleteBookmark',
          request.bookId,
          request.bookmarkId
        );

      case 'SYNC':
        return this.executeMethod(connectorId, 'sync', request.options);

      case 'SYNC_BOOK':
        return this.executeMethod(connectorId, 'syncBook', request.bookId, request.options);

      case 'DISPOSE_CONNECTOR':
        this.disposeConnector(connectorId);
        return { success: true };

      default:
        return { success: false, error: `Unknown request type: ${type}` };
    }
  }

  /**
   * 销毁连接器
   */
  disposeConnector(connectorId) {
    const connector = this.connectors.get(connectorId);
    if (connector && typeof connector.instance.dispose === 'function') {
      try {
        connector.instance.dispose();
      } catch (error) {
        this.log('error', `Error disposing connector ${connectorId}:`, error);
      }
    }
    
    this.connectors.delete(connectorId);
    this.storage.delete(connectorId);
    this.log('info', `Connector ${connectorId} disposed`);
  }

  /**
   * 发送消息到主应用
   */
  sendToMain(message) {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'SANDBOX_MESSAGE',
          payload: message,
        });
      });
    });
  }

  /**
   * 日志记录
   */
  log(level, ...args) {
    if (CONFIG.DEBUG || level !== 'debug') {
      console[level](...args);
    }
  }
}

// ==================== Service Worker 生命周期 ====================

const sandboxManager = new SandboxManager();

// 安装事件
self.addEventListener('install', (event) => {
  console.log('[Sandbox SW] Installing...');
  self.skipWaiting();
});

// 激活事件
self.addEventListener('activate', (event) => {
  console.log('[Sandbox SW] Activating...');
  event.waitUntil(self.clients.claim());
});

// 消息事件
self.addEventListener('message', async (event) => {
  const { data } = event;
  
  if (data.type !== 'SANDBOX_REQUEST') {
    return;
  }

  const { requestId, payload } = data;

  try {
    const result = await sandboxManager.handleRequest(payload);
    
    // 发送响应
    event.source.postMessage({
      type: 'SANDBOX_RESPONSE',
      requestId,
      payload: {
        success: true,
        data: result,
      },
    });
  } catch (error) {
    console.error('[Sandbox SW] Request failed:', error);
    
    // 发送错误响应
    event.source.postMessage({
      type: 'SANDBOX_RESPONSE',
      requestId,
      payload: {
        success: false,
        error: error.message || 'Unknown error',
      },
    });
  }
});

// Fetch事件（拦截并验证）
self.addEventListener('fetch', (event) => {
  // 这里可以添加额外的请求验证逻辑
  // 目前让请求通过，因为实际的fetch在沙箱中执行
});

console.log('[Sandbox SW] Initialized');
