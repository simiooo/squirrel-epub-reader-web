import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag, Progress as AntProgress, Spin, Popconfirm } from 'antd';
import { CloudDownloadOutlined, BookOutlined, DeleteOutlined } from '@ant-design/icons';
import type { StoredCloudBook, StoredConnector } from '../../types';
import { downloadBookFromCloud, type SyncProgress } from '../../services/bookSyncService';

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
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<SyncProgress | null>(null);
  const [isCached, setIsCached] = useState(cloudBook.cached || false);

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
    setDownloadProgress({ stage: 'preparing', progress: 0, message: t('cloudStorage.cloudBooks.downloading') });

    try {
      const result = await downloadBookFromCloud(
        cloudBook,
        connector,
        (progress) => setDownloadProgress(progress),
        async (conflictInfo) => {
          const resolution = await showConflictDialog(conflictInfo);
          return resolution;
        }
      );

      if (result.success) {
        setIsCached(true);
        onRefresh?.();
        onDownload?.(cloudBook);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const showConflictDialog = async (conflict: { localSize: number; remoteSize: number; localModifiedAt: Date; remoteModifiedAt: Date }): Promise<'local' | 'remote' | 'skip'> => {
    return new Promise((resolve) => {
      const localTime = new Date(conflict.localModifiedAt).toLocaleString();
      const remoteTime = new Date(conflict.remoteModifiedAt).toLocaleString();
      
      const confirmed = window.confirm(
        `${t('cloudStorage.conflict.title')}:\n\n` +
        `${t('cloudStorage.conflict.localInfo')}: ${formatSize(conflict.localSize)} (${localTime})\n` +
        `${t('cloudStorage.conflict.remoteInfo')}: ${formatSize(conflict.remoteSize)} (${remoteTime})\n\n` +
        `${t('cloudStorage.syncToCloud.conflictLocal')}\n` +
        `${t('cloudStorage.syncToCloud.conflictRemote')}`
      );
      
      resolve(confirmed ? 'remote' : 'local');
    });
  };

  return (
    <div className="book-card book-card-compact">
      {/* 封面区域 */}
      {cloudBook.cover ? (
        <div className="book-card-cover">
          <img alt={cloudBook.metadata.title} src={cloudBook.cover} />
          
          {/* 下载进度条 */}
          {downloading && downloadProgress && (
            <div className="book-card-progress">
              <AntProgress 
                percent={downloadProgress.progress} 
                size="small"
                showInfo={false}
                status={downloadProgress.stage === 'error' ? 'exception' : 'active'}
              />
            </div>
          )}
          
          {/* 已缓存标签 */}
          {isCached && (
            <div className="book-card-status">
              <Tag color="success">{t('cloudStorage.cloudBooks.cached')}</Tag>
            </div>
          )}
        </div>
      ) : (
        <div className="book-card-no-cover">
          <BookOutlined />
          <span>{t('book.noCover')}</span>
          
          {/* 下载进度条 */}
          {downloading && downloadProgress && (
            <div className="book-card-progress">
              <AntProgress 
                percent={downloadProgress.progress} 
                size="small"
                showInfo={false}
                status={downloadProgress.stage === 'error' ? 'exception' : 'active'}
              />
            </div>
          )}
          
          {/* 已缓存标签 */}
          {isCached && (
            <div className="book-card-status">
              <Tag color="success">{t('cloudStorage.cloudBooks.cached')}</Tag>
            </div>
          )}
        </div>
      )}
      
      {/* 悬浮信息层 */}
      <div className="book-card-overlay">
        <div className="book-card-info">
          <div className="book-card-title">{cloudBook.metadata.title}</div>
          <div className="book-card-author">{cloudBook.metadata.author}</div>
          <div className="book-card-meta">
            <span>{formatSize(cloudBook.size)}</span>
            <span>·</span>
            <span>{formatDate(cloudBook.remoteModifiedAt)}</span>
          </div>
          <div className="book-card-meta" style={{ marginTop: 4 }}>
            <span>{connector.name}</span>
          </div>
        </div>
        
        {/* 操作按钮 - 悬浮时显示 */}
        <div className="book-card-actions">
          <Spin spinning={downloading} size="small">
            <Button
              type="primary"
              size="small"
              icon={<CloudDownloadOutlined />}
              data-gesture-clickable="true"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              disabled={downloading || isCached}
            >
              {isCached ? t('cloudStorage.cloudBooks.cached') : t('cloudStorage.cloudBooks.download')}
            </Button>
          </Spin>
          
          {onDelete && (
            <Popconfirm
              title={t('book.deleteConfirm')}
              description={t('book.deleteConfirmDesc')}
              onConfirm={(e) => {
                e?.stopPropagation();
                onDelete(cloudBook);
              }}
              okText={t('common.delete')}
              cancelText={t('common.cancel')}
            >
              <Button 
                type="primary" 
                size="small" 
                danger 
                icon={<DeleteOutlined />}
                data-gesture-clickable="true"
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          )}
        </div>
      </div>
    </div>
  );
};

export default CloudBookCard;
