import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Card, List, Tag, Space, message, Spin, Tooltip, Empty, Tabs, Badge } from 'antd';
import { CloudSyncOutlined, PlusOutlined, DeleteOutlined, EditOutlined, SyncOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { cloudStorageManager } from '../services/cloudStorageManager';
import { SandboxConnector } from '../services/sandboxConnector';
import type { CloudStorageConnector } from '../types/cloudStorage';

interface CloudStoragePanelProps {
  onSyncComplete?: () => void;
}

export const CloudStoragePanel: React.FC<CloudStoragePanelProps> = ({ onSyncComplete }) => {
  const { t } = useTranslation();
  const [connectors, setConnectors] = useState<CloudStorageConnector[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ progress: 0, message: '' });
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isManageModalVisible, setIsManageModalVisible] = useState(false);
  const [_selectedConnector, setSelectedConnector] = useState<CloudStorageConnector | null>(null);

  // 监听连接器变化
  useEffect(() => {
    const unsubscribe = cloudStorageManager.onConnectorsChange((updatedConnectors) => {
      setConnectors(updatedConnectors);
    });

    // 初始加载
    setConnectors(cloudStorageManager.getConnectors());

    return () => unsubscribe();
  }, []);

  // 监听全局同步状态
  useEffect(() => {
    const unsubscribe = cloudStorageManager.onGlobalSyncStatus((status) => {
      setIsSyncing(status.syncing);
      setSyncProgress({ progress: status.progress, message: status.message });
    });

    return () => unsubscribe();
  }, []);

  // 同步所有连接器
  const handleSyncAll = useCallback(async () => {
    try {
      setIsSyncing(true);
      const results = await cloudStorageManager.syncAll({
        syncBooks: true,
        syncProgress: true,
        syncBookmarks: true,
        conflictStrategy: 'newest_wins',
      });

      let totalBooks = 0;
      let totalProgress = 0;
      let hasErrors = false;

      results.forEach((result, connectorId) => {
        if (result.success) {
          totalBooks += result.booksUpdated;
          totalProgress += result.progressUpdated;
        } else {
          hasErrors = true;
          console.error(`Sync failed for ${connectorId}:`, result.errors);
        }
      });

      if (hasErrors) {
        message.warning(t('cloudStorage.syncPartialSuccess', { books: totalBooks, progress: totalProgress }));
      } else {
        message.success(t('cloudStorage.syncSuccess', { books: totalBooks, progress: totalProgress }));
      }

      onSyncComplete?.();
    } catch (error) {
      message.error(t('cloudStorage.syncFailed'));
      console.error('Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [onSyncComplete, t]);

  // 同步单个连接器
  const handleSyncConnector = useCallback(async (connector: CloudStorageConnector) => {
    try {
      message.loading({ content: t('cloudStorage.syncing', { name: connector.config.name }), key: 'sync' });
      
      const result = await cloudStorageManager.syncConnector(connector.config.id, {
        syncBooks: true,
        syncProgress: true,
        syncBookmarks: true,
      });

      if (result.success) {
        message.success({ 
          content: t('cloudStorage.connectorSyncSuccess', { 
            name: connector.config.name,
            books: result.booksUpdated,
            progress: result.progressUpdated 
          }), 
          key: 'sync' 
        });
        onSyncComplete?.();
      } else {
        message.error({ content: t('cloudStorage.connectorSyncFailed'), key: 'sync' });
      }
    } catch {
      message.error({ content: t('cloudStorage.connectorSyncFailed'), key: 'sync' });
    }
  }, [onSyncComplete, t]);

  // 删除连接器
  const handleDeleteConnector = useCallback((connector: CloudStorageConnector) => {
    Modal.confirm({
      title: t('cloudStorage.deleteConfirmTitle'),
      content: t('cloudStorage.deleteConfirmContent', { name: connector.config.name }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: () => {
        cloudStorageManager.unregisterConnector(connector.config.id);
        message.success(t('cloudStorage.connectorDeleted'));
      },
    });
  }, [t]);

  // 获取认证状态标签
  const getAuthStatusTag = (status: string) => {
    switch (status) {
      case 'authenticated':
        return <Tag color="success" icon={<CheckCircleOutlined />}>{t('cloudStorage.authenticated')}</Tag>;
      case 'authenticating':
        return <Tag color="processing">{t('cloudStorage.authenticating')}</Tag>;
      case 'expired':
        return <Tag color="warning" icon={<ExclamationCircleOutlined />}>{t('cloudStorage.expired')}</Tag>;
      case 'error':
        return <Tag color="error">{t('cloudStorage.error')}</Tag>;
      default:
        return <Tag>{t('cloudStorage.unauthenticated')}</Tag>;
    }
  };

  // 渲染连接器列表项
  const renderConnectorItem = (connector: CloudStorageConnector) => (
    <List.Item
      actions={[
        <Tooltip title={t('cloudStorage.sync')}>
          <Button
            type="text"
            icon={<SyncOutlined />}
            onClick={() => handleSyncConnector(connector)}
            loading={isSyncing}
          />
        </Tooltip>,
        <Tooltip title={t('cloudStorage.edit')}>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setSelectedConnector(connector);
              setIsManageModalVisible(true);
            }}
          />
        </Tooltip>,
        <Tooltip title={t('common.delete')}>
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteConnector(connector)}
          />
        </Tooltip>,
      ]}
    >
      <List.Item.Meta
        avatar={<CloudSyncOutlined style={{ fontSize: 32, color: '#1890ff' }} />}
        title={
          <Space>
            <span>{connector.config.name}</span>
            {getAuthStatusTag(connector.getAuthStatus())}
            {connector.config.autoSync && (
              <Tag color="blue">{t('cloudStorage.autoSync')}</Tag>
            )}
          </Space>
        }
        description={
          <Space direction="vertical" size={0}>
            <span>{t('cloudStorage.type')}: {connector.displayName}</span>
            {connector.config.lastSyncAt && (
              <span>{t('cloudStorage.lastSync')}: {connector.config.lastSyncAt.toLocaleString()}</span>
            )}
          </Space>
        }
      />
    </List.Item>
  );

  return (
    <>
      <Space>
        <Badge count={connectors.length} showZero>
          <Button
            icon={<CloudSyncOutlined />}
            onClick={() => setIsManageModalVisible(true)}
          >
            {t('cloudStorage.manage')}
          </Button>
        </Badge>
        <Button
          type="primary"
          icon={<SyncOutlined spin={isSyncing} />}
          onClick={handleSyncAll}
          loading={isSyncing}
          disabled={connectors.length === 0}
        >
          {isSyncing ? `${Math.round(syncProgress.progress)}%` : t('cloudStorage.syncAll')}
        </Button>
      </Space>

      {/* 管理连接器模态框 */}
      <Modal
        title={t('cloudStorage.manageConnectors')}
        open={isManageModalVisible}
        onCancel={() => setIsManageModalVisible(false)}
        footer={[
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setIsAddModalVisible(true)}>
            {t('cloudStorage.addConnector')}
          </Button>,
        ]}
        width={700}
      >
        {connectors.length > 0 ? (
          <List
            dataSource={connectors}
            renderItem={renderConnectorItem}
            bordered
          />
        ) : (
          <Empty
            description={t('cloudStorage.noConnectors')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Modal>

      {/* 添加连接器模态框 */}
      <AddConnectorModal
        visible={isAddModalVisible}
        onCancel={() => setIsAddModalVisible(false)}
        onSuccess={() => {
          setIsAddModalVisible(false);
          message.success(t('cloudStorage.connectorAdded'));
        }}
      />
    </>
  );
};

// 添加连接器模态框组件
interface AddConnectorModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const AddConnectorModal: React.FC<AddConnectorModalProps> = ({ visible, onCancel, onSuccess }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('preset');
  const [isLoading, setIsLoading] = useState(false);

  // 预置连接器类型
  const presetConnectors = [
    { type: 'dropbox', name: 'Dropbox', description: t('cloudStorage.dropboxDesc') },
    { type: 'googledrive', name: 'Google Drive', description: t('cloudStorage.googleDriveDesc') },
    { type: 'onedrive', name: 'OneDrive', description: t('cloudStorage.oneDriveDesc') },
    { type: 's3', name: 'S3 Compatible', description: t('cloudStorage.s3Desc') },
  ];

  // 添加预置连接器
  const handleAddPresetConnector = useCallback(async (type: string) => {
    setIsLoading(true);
    try {
      // 这里会打开对应的连接器配置界面
      // 实际实现中需要根据不同的类型显示不同的配置表单
      message.info(t('cloudStorage.configuring', { type }));
      onSuccess();
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess, t]);

  // 添加自定义连接器
  const handleAddCustomConnector = useCallback(async (code: string, config: Record<string, unknown>) => {
    setIsLoading(true);
    try {
      const connectorConfig = cloudStorageManager.createConnectorConfig(
        'custom',
        config.name as string,
        config
      );

      const sandboxConnector = new SandboxConnector(connectorConfig, code);
      await sandboxConnector.initialize();

      cloudStorageManager.registerConnector(sandboxConnector);
      onSuccess();
    } catch (error) {
      message.error(t('cloudStorage.customConnectorFailed'));
      console.error('Custom connector error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess, t]);

  return (
    <Modal
      title={t('cloudStorage.addConnector')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
    >
      <Spin spinning={isLoading}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'preset',
              label: t('cloudStorage.presetConnectors'),
              children: (
                <List
                  grid={{ gutter: 16, column: 2 }}
                  dataSource={presetConnectors}
                  renderItem={(item) => (
                    <List.Item>
                      <Card
                        hoverable
                        onClick={() => handleAddPresetConnector(item.type)}
                        title={item.name}
                      >
                        {item.description}
                      </Card>
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: 'custom',
              label: t('cloudStorage.customConnector'),
              children: (
                <CustomConnectorForm onSubmit={handleAddCustomConnector} />
              ),
            },
          ]}
        />
      </Spin>
    </Modal>
  );
};

// 自定义连接器表单
interface CustomConnectorFormProps {
  onSubmit: (code: string, config: Record<string, unknown>) => void;
}

const CustomConnectorForm: React.FC<CustomConnectorFormProps> = ({ onSubmit }) => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // 验证代码
  const validateCode = useCallback(() => {
    setIsValidating(true);
    setValidationErrors([]);

    // 简单的代码验证
    const errors: string[] = [];
    
    if (!code.includes('class')) {
      errors.push(t('cloudStorage.validation.noClass'));
    }
    
    const dangerousPatterns = [
      { pattern: /\beval\s*\(/, desc: 'eval()' },
      { pattern: /\bdocument\b/, desc: 'document' },
      { pattern: /\bwindow\b/, desc: 'window' },
    ];

    for (const { pattern, desc } of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(t('cloudStorage.validation.dangerousPattern', { pattern: desc }));
      }
    }

    setValidationErrors(errors);
    setIsValidating(false);
    return errors.length === 0;
  }, [code, t]);

  const handleSubmit = () => {
    if (validateCode()) {
      onSubmit(code, { name });
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label>{t('cloudStorage.connectorName')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('cloudStorage.namePlaceholder')}
          style={{ width: '100%', padding: 8, marginTop: 8 }}
        />
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <label>{t('cloudStorage.connectorCode')}</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('cloudStorage.codePlaceholder')}
          style={{ 
            width: '100%', 
            height: 300, 
            padding: 8, 
            marginTop: 8,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        />
      </div>

      {validationErrors.length > 0 && (
        <div style={{ color: '#ff4d4f', marginBottom: 16 }}>
          <strong>{t('cloudStorage.validationErrors')}:</strong>
          <ul>
            {validationErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <Button
        type="primary"
        onClick={handleSubmit}
        disabled={!name || !code || validationErrors.length > 0}
        loading={isValidating}
      >
        {t('cloudStorage.addConnector')}
      </Button>
    </div>
  );
};

export default CloudStoragePanel;
