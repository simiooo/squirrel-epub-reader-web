import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Collapse, Empty, Spin, Tag, Space, Button, message, theme } from 'antd';
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

const { Title, Text } = Typography;
const { Panel } = Collapse;
const { useToken } = theme;

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
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
      // 先删除远程存储中的文件（包括书籍、封面和元信息）
      const connectorInstance = getConnectorInstance(connector);
      if (connectorInstance) {
        await connectorInstance.deleteBook({
          remotePath: cloudBook.remotePath,
          coverPath: cloudBook.coverPath,
          metadataPath: cloudBook.metadataPath,
        });
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
      style={{ 
        minHeight: '100vh', 
        backgroundColor: token.colorBgLayout, 
        padding: 0, 
        overflow: 'auto' 
      }}
    >
      <GestureOverlay />
      
      {/* Hero Section */}
      <div style={{ 
        padding: '48px 24px 32px',
        maxWidth: 1600,
        margin: '0 auto',
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 24,
        }}>
          <div>
            <Title level={1} style={{ margin: 0, fontSize: token.fontSizeLG * 2 }}>
              {t('nav.myBookshelf')}
            </Title>
            <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
              {t('book.import')}
            </Text>
          </div>
          <Space size={12}>
            <LanguageSwitcher />
            <SettingsButton onCloudSyncComplete={handleSyncComplete} />
            <BookImport onImport={handleImport} />
          </Space>
        </div>
      </div>

      {/* 本地书架 */}
      <div style={{ 
        padding: '0 24px 48px',
        maxWidth: 1600,
        margin: '0 auto',
      }}>
        <BookList refreshTrigger={refreshTrigger} onSyncSuccess={handleSyncComplete} />
      </div>

      {/* 云端书架分类 */}
      {connectors.length > 0 && (
        <div style={{ 
          padding: '0 24px 48px',
          maxWidth: 1600,
          margin: '0 auto',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}>
            <CloudOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
            <Title level={3} style={{ margin: 0 }}>
              {t('cloudStorage.cloudBooks.title')}
            </Title>
          </div>
          
          <Collapse
            defaultActiveKey={connectors.map(c => c.id)}
            expandIcon={({ isActive }) => <DownOutlined style={{ transition: 'transform 0.2s' }} rotate={isActive ? 0 : -90} />}
            style={{ backgroundColor: token.colorBgContainer, borderRadius: token.borderRadiusLG }}
          >
            {connectors.map(connector => {
              const cloudBooks = cloudBooksByConnector.get(connector.id) || [];
              
              return (
                <Panel
                  key={connector.id}
                  header={
                    <Space>
                      <Text strong>{connector.name}</Text>
                      <Tag style={{ borderRadius: token.borderRadiusSM }}>{cloudBooks.length}</Tag>
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
                      refreshTrigger={refreshTrigger}
                    />
                  )}
                </Panel>
              );
            })}
          </Collapse>
        </div>
      )}
    </div>
  );
};

export default HomePage;