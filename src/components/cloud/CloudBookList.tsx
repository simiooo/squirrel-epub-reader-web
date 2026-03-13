import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { List, Empty, Spin, message, Typography, Space, Tag } from 'antd';
import { CloudOutlined, SyncOutlined } from '@ant-design/icons';
import { getCloudBooksByConnector } from '../../db';
import type { StoredCloudBook, StoredConnector } from '../../types';
import { CloudBookCard } from './CloudBookCard';

const { Title } = Typography;

interface CloudBookListProps {
  connectorId: string;
  connectorName: string;
  connector: StoredConnector;
  onDownload: (cloudBook: StoredCloudBook, connector: StoredConnector) => Promise<void>;
  onDelete?: (cloudBook: StoredCloudBook) => void;
  cachedBookIds?: Set<string>;
  downloadingIds?: Set<string>;
}

export const CloudBookList: React.FC<CloudBookListProps> = ({
  connectorId,
  connectorName,
  connector,
  onDownload,
  onDelete,
  cachedBookIds = new Set(),
  downloadingIds = new Set(),
}) => {
  const { t } = useTranslation();
  const [cloudBooks, setCloudBooks] = useState<StoredCloudBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCloudBooks = useCallback(async () => {
    setLoading(true);
    try {
      const books = await getCloudBooksByConnector(connectorId);
      setCloudBooks(books);
    } catch (error) {
      console.error('Failed to load cloud books:', error);
      message.error(t('book.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [connectorId, t]);

  useEffect(() => {
    loadCloudBooks();
  }, [loadCloudBooks]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // TODO: 实现从云端刷新书籍列表
      await loadCloudBooks();
    } finally {
      setRefreshing(false);
    }
  }, [loadCloudBooks]);

  const handleDownload = useCallback(async (cloudBook: StoredCloudBook) => {
    try {
      await onDownload(cloudBook, connector);
      message.success(t('cloudStorage.cloudBooks.downloadSuccess'));
    } catch (error) {
      message.error(t('cloudStorage.cloudBooks.downloadFailed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, [onDownload, connector, t]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (cloudBooks.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('book.noBooks')}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          <Space>
            <CloudOutlined />
            {connectorName}
            <Tag color="blue">{cloudBooks.length}</Tag>
          </Space>
        </Title>
        <Space>
          <Tag onClick={handleRefresh} style={{ cursor: refreshing ? 'wait' : 'pointer' }}>
            {refreshing ? <SyncOutlined spin /> : <SyncOutlined />}
            {' '}{t('cloudStorage.sync')}
          </Tag>
        </Space>
      </div>

      <List
        grid={{
          gutter: 24,
          xs: 1,
          sm: 2,
          md: 3,
          lg: 4,
          xl: 5,
        }}
        dataSource={cloudBooks}
        renderItem={(cloudBook) => (
          <List.Item>
            <CloudBookCard
              cloudBook={cloudBook}
              connector={connector}
              isCached={cachedBookIds.has(cloudBook.bookId)}
              isDownloading={downloadingIds.has(cloudBook.id)}
              onDownload={handleDownload}
              onDelete={onDelete}
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default CloudBookList;