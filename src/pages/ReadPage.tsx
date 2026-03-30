import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookReader } from '../components/BookReader';
import { PdfReader } from '../components/PdfReader';
import { getBook } from '../db';
import type { Book } from '../types';
import { Spin, Result, Button } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

type BookFormat = 'epub' | 'pdf';

// 异步检测文件格式
const detectBookFormat = async (book: Book): Promise<BookFormat> => {
  // 优先使用书籍存储的格式信息
  if (book.format) {
    return book.format;
  }
  
  // 如果文件名以 .pdf 结尾，则是 PDF
  if (book.file instanceof File && book.file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  
  // 如果文件名以 .epub 结尾，则是 EPUB
  if (book.file instanceof File && book.file.name.toLowerCase().endsWith('.epub')) {
    return 'epub';
  }
  
  // 根据 MIME 类型判断
  const mimeType = book.file.type;
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  
  // 默认假设为 EPUB
  return 'epub';
};

export const ReadPage: React.FC = () => {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [bookFormat, setBookFormat] = useState<BookFormat | null>(null);
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
          
          // 检测书籍格式
          const format = await detectBookFormat(loadedBook);
          setBookFormat(format);
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

  const handleClose = useCallback(() => {
    navigate('/');
  }, [navigate]);

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

  // 根据书籍格式选择阅读器
  if (bookFormat === 'pdf') {
    return <PdfReader book={book} onClose={handleClose} />;
  }

  return <BookReader book={book} onClose={handleClose} />;
};
