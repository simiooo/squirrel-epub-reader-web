import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, Select, Button, Spin, message, Space, Tag, Empty, Alert, Progress, Typography, theme } from 'antd';
import { CloudUploadOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { getAllConnectors } from '../../db';
import type { StoredConnector, Book } from '../../types';
import { uploadBookToCloud, type SyncProgress } from '../../services/bookSyncService';
import { ConflictResolveModal } from './ConflictResolveModal';
import type { ConflictInfo } from '../../types';

const { Text } = Typography;

interface SyncToCloudModalProps {
  visible: boolean;
  book: Book | null;
  onCancel: () => void;
  onSuccess: () => void;
}

export const SyncToCloudModal: React.FC<SyncToCloudModalProps> = ({
  visible,
  book,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [connectors, setConnectors] = useState<StoredConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<StoredConnector | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      loadConnectors();
    }
  }, [visible]);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const allConnectors = await getAllConnectors();
      const authenticatedConnectors = allConnectors.filter(c => c.authStatus === 'authenticated');
      setConnectors(authenticatedConnectors);
    } catch (error) {
      console.error('Failed to load connectors:', error);
      message.error(t('book.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleConnectorChange = useCallback((connectorId: string) => {
    const connector = connectors.find(c => c.id === connectorId);
    setSelectedConnector(connector || null);
  }, [connectors]);

  const handleSync = useCallback(async () => {
    if (!book || !selectedConnector) return;

    setSyncing(true);
    setSyncProgress({ stage: 'preparing', progress: 0, message: t('cloudStorage.syncToCloud.uploading') });

    try {
      const result = await uploadBookToCloud(
        book,
        selectedConnector,
        (progress) => setSyncProgress(progress),
        async (conflictInfo) => {
          setConflict(conflictInfo);
          setConflictModalVisible(true);
          return new Promise((resolve) => {
            const handleResolve = (resolution: 'local' | 'remote' | 'skip') => {
              setConflictModalVisible(false);
              resolve(resolution);
            };
            (window as unknown as { resolveConflict: (r: 'local' | 'remote' | 'skip') => void }).resolveConflict = handleResolve;
          });
        }
      );

      if (result.success) {
        message.success(t('cloudStorage.syncToCloud.uploadSuccess', { name: selectedConnector.name }));
        onSuccess();
      } else if (result.conflict) {
        setConflict(result.conflict);
        setConflictModalVisible(true);
      } else {
        message.error(t('cloudStorage.syncToCloud.uploadFailed', { error: result.error }));
      }
    } catch (error) {
      message.error(t('cloudStorage.syncToCloud.uploadFailed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [book, selectedConnector, t, onSuccess]);

  const handleConflictResolve = useCallback((resolution: 'local' | 'remote' | 'skip') => {
    setConflictModalVisible(false);
    setConflict(null);
    if (resolution !== 'skip') {
      handleSync();
    }
  }, [handleSync]);

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'authenticated':
        return <Tag color="success" icon={<CheckCircleOutlined />}>{t('cloudStorage.authenticated')}</Tag>;
      case 'expired':
        return <Tag color="warning">{t('cloudStorage.expired')}</Tag>;
      default:
        return <Tag>{t('cloudStorage.unauthenticated')}</Tag>;
    }
  };

  const getProgressMessage = () => {
    if (!syncProgress) return '';
    const messages: Record<string, string> = {
      preparing: t('cloudStorage.syncToCloud.uploading'),
      uploading: t('cloudStorage.syncToCloud.uploading'),
      downloading: '正在下载...',
      processing: '正在处理...',
      completed: '完成',
      error: '错误',
    };
    return messages[syncProgress.stage] || syncProgress.message;
  };

  return (
    <>
      <Modal
        title={t('cloudStorage.syncToCloud.title')}
        open={visible}
        onCancel={syncing ? undefined : onCancel}
        footer={null}
        width={500}
        closable={!syncing}
        maskClosable={!syncing}
      >
        <Spin spinning={loading}>
          {connectors.length === 0 ? (
            <>
              <Alert
                type="info"
                message={t('cloudStorage.syncToCloud.noConnectors')}
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Empty description={t('cloudStorage.noConnectors')} />
            </>
          ) : (
            <Form form={form} layout="vertical">
              {syncProgress && syncing && (
                <div style={{ marginBottom: 16 }}>
                  <Progress 
                    percent={syncProgress.progress} 
                    status={syncProgress.stage === 'error' ? 'exception' : 'active'}
                  />
                  <Text type="secondary">{getProgressMessage()}</Text>
                </div>
              )}

              <Form.Item
                name="connectorId"
                label={t('cloudStorage.syncToCloud.selectConnector')}
                rules={[{ required: true, message: t('cloudStorage.syncToCloud.selectConnectorPlaceholder') }]}
              >
                <Select
                  placeholder={t('cloudStorage.syncToCloud.selectConnectorPlaceholder')}
                  onChange={handleConnectorChange}
                  disabled={syncing}
                >
                  {connectors.map(connector => (
                    <Select.Option key={connector.id} value={connector.id}>
                      <Space>
                        <span>{connector.name}</span>
                        {getStatusTag(connector.authStatus || 'unauthenticated')}
                      </Space>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              {book && (
                <div style={{ marginBottom: 16, padding: 12, background: token.colorFillSecondary, borderRadius: 8 }}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    {book.metadata.title}
                  </Text>
                  <Text type="secondary">{book.metadata.author}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('cloudStorage.syncToCloud.localSize')}: {(book.file.size / 1024 / 1024).toFixed(2)} MB
                  </Text>
                </div>
              )}

              <div style={{ textAlign: 'right' }}>
                <Space>
                  <Button onClick={onCancel} disabled={syncing}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    onClick={handleSync}
                    loading={syncing}
                    disabled={!selectedConnector || syncing}
                  >
                    {syncing ? <SyncOutlined spin /> : null}
                    {syncing ? getProgressMessage() : t('cloudStorage.sync')}
                  </Button>
                </Space>
              </div>
            </Form>
          )}
        </Spin>
      </Modal>

      <ConflictResolveModal
        visible={conflictModalVisible}
        conflict={conflict}
        onResolve={handleConflictResolve}
        onCancel={() => {
          setConflictModalVisible(false);
          setConflict(null);
        }}
      />
    </>
  );
};

export default SyncToCloudModal;