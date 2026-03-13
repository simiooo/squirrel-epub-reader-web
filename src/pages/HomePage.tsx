import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Collapse, Empty, Spin, Tag, Space, Divider, Button, message } from 'antd';
import { CloudOutlined, SyncOutlined, DownOutlined } from '@ant-design/icons';
import { BookList } from '../components/BookList';
import { BookImport } from '../components/BookImport';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { SettingsButton } from '../components/SettingsButton';
import { GestureOverlay } from '../components/gesture/GestureOverlay';
import { CloudBookList } from '../components/cloud/CloudBookList';
import { getAllConnectors, getAllCloudBooks, deleteCloudBook } from '../db';
import { refreshCloudBooks, getConnectorInstance } from '../services/bookSyncService';
import type { StoredConnector, StoredCloudBook } from '../types';

const { Title } = Typography;
const { Panel } = Collapse;

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [connectors, setConnectors] = useState<StoredConnector[]>([]);
  const [cloudBooksByConnector, setCloudBooksByConnector] = useState<Map<string, StoredCloudBook[]>>(new Map());
  const [cachedBookIds, setCachedBookIds] = useState<Set<string>>(new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshingConnector, setRefreshingConnector] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [storedConnectors, allCloudBooks] = await Promise.all([
        getAllConnectors(),
        getAllCloudBooks(),
      ]);
      
      console.log('Loaded connectors:', storedConnectors);
      console.log('Authenticated connectors:', storedConnectors.filter(c => c.authStatus === 'authenticated'));
      
      setConnectors(storedConnectors.filter(c => c.authStatus === 'authenticated'));
      
      const booksByConnector = new Map<string, StoredCloudBook[]>();
      allCloudBooks.forEach(book => {
        const books = booksByConnector.get(book.connectorId) || [];
        books.push(book);
        booksByConnector.set(book.connectorId, books);
      });
      setCloudBooksByConnector(booksByConnector);
      
      const cached = new Set(
        allCloudBooks.filter(b => b.cached).map(b => b.bookId)
      );
      setCachedBookIds(cached);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSyncComplete = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleDownloadCloudBook = useCallback(async (_cloudBook: StoredCloudBook, _connector: StoredConnector) => {
    setDownloadingIds(prev => new Set(prev).add(_cloudBook.id));
    try {
      // CloudBookCard组件内部处理实际的下载逻辑
      // 这里只是更新UI状态
      setCachedBookIds(prev => new Set(prev).add(_cloudBook.bookId));
      setRefreshTrigger(prev => prev + 1);
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(_cloudBook.id);
        return next;
      });
    }
  }, []);

  const handleDeleteCloudBook = useCallback(async (cloudBook: StoredCloudBook, connector: StoredConnector) => {
    try {
      // 先删除远程存储中的文件
      const connectorInstance = getConnectorInstance(connector);
      if (connectorInstance) {
        await connectorInstance.deleteBook(cloudBook.remotePath);
      }
      
      // 再删除本地云端记录
      await deleteCloudBook(cloudBook.id);
      
      // 刷新列表
      setRefreshTrigger(prev => prev + 1);
      
      message.success(t('cloudStorage.cloudBooks.deleteSuccess'));
    } catch (error) {
      console.error('Failed to delete cloud book:', error);
      message.error(t('cloudStorage.cloudBooks.deleteFailed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, [t]);

  const handleRefreshConnector = useCallback(async (connector: StoredConnector) => {
    setRefreshingConnector(connector.id);
    try {
      await refreshCloudBooks(connector);
      await loadData();
      message.success(t('cloudStorage.connectorSyncSuccess', { name: connector.name, books: 0 }));
    } catch (error) {
      message.error(t('cloudStorage.connectorSyncFailed'));
      console.error('Refresh failed:', error);
    } finally {
      setRefreshingConnector(null);
    }
  }, [t]);

  if (loading && refreshTrigger === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      data-gesture-scrollable
      style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: 24, overflow: 'auto' }}
    >
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      <GestureOverlay />
      <div style={{ 
        marginBottom: 24, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <Title level={2} style={{ margin: 0 }}>{t('nav.myBookshelf')}</Title>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LanguageSwitcher />
          <SettingsButton onCloudSyncComplete={handleSyncComplete} />
          <BookImport onImport={handleImport} />
        </div>
      </div>

      {/* 本地书架 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 16 }}>
          {t('book.import')}
        </Title>
        <BookList refreshTrigger={refreshTrigger} onSyncSuccess={handleSyncComplete} />
      </div>

      {/* 云端书架分类 */}
      {connectors.length > 0 && (
        <>
          <Divider />
          <Title level={4} style={{ marginBottom: 16 }}>
            <Space>
              <CloudOutlined />
              {t('cloudStorage.cloudBooks.title')}
            </Space>
          </Title>
          
          <Collapse
            defaultActiveKey={connectors.map(c => c.id)}
            expandIcon={({ isActive }) => <DownOutlined style={{ transition: 'transform 0.2s' }} rotate={isActive ? 0 : -90} />}
          >
            {connectors.map(connector => {
              const cloudBooks = cloudBooksByConnector.get(connector.id) || [];
              
              return (
                <Panel
                  key={connector.id}
                  header={
                    <Space>
                      <span>{connector.name}</span>
                      <Tag color="blue">{cloudBooks.length}</Tag>
                    </Space>
                  }
                  extra={
                    <Space onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="text"
                        size="small"
                        icon={<SyncOutlined spin={refreshingConnector === connector.id} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRefreshConnector(connector);
                        }}
                        loading={refreshingConnector === connector.id}
                      >
                        {t('cloudStorage.sync')}
                      </Button>
                    </Space>
                  }
                >
                  {cloudBooks.length === 0 ? (
                    <Empty
                      description={t('book.noBooks')}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ) : (
                    <CloudBookList
                      connectorId={connector.id}
                      connector={connector}
                      onDownload={handleDownloadCloudBook}
                      onDelete={handleDeleteCloudBook}
                      cachedBookIds={cachedBookIds}
                      downloadingIds={downloadingIds}
                    />
                  )}
                </Panel>
              );
            })}
          </Collapse>
        </>
      )}
      </div>
    </div>
  );
};

export default HomePage;