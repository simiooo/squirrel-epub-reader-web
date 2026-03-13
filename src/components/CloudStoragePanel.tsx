import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Card, List, Tag, Space, message, Spin, Empty, Tabs, Badge, Form, Input } from 'antd';
import { CloudSyncOutlined, PlusOutlined, DeleteOutlined, EditOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { getAllConnectors, addConnector, updateConnector, deleteConnector } from '../db';
import type { ConnectorTypeInfo } from '../types/cloudStorage';
import type { StoredConnector } from '../types';
import { ConnectorConfigForm } from './cloud/ConnectorConfigForm';

interface CloudStoragePanelProps {
  onSyncComplete?: () => void;
}

const PRESET_CONNECTORS: Array<{ type: string; name: string; typeInfo: ConnectorTypeInfo }> = [
  {
    type: 'dropbox',
    name: 'Dropbox',
    typeInfo: {
      type: 'dropbox',
      displayName: 'Dropbox',
      description: 'cloudStorage.dropboxDesc',
      authMethods: ['oauth2'],
      requiredSettings: [
        { key: 'appKey', label: 'App Key', type: 'text', required: true, placeholder: 'Your Dropbox App Key' },
      ],
      optionalSettings: [
        { key: 'rootPath', label: 'Sync Path', type: 'text', required: false, placeholder: '/SquirrelReader' },
      ],
    },
  },
  {
    type: 'googledrive',
    name: 'Google Drive',
    typeInfo: {
      type: 'googledrive',
      displayName: 'Google Drive',
      description: 'cloudStorage.googleDriveDesc',
      authMethods: ['oauth2'],
      requiredSettings: [
        { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'Your Google Client ID' },
      ],
      optionalSettings: [
        { key: 'rootPath', label: 'Folder Name', type: 'text', required: false, placeholder: 'SquirrelReader' },
      ],
    },
  },
  {
    type: 's3',
    name: 'S3 Compatible',
    typeInfo: {
      type: 's3',
      displayName: 'S3 Compatible',
      description: 'cloudStorage.s3Desc',
      authMethods: ['api_key'],
      requiredSettings: [
        { key: 'endpoint', label: 'Endpoint URL', type: 'url', required: true, placeholder: 'https://bucket-name.s3.region.backblaze.com or https://s3.region.amazonaws.com' },
        { key: 'bucket', label: 'Bucket Name', type: 'text', required: true, placeholder: 'my-bucket' },
        { key: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
        { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      ],
      optionalSettings: [
        { key: 'region', label: 'Region', type: 'text', required: false, placeholder: 'us-east-1' },
        { key: 'rootPath', label: 'Sync Path', type: 'text', required: false, placeholder: '/SquirrelReader' },
        { key: 'forcePathStyle', label: 'Force Path-Style URL', type: 'boolean', required: false, description: 'Use path-style URL format (e.g., https://s3.amazonaws.com/bucket-name). Enable this if you encounter CORS issues.' },
      ],
    },
  },
];

export const CloudStoragePanel: React.FC<CloudStoragePanelProps> = ({ onSyncComplete }) => {
  const { t } = useTranslation();
  const [connectors, setConnectors] = useState<StoredConnector[]>([]);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isManageModalVisible, setIsManageModalVisible] = useState(false);
  const [isConfigModalVisible, setIsConfigModalVisible] = useState(false);
  const [editingConnector, setEditingConnector] = useState<StoredConnector | null>(null);
  const [selectedConnectorType, setSelectedConnectorType] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const storedConnectors = await getAllConnectors();
      setConnectors(storedConnectors);
    } catch (error) {
      console.error('Failed to load connectors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConnector = useCallback((connector: StoredConnector) => {
    Modal.confirm({
      title: t('cloudStorage.deleteConfirmTitle'),
      content: t('cloudStorage.deleteConfirmContent', { name: connector.name }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteConnector(connector.id);
          message.success(t('cloudStorage.connectorDeleted'));
          await loadConnectors();
          onSyncComplete?.();
        } catch (error) {
          message.error(t('common.error'));
          console.error('Failed to delete connector:', error);
        }
      },
    });
  }, [t, onSyncComplete]);

  const handleAddPresetConnector = useCallback((type: string) => {
    const preset = PRESET_CONNECTORS.find(p => p.type === type);
    if (preset) {
      setSelectedConnectorType(type);
      setEditingConnector(null);
      setIsAddModalVisible(false); // 关闭添加连接器modal
      setIsConfigModalVisible(true);
    }
  }, []);

  const handleEditConnector = useCallback((connector: StoredConnector) => {
    setEditingConnector(connector);
    setSelectedConnectorType(connector.type);
    setIsConfigModalVisible(true);
  }, []);

  const handleSaveConnector = useCallback(async (connectorData: Omit<StoredConnector, 'id' | 'createdAt'>) => {
    try {
      console.log('handleSaveConnector received:', connectorData);
      if (editingConnector) {
        // 更新现有连接器
        const updated: StoredConnector = {
          ...editingConnector,
          ...connectorData,
          id: editingConnector.id,
          createdAt: editingConnector.createdAt,
        };
        console.log('Updating connector:', updated);
        await updateConnector(updated);
        setConnectors(prev => prev.map(c => c.id === editingConnector.id ? updated : c));
        message.success(t('common.success'));
      } else {
        // 添加新连接器
        const newConnector: StoredConnector = {
          ...connectorData,
          id: `${connectorData.type}-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        console.log('Adding new connector:', newConnector);
        await addConnector(newConnector);
        setConnectors(prev => [...prev, newConnector]);
        message.success(t('cloudStorage.connectorAdded'));
      }
      
      setIsConfigModalVisible(false);
      setEditingConnector(null);
      setSelectedConnectorType('');
      await loadConnectors();
    } catch (error) {
      message.error(t('common.error'));
      console.error('Failed to save connector:', error);
    }
  }, [editingConnector, t]);

  const getAuthStatusTag = (status: string | undefined) => {
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

  const getConnectorTypeInfo = (type: string): ConnectorTypeInfo | undefined => {
    return PRESET_CONNECTORS.find(p => p.type === type)?.typeInfo;
  };

  const renderConnectorItem = (connector: StoredConnector) => {
    const typeInfo = getConnectorTypeInfo(connector.type);

    return (
      <List.Item
        actions={[
          <Button
            key="edit"
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEditConnector(connector)}
          >
            {t('cloudStorage.edit')}
          </Button>,
          <Button
            key="delete"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteConnector(connector)}
          >
            {t('common.delete')}
          </Button>,
        ]}
      >
        <List.Item.Meta
          avatar={<CloudSyncOutlined style={{ fontSize: 32, color: '#1890ff' }} />}
          title={
            <Space>
              <span>{connector.name}</span>
              {getAuthStatusTag(connector.authStatus)}
            </Space>
          }
          description={
            <Space direction="vertical" size={0}>
              <span>{typeInfo?.displayName || connector.type}</span>
              {connector.lastSyncAt && (
                <span style={{ fontSize: 12, color: '#999' }}>
                  {t('cloudStorage.lastSync')}: {new Date(connector.lastSyncAt).toLocaleString()}
                </span>
              )}
            </Space>
          }
        />
      </List.Item>
    );
  };

  return (
    <>
      <Badge count={connectors.length} showZero>
        <Button
          icon={<CloudSyncOutlined />}
          onClick={() => setIsManageModalVisible(true)}
        >
          {t('cloudStorage.manage')}
        </Button>
      </Badge>

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
        <Spin spinning={loading}>
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
        </Spin>
      </Modal>

      <Modal
        title={t('cloudStorage.addConnector')}
        open={isAddModalVisible}
        onCancel={() => setIsAddModalVisible(false)}
        footer={null}
        width={800}
        zIndex={1100}
      >
        <Tabs
          items={[
            {
              key: 'preset',
              label: t('cloudStorage.presetConnectors'),
              children: (
                <List
                  grid={{ gutter: 16, column: 2 }}
                  dataSource={PRESET_CONNECTORS}
                  renderItem={(item) => (
                    <List.Item>
                      <Card
                        hoverable
                        onClick={() => handleAddPresetConnector(item.type)}
                        title={item.name}
                      >
                        {t(item.typeInfo.description)}
                      </Card>
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: 'custom',
              label: t('cloudStorage.customConnector'),
              children: <CustomConnectorForm onSubmit={handleSaveConnector} />,
            },
          ]}
        />
      </Modal>

      <ConnectorConfigForm
        visible={isConfigModalVisible}
        connectorType={selectedConnectorType}
        connectorTypeInfo={getConnectorTypeInfo(selectedConnectorType)}
        editingConnector={editingConnector}
        onSubmit={handleSaveConnector}
        onCancel={() => {
          setIsConfigModalVisible(false);
          setEditingConnector(null);
          setSelectedConnectorType('');
        }}
      />
    </>
  );
};

interface CustomConnectorFormProps {
  onSubmit: (connector: Omit<StoredConnector, 'id' | 'createdAt'>) => Promise<void>;
}

const CustomConnectorForm: React.FC<CustomConnectorFormProps> = ({ onSubmit }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const validateCode = (code: string) => {
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

    return errors;
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setIsValidating(true);
      setValidationErrors([]);

      const errors = validateCode(values.code);
      if (errors.length > 0) {
        setValidationErrors(errors);
        setIsValidating(false);
        return;
      }

      await onSubmit({
        name: values.name,
        type: 'custom',
        settings: { code: values.code },
        authStatus: 'unauthenticated',
      });
      
      form.resetFields();
    } catch (error) {
      console.error('Form validation failed:', error);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="name"
        label={t('cloudStorage.connectorName')}
        rules={[{ required: true, message: t('cloudStorage.validation.nameRequired') }]}
      >
        <Input placeholder={t('cloudStorage.namePlaceholder')} />
      </Form.Item>
      
      <Form.Item
        name="code"
        label={t('cloudStorage.connectorCode')}
        rules={[{ required: true, message: t('cloudStorage.validation.codeRequired') }]}
      >
        <Input.TextArea
          placeholder={t('cloudStorage.codePlaceholder')}
          rows={10}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Form.Item>

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

      <Form.Item>
        <Button
          type="primary"
          onClick={handleSubmit}
          loading={isValidating}
        >
          {t('cloudStorage.addConnector')}
        </Button>
      </Form.Item>
    </Form>
  );
};

export default CloudStoragePanel;