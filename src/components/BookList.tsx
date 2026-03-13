import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  Card,
  List,
  Button,
  Progress,
  Empty,
  message,
  Popconfirm,
  Badge,
  Tag,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  BookOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { getAllBooks, getProgress, deleteBook, getAllConnectors } from '../db';
import type { Book, ReadingProgress, StoredConnector } from '../types';
import { SyncToCloudModal } from './cloud/SyncToCloudModal';

interface BookListProps {
  refreshTrigger?: number;
}

export const BookList: React.FC<BookListProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, ReadingProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connectors, setConnectors] = useState<StoredConnector[]>([]);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [syncedBookIds, setSyncedBookIds] = useState<Set<string>>(new Set());

  const loadBooks = async () => {
    setLoading(true);
    try {
      const [allBooks, allConnectors] = await Promise.all([
        getAllBooks(),
        getAllConnectors(),
      ]);
      
      setBooks(allBooks);
      setConnectors(allConnectors.filter(c => c.authStatus === 'authenticated'));

      const progressEntries = await Promise.all(
        allBooks.map(async (book) => {
          const progress = await getProgress(book.id);
          return [book.id, progress] as [string, ReadingProgress | undefined];
        })
      );

      const progressMap = new Map<string, ReadingProgress>();
      progressEntries.forEach(([bookId, progress]) => {
        if (progress) {
          progressMap.set(bookId, progress);
        }
      });
      setProgressMap(progressMap);
    } catch (error) {
      message.error(t('book.loadFailed'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooks();
  }, [refreshTrigger]);

  const handleDelete = async (bookId: string) => {
    try {
      await deleteBook(bookId);
      message.success(t('book.deleteSuccess'));
      await loadBooks();
    } catch (error) {
      message.error(t('book.deleteFailed'));
      console.error(error);
    }
  };

  const handleSyncToCloud = useCallback((book: Book) => {
    setSelectedBook(book);
    setSyncModalVisible(true);
  }, []);

  const handleSyncSuccess = useCallback(() => {
    if (selectedBook) {
      setSyncedBookIds(prev => new Set(prev).add(selectedBook.id));
    }
    setSyncModalVisible(false);
    setSelectedBook(null);
  }, [selectedBook]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const hasConnectors = connectors.length > 0;

  if (books.length === 0 && !loading) {
    return (
      <Empty
        description={t('book.noBooks')}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ marginTop: 80 }}
      />
    );
  }

  return (
    <>
      <List
        grid={{
          gutter: 24,
          xs: 1,
          sm: 2,
          md: 3,
          lg: 4,
          xl: 5,
        }}
        dataSource={books}
        loading={loading}
        renderItem={(book) => {
          const progress = progressMap.get(book.id);
          const progressPercent = progress?.totalProgress || 0;
          const isSynced = syncedBookIds.has(book.id);
          
          return (
            <List.Item>
              <Badge.Ribbon
                text={progressPercent > 0 ? `${Math.round(progressPercent)}%` : t('book.notRead')}
                color={progressPercent > 0 ? (progressPercent >= 100 ? 'green' : 'blue') : 'default'}
              >
                <Card
                  hoverable
                  data-gesture-clickable
                  onClick={() => navigate(`/read/${book.id}`)}
                  cover={
                    book.cover ? (
                      <div style={{ 
                        height: 280, 
                        overflow: 'hidden',
                        position: 'relative',
                      }}>
                        <img
                          alt={book.metadata.title}
                          src={book.cover}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderTopLeftRadius: 8,
                            borderTopRightRadius: 8,
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          height: 280,
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderTopLeftRadius: 8,
                          borderTopRightRadius: 8,
                        }}
                      >
                        <BookOutlined style={{ fontSize: 64, color: 'rgba(255, 255, 255, 0.8)', marginBottom: 16 }} />
                        <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14 }}>{t('book.noCover')}</span>
                      </div>
                    )
                  }
                  actions={[
                    <Button
                      key="read"
                      type="text"
                      icon={<EyeOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/read/${book.id}`);
                      }}
                    >
                      {t('book.read')}
                    </Button>,
                    hasConnectors && (
                      <Button
                        key="sync"
                        type="text"
                        icon={isSynced ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloudUploadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSyncToCloud(book);
                        }}
                        disabled={isSynced}
                      >
                        {isSynced ? t('cloudStorage.cloudBooks.syncStatus.synced') : ''}
                      </Button>
                    ),
                    <Popconfirm
                      key="delete"
                      title={t('book.deleteConfirm')}
                      description={t('book.deleteConfirmDesc')}
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(book.id);
                      }}
                      okText={t('common.delete')}
                      cancelText={t('common.cancel')}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>
                        {t('common.delete')}
                      </Button>
                    </Popconfirm>,
                  ].filter(Boolean)}
                >
                  <Card.Meta
                    title={
                      <div
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {book.metadata.title}
                        </span>
                        {isSynced && (
                          <Tag color="success" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                            <CheckCircleOutlined /> {t('cloudStorage.cloudBooks.syncStatus.synced')}
                          </Tag>
                        )}
                      </div>
                    }
                    description={
                      <div>
                        <div
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 8,
                          }}
                        >
                          {t('book.author')}：{book.metadata.author}
                        </div>
                        {progressPercent > 0 && (
                          <Progress
                            percent={Math.round(progressPercent)}
                            size="small"
                            status={progressPercent >= 100 ? 'success' : 'active'}
                          />
                        )}
                        <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                          {t('book.addedAt')} {formatDate(book.addedAt)}
                        </div>
                      </div>
                    }
                  />
                </Card>
              </Badge.Ribbon>
            </List.Item>
          );
        }}
      />

      <SyncToCloudModal
        visible={syncModalVisible}
        book={selectedBook}
        onCancel={() => {
          setSyncModalVisible(false);
          setSelectedBook(null);
        }}
        onSuccess={handleSyncSuccess}
      />
    </>
  );
};

export default BookList;