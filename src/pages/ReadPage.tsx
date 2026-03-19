import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookReader } from '../components/BookReader';
import { getBook } from '../db';
import type { Book } from '../types';
import { Spin, Result, Button } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

export const ReadPage: React.FC = () => {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBook = async () => {
      if (!bookId) {
        setError(t('book.bookNotFound'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const loadedBook = await getBook(bookId);
        if (loadedBook) {
          setBook(loadedBook);
          document.title = loadedBook.metadata.title;
        } else {
          setError(t('book.bookNotExist'));
        }
      } catch (err) {
        setError(t('book.loadBookFailed'));
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadBook();

    return () => {
      document.title = '松鼠EPUB阅读器';
    };
  }, [bookId, t]);

  const handleClose = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip={t('common.loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <Result
        status="404"
        title={t('book.bookNotFound')}
        subTitle={error}
        extra={
          <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
            {t('nav.backToBookshelf')}
          </Button>
        }
      />
    );
  }

  if (!book) {
    return (
      <Result
        status="404"
        title={t('book.bookNotExist')}
        extra={
          <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
            {t('nav.backToBookshelf')}
          </Button>
        }
      />
    );
  }

  return <BookReader book={book} onClose={handleClose} />;
};
