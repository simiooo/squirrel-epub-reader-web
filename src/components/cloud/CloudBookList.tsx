import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { List, Empty, Spin, message } from 'antd';
import { getCloudBooksByConnector } from '../../db';
import type { StoredCloudBook, StoredConnector } from '../../types';
import { CloudBookCard } from './CloudBookCard';

interface CloudBookListProps {
  connectorId: string;
  connector: StoredConnector;
  onDownload: (cloudBook: StoredCloudBook, connector: StoredConnector) => Promise<void>;
  onDelete?: (cloudBook: StoredCloudBook, connector: StoredConnector) => void;
  cachedBookIds?: Set<string>;
  downloadingIds?: Set<string>;
}

export const CloudBookList: React.FC<CloudBookListProps> = ({
  connectorId,
  connector,
  onDownload,
  onDelete,
  cachedBookIds = new Set(),
  downloadingIds = new Set(),
}) => {
  const { t } = useTranslation();
  const [cloudBooks, setCloudBooks] = useState<StoredCloudBook[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleDelete = useCallback((cloudBook: StoredCloudBook) => {
    onDelete?.(cloudBook, connector);
  }, [onDelete, connector]);

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
      <List
        grid={{
          gutter: 16,
          xs: 2,
          sm: 3,
          md: 4,
          lg: 5,
          xl: 6,
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
              onDelete={handleDelete}
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default CloudBookList;