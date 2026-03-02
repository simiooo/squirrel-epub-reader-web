
import type {
  CloudStorageConnector,
  ConnectorConfig,
  MultiCloudStorageManager,
  SyncOptions,
  SyncResult,
  StorageEvent,
  StorageEventListener,
  ConnectorRegistry,
  ConnectorConstructor,
  ConnectorTypeInfo,
} from '../types/cloudStorage';

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 连接器注册表实现
 */
export class ConnectorRegistryImpl implements ConnectorRegistry {
  private registry = new Map<string, ConnectorConstructor>();
  private typeInfoRegistry = new Map<string, ConnectorTypeInfo>();

  register(type: string, constructor: ConnectorConstructor): void {
    this.registry.set(type, constructor);
  }

  create(type: string, config: ConnectorConfig): CloudStorageConnector {
    const Constructor = this.registry.get(type);
    if (!Constructor) {
      throw new Error(`未知的连接器类型: ${type}`);
    }
    return new Constructor(config);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.registry.keys());
  }

  registerTypeInfo(type: string, info: ConnectorTypeInfo): void {
    this.typeInfoRegistry.set(type, info);
  }

  getTypeInfo(type: string): ConnectorTypeInfo | undefined {
    return this.typeInfoRegistry.get(type);
  }
}

/**
 * 全局注册表实例
 */
export const globalConnectorRegistry = new ConnectorRegistryImpl();

/**
 * 多云存储管理器实现
 */
export class MultiCloudStorageManagerImpl implements MultiCloudStorageManager {
  private connectors = new Map<string, CloudStorageConnector>();
  private eventListeners = new Set<StorageEventListener>();
  private connectorsChangeListeners = new Set<(connectors: CloudStorageConnector[]) => void>();
  private globalSyncListeners = new Set<(status: { syncing: boolean; progress: number; message: string }) => void>();
  private syncIntervals = new Map<string, number>();

  registerConnector(connector: CloudStorageConnector): void {
    this.connectors.set(connector.config.id, connector);
    
    // 设置自动同步
    if (connector.config.autoSync && connector.config.syncInterval) {
      this.setupAutoSync(connector);
    }

    // 监听连接器事件
    this.setupConnectorListeners(connector);

    // 触发连接器变化事件
    this.notifyConnectorsChange();
    
    // 触发注册事件
    this.emitEvent({
      type: 'connector_registered',
      connectorId: connector.config.id,
    });
  }

  unregisterConnector(connectorId: string): void {
    const connector = this.connectors.get(connectorId);
    if (!connector) return;

    // 清除自动同步定时器
    this.clearAutoSync(connectorId);

    // 移除连接器
    this.connectors.delete(connectorId);

    // 触发连接器变化事件
    this.notifyConnectorsChange();

    // 触发注销事件
    this.emitEvent({
      type: 'connector_unregistered',
      connectorId,
    });
  }

  getConnectors(): CloudStorageConnector[] {
    return Array.from(this.connectors.values());
  }

  getConnector(connectorId: string): CloudStorageConnector | undefined {
    return this.connectors.get(connectorId);
  }

  getAutoSyncConnectors(): CloudStorageConnector[] {
    return this.getConnectors().filter(c => c.config.autoSync);
  }

  async syncAll(options?: SyncOptions): Promise<Map<string, SyncResult>> {
    const results = new Map<string, SyncResult>();
    const autoSyncConnectors = this.getAutoSyncConnectors();

    this.notifyGlobalSyncStatus({ syncing: true, progress: 0, message: '开始同步所有连接器...' });

    for (let i = 0; i < autoSyncConnectors.length; i++) {
      const connector = autoSyncConnectors[i];
      const progress = (i / autoSyncConnectors.length) * 100;
      
      this.notifyGlobalSyncStatus({
        syncing: true,
        progress,
        message: `正在同步 ${connector.config.name}...`,
      });

      try {
        const result = await connector.sync(options);
        results.set(connector.config.id, result);
      } catch (error) {
        results.set(connector.config.id, {
          success: false,
          timestamp: new Date(),
          booksUpdated: 0,
          progressUpdated: 0,
          bookmarksUpdated: 0,
          conflicts: [],
          errors: [error instanceof Error ? error.message : '未知错误'],
        });
      }
    }

    this.notifyGlobalSyncStatus({ syncing: false, progress: 100, message: '同步完成' });

    return results;
  }

  async syncConnector(connectorId: string, options?: SyncOptions): Promise<SyncResult> {
    const connector = this.getConnector(connectorId);
    if (!connector) {
      throw new Error(`连接器不存在: ${connectorId}`);
    }

    this.notifyGlobalSyncStatus({
      syncing: true,
      progress: 0,
      message: `正在同步 ${connector.config.name}...`,
    });

    try {
      const result = await connector.sync(options);
      
      this.notifyGlobalSyncStatus({
        syncing: false,
        progress: 100,
        message: `同步完成: ${result.success ? '成功' : '失败'}`,
      });

      return result;
    } catch (error) {
      this.notifyGlobalSyncStatus({
        syncing: false,
        progress: 100,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      });
      throw error;
    }
  }

  async syncBookToAll(bookId: string, options?: SyncOptions): Promise<void> {
    const connectors = this.getAutoSyncConnectors();
    
    await Promise.all(
      connectors.map(async (connector) => {
        try {
          await connector.syncBook(bookId, options);
        } catch (error) {
          console.error(`同步书籍到 ${connector.config.name} 失败:`, error);
        }
      })
    );
  }

  onConnectorsChange(callback: (connectors: CloudStorageConnector[]) => void): () => void {
    this.connectorsChangeListeners.add(callback);
    return () => {
      this.connectorsChangeListeners.delete(callback);
    };
  }

  onGlobalSyncStatus(
    callback: (status: { syncing: boolean; progress: number; message: string }) => void
  ): () => void {
    this.globalSyncListeners.add(callback);
    return () => {
      this.globalSyncListeners.delete(callback);
    };
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: StorageEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * 创建新的连接器配置
   */
  createConnectorConfig(
    type: string,
    name: string,
    settings: Record<string, unknown> = {}
  ): ConnectorConfig {
    return {
      id: generateId(),
      name,
      type,
      settings,
      autoSync: false,
      createdAt: new Date(),
    };
  }

  /**
   * 使用注册表创建连接器
   */
  createConnectorFromRegistry(
    registry: ConnectorRegistry,
    type: string,
    name: string,
    settings: Record<string, unknown> = {}
  ): CloudStorageConnector {
    const config = this.createConnectorConfig(type, name, settings);
    return registry.create(type, config);
  }

  private setupAutoSync(connector: CloudStorageConnector): void {
    const interval = connector.config.syncInterval;
    if (!interval || interval <= 0) return;

    // 清除现有的定时器
    this.clearAutoSync(connector.config.id);

    // 设置新的定时器（转换为毫秒）
    const timerId = window.setInterval(async () => {
      try {
        await connector.sync();
      } catch (error) {
        console.error(`自动同步失败 (${connector.config.name}):`, error);
      }
    }, interval * 60 * 1000);

    this.syncIntervals.set(connector.config.id, timerId);
  }

  private clearAutoSync(connectorId: string): void {
    const timerId = this.syncIntervals.get(connectorId);
    if (timerId) {
      window.clearInterval(timerId);
      this.syncIntervals.delete(connectorId);
    }
  }

  private setupConnectorListeners(connector: CloudStorageConnector): void {
    // 监听认证状态变化
    connector.onAuthStatusChange((status) => {
      this.emitEvent({
        type: 'auth_status_changed',
        connectorId: connector.config.id,
        status,
      });
    });

    // 监听同步进度
    connector.onSyncProgress((progress, message) => {
      this.notifyGlobalSyncStatus({ syncing: true, progress, message });
    });
  }

  private emitEvent(event: StorageEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('事件监听器执行失败:', error);
      }
    });
  }

  private notifyConnectorsChange(): void {
    const connectors = this.getConnectors();
    this.connectorsChangeListeners.forEach(callback => {
      try {
        callback(connectors);
      } catch (error) {
        console.error('连接器变化回调执行失败:', error);
      }
    });
  }

  private notifyGlobalSyncStatus(status: { syncing: boolean; progress: number; message: string }): void {
    this.globalSyncListeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('全局同步状态回调执行失败:', error);
      }
    });
  }

  /**
   * 清理所有资源
   */
  dispose(): void {
    // 清除所有定时器
    this.syncIntervals.forEach((timerId) => {
      window.clearInterval(timerId);
    });
    this.syncIntervals.clear();

    // 清除所有监听器
    this.eventListeners.clear();
    this.connectorsChangeListeners.clear();
    this.globalSyncListeners.clear();

    // 清除所有连接器
    this.connectors.clear();
  }
}

/**
 * 全局存储管理器实例
 */
export const cloudStorageManager = new MultiCloudStorageManagerImpl();
