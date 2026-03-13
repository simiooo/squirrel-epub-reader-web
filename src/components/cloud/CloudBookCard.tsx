import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Tag, Progress as AntProgress, Space, Spin, Popconfirm, Typography } from 'antd';
import { CloudDownloadOutlined, BookOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import type { StoredCloudBook, StoredConnector } from '../../types';
import { downloadBookFromCloud, type SyncProgress } from '../../services/bookSyncService';
import { getBook } from '../../db';

const { Text } = Typography;

interface CloudBookCardProps {
  cloudBook: StoredCloudBook;
  connector: StoredConnector;
  isCached?: boolean;
  isDownloading?: boolean;
  onDownload?: (cloudBook: StoredCloudBook) => void;
  onDelete?: (cloudBook: StoredCloudBook) => void;
  onRefresh?: () => void;
}

export const CloudBookCard: React.FC<CloudBookCardProps> = ({
  cloudBook,
  connector,
  onDownload,
  onDelete,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<SyncProgress | null>(null);
  const [isCached, setIsCached] = useState(cloudBook.cached || false);

  const getSyncStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string; text: string }> = {
      synced: { color: 'success', text: t('cloudStorage.cloudBooks.syncStatus.synced') },
      pending: { color: 'processing', text: t('cloudStorage.cloudBooks.syncStatus.pending') },
      conflict: { color: 'warning', text: t('cloudStorage.cloudBooks.syncStatus.conflict') },
      error: { color: 'error', text: t('cloudStorage.cloudBooks.syncStatus.error') },
      local_only: { color: 'default', text: t('cloudStorage.cloudBooks.syncStatus.local_only') },
      remote_only: { color: 'default', text: t('cloudStorage.cloudBooks.syncStatus.remote_only') },
    };
    const config = statusConfig[status] || statusConfig.remote_only;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const handleDownload = async () => {
    if (downloading) return;

    setDownloading(true);
    setDownloadProgress({ stage: 'preparing', progress: 0, message: '准备下载...' });

    try {
      const result = await downloadBookFromCloud(
        cloudBook,
        connector,
        (progress) => setDownloadProgress(progress),
        async (conflictInfo) => {
          // 冲突处理 - 显示给用户选择
          const resolution = await showConflictDialog(conflictInfo);
          return resolution;
        }
      );

      if (result.success) {
        setIsCached(true);
        onRefresh?.();
        onDownload?.(cloudBook);
      } else if (result.error) {
        // 用户取消了或有错误
        console.log('Download result:', result.error);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleRead = async () => {
    if (!cloudBook.cached) {
      // 需要先下载
      await handleDownload();
    }
    
    // 检查本地书籍是否存在
    const localBook = await getBook(cloudBook.bookId);
    if (localBook) {
      navigate(`/read/${cloudBook.bookId}`);
    }
  };

  const showConflictDialog = async (conflict: { localSize: number; remoteSize: number; localModifiedAt: Date; remoteModifiedAt: Date }): Promise<'local' | 'remote' | 'skip'> => {
    return new Promise((resolve) => {
      // 简单的确认对话框 - 实际项目中应该使用更友好的UI
      const localTime = new Date(conflict.localModifiedAt).toLocaleString();
      const remoteTime = new Date(conflict.remoteModifiedAt).toLocaleString();
      
      const confirmed = window.confirm(
        `检测到冲突:\n\n` +
        `本地版本: ${formatSize(conflict.localSize)} (${localTime})\n` +
        `云端版本: ${formatSize(conflict.remoteSize)} (${remoteTime})\n\n` +
        `点击"确定"使用云端版本覆盖本地\n` +
        `点击"取消"保留本地版本`
      );
      
      resolve(confirmed ? 'remote' : 'local');
    });
  };

  return (
    <Card
      hoverable
      cover={
        cloudBook.cover ? (
          <div style={{ height: 200, overflow: 'hidden' }}>
            <img
              alt={cloudBook.metadata.title}
              src={cloudBook.cover}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
        ) : (
          <div
            style={{
              height: 200,
              background: 'linear-gradient(135deg, #1890ff 0%, #722ed1 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BookOutlined style={{ fontSize: 48, color: 'rgba(255, 255, 255, 0.8)', marginBottom: 12 }} />
            <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14 }}>
              {t('book.noCover')}
            </span>
          </div>
        )
      }
      actions={[
        <Spin key="download" spinning={downloading}>
          <Button
            type="text"
            icon={<CloudDownloadOutlined />}
            onClick={handleDownload}
            disabled={downloading || isCached}
          >
            {isCached ? t('cloudStorage.cloudBooks.cached') : t('cloudStorage.cloudBooks.download')}
          </Button>
        </Spin>,
        <Button
          key="read"
          type="text"
          icon={<EyeOutlined />}
          onClick={handleRead}
          disabled={!isCached && !cloudBook.cached}
        >
          {t('cloudStorage.cloudBooks.open')}
        </Button>,
        onDelete ? (
          <Popconfirm
            key="delete"
            title={t('book.deleteConfirm')}
            description={t('book.deleteConfirmDesc')}
            onConfirm={() => onDelete(cloudBook)}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
          >
            <Button type="text" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        ) : null,
      ].filter(Boolean)}
    >
      {downloading && downloadProgress && (
        <div style={{ marginBottom: 12 }}>
          <AntProgress 
            percent={downloadProgress.progress} 
            size="small"
            status={downloadProgress.stage === 'error' ? 'exception' : 'active'}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>{downloadProgress.message}</Text>
        </div>
      )}
      
      <Card.Meta
        title={
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cloudBook.metadata.title}
          </div>
        }
        description={
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('book.author')}: {cloudBook.metadata.author}
            </div>
            <Space size={4} wrap>
              {getSyncStatusTag(cloudBook.syncStatus)}
              {isCached ? <Tag color="blue">{t('cloudStorage.cloudBooks.cached')}</Tag> : null}
            </Space>
            <div style={{ fontSize: 12, color: '#999' }}>
              {formatSize(cloudBook.size)} · {t('book.addedAt')} {formatDate(cloudBook.remoteModifiedAt)}
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {connector.name}
            </Text>
          </Space>
        }
      />
    </Card>
  );
};

export default CloudBookCard;