import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  List,
  Button,
  Empty,
  message,
  Popconfirm,
  Tag,
  Progress,
  theme,
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
  onSyncSuccess?: () => void;
}

export const BookList: React.FC<BookListProps> = ({ refreshTrigger, onSyncSuccess }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
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
    onSyncSuccess?.();
  }, [selectedBook, onSyncSuccess]);

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
          gutter: 16,
          xs: 2,
          sm: 3,
          md: 4,
          lg: 5,
          xl: 6,
          xxl: 8,
        }}
        dataSource={books}
        loading={loading}
        renderItem={(book) => {
          const progress = progressMap.get(book.id);
          const progressPercent = progress?.totalProgress || 0;
          const isSynced = syncedBookIds.has(book.id);
          
          return (
            <List.Item>
              <div className="book-card book-card-compact">
                {/* 封面区域 */}
                {book.cover ? (
                  <div className="book-card-cover" onClick={() => navigate(`/read/${book.id}`)}>
                    <img alt={book.metadata.title} src={book.cover} />
                    
                    {/* 进度条 - 顶部 */}
                    {progressPercent > 0 && (
                      <div className="book-card-progress">
                        <Progress
                          percent={Math.round(progressPercent)}
                          size="small"
                          showInfo={false}
                          status={progressPercent >= 100 ? 'success' : 'active'}
                        />
                      </div>
                    )}
                    
                    {/* 已同步标签 */}
                    {isSynced && (
                      <div className="book-card-status">
                        <Tag color="success"><CheckCircleOutlined /></Tag>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="book-card-no-cover" onClick={() => navigate(`/read/${book.id}`)}>
                    <BookOutlined />
                    <span>{t('book.noCover')}</span>
                    
                    {/* 进度条 - 顶部 */}
                    {progressPercent > 0 && (
                      <div className="book-card-progress">
                        <Progress
                          percent={Math.round(progressPercent)}
                          size="small"
                          showInfo={false}
                          status={progressPercent >= 100 ? 'success' : 'active'}
                        />
                      </div>
                    )}
                    
                    {/* 已同步标签 */}
                    {isSynced && (
                      <div className="book-card-status">
                        <Tag color="success"><CheckCircleOutlined /></Tag>
                      </div>
                    )}
                  </div>
                )}
                
                {/* 悬浮信息层 */}
                <div className="book-card-overlay">
                  <div className="book-card-info">
                    <div className="book-card-title">{book.metadata.title}</div>
                    <div className="book-card-author">{book.metadata.author}</div>
                    <div className="book-card-meta">
                      <span>{formatDate(book.addedAt)}</span>
                      {progressPercent > 0 && (
                        <>
                          <span>·</span>
                          <span>{Math.round(progressPercent)}%</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* 操作按钮 - 悬浮时显示 */}
                  <div className="book-card-actions">
                    <Button
                      type="primary"
                      size="small"
                      icon={<EyeOutlined />}
                      data-gesture-clickable="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/read/${book.id}`);
                      }}
                    >
                      {t('book.read')}
                    </Button>
                    
                    {hasConnectors && (
                      <Button
                        type="primary"
                        size="small"
                        icon={isSynced ? <CheckCircleOutlined /> : <CloudUploadOutlined />}
                        data-gesture-clickable="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isSynced) {
                            handleSyncToCloud(book);
                          }
                        }}
                        disabled={isSynced}
                        style={isSynced ? { background: `${token.colorSuccess}b3` } : undefined}
                      >
                        {isSynced ? t('cloudStorage.cloudBooks.syncStatus.synced') : t('cloudStorage.sync')}
                      </Button>
                    )}
                    
                    <Popconfirm
                      title={t('book.deleteConfirm')}
                      description={t('book.deleteConfirmDesc')}
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(book.id);
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
                  </div>
                </div>
              </div>
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
