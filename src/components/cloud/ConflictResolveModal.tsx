import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Descriptions, Button, Space, Typography } from 'antd';
import type { ConflictInfo } from '../../types';

const { Text } = Typography;

interface ConflictResolveModalProps {
  visible: boolean;
  conflict: ConflictInfo | null;
  onResolve: (resolution: 'local' | 'remote' | 'skip') => void;
  onCancel: () => void;
}

export const ConflictResolveModal: React.FC<ConflictResolveModalProps> = ({
  visible,
  conflict,
  onResolve,
  onCancel,
}) => {
  const { t } = useTranslation();

  if (!conflict) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString();
  };

  return (
    <Modal
      title={t('cloudStorage.conflict.title')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={700}
    >
      <Text type="secondary">{t('cloudStorage.conflict.description')}</Text>
      
      <div style={{ marginTop: 24 }}>
        <Descriptions
          title={t('cloudStorage.conflict.compareTitle')}
          bordered
          column={2}
          size="small"
        >
          <Descriptions.Item 
            label={t('cloudStorage.syncToCloud.localVersion')}
            span={1}
          >
            <Space direction="vertical" size={4}>
              <Text strong>{conflict.localChecksum.substring(0, 12)}...</Text>
              <Text type="secondary">
                {t('cloudStorage.syncToCloud.localModified')}: {formatDate(conflict.localModifiedAt)}
              </Text>
              <Text type="secondary">
                {t('cloudStorage.syncToCloud.localSize')}: {formatSize(conflict.localSize)}
              </Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item 
            label={t('cloudStorage.syncToCloud.remoteVersion')}
            span={1}
          >
            <Space direction="vertical" size={4}>
              <Text strong>{conflict.remoteChecksum.substring(0, 12)}...</Text>
              <Text type="secondary">
                {t('cloudStorage.syncToCloud.remoteModified')}: {formatDate(conflict.remoteModifiedAt)}
              </Text>
              <Text type="secondary">
                {t('cloudStorage.syncToCloud.remoteSize')}: {formatSize(conflict.remoteSize)}
              </Text>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </div>

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <Space>
          <Button onClick={() => onResolve('skip')}>
            {t('cloudStorage.syncToCloud.conflictSkip')}
          </Button>
          <Button onClick={() => onResolve('remote')}>
            {t('cloudStorage.syncToCloud.conflictRemote')}
          </Button>
          <Button type="primary" onClick={() => onResolve('local')}>
            {t('cloudStorage.syncToCloud.conflictLocal')}
          </Button>
        </Space>
      </div>
    </Modal>
  );
};

export default ConflictResolveModal;