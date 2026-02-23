import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookReader } from '../components/BookReader';
import { getBook } from '../db';
import type { Book } from '../types';
import { Spin, Result, Button } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

export const ReadPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBook = async () => {
      if (!bookId) {
        setError('书籍ID不能为空');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const loadedBook = await getBook(bookId);
        if (loadedBook) {
          setBook(loadedBook);
        } else {
          setError('书籍不存在');
        }
      } catch (err) {
        setError('加载书籍失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadBook();
  }, [bookId]);

  const handleClose = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <Result
        status="404"
        title="书籍未找到"
        subTitle={error}
        extra={
          <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
            返回书架
          </Button>
        }
      />
    );
  }

  if (!book) {
    return (
      <Result
        status="404"
        title="书籍不存在"
        extra={
          <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
            返回书架
          </Button>
        }
      />
    );
  }

  return <BookReader book={book} onClose={handleClose} />;
};
