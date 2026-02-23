import React, { useState, useCallback } from 'react';
import { Upload, Button, message, Modal } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { epubParser } from '../utils/epubParser';
import { addBook } from '../db';
import type { Book } from '../types';

interface BookImportProps {
  onImport: () => void;
}

export const BookImport: React.FC<BookImportProps> = ({ onImport }) => {
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewBook, setPreviewBook] = useState<{
    title: string;
    author: string;
    cover?: string;
    file: File;
  } | null>(null);

  const handleBeforeUpload = useCallback((file: File) => {
    const isEpub = file.type === 'application/epub+zip' || file.name.endsWith('.epub');
    if (!isEpub) {
      message.error('请选择EPUB格式的文件！');
      return Upload.LIST_IGNORE;
    }
    
    // Validate EPUB format
    epubParser.validate(file).then(({ valid, error }) => {
      if (!valid) {
        message.error(error || '无效的EPUB文件');
        setFileList([]);
      } else {
        // Parse metadata for preview
        epubParser.load(file).then((parsed) => {
          setPreviewBook({
            title: parsed.metadata.title,
            author: parsed.metadata.author,
            cover: parsed.cover,
            file,
          });
          setPreviewVisible(true);
        }).catch((err) => {
          message.error(`解析失败：${err.message}`);
          setFileList([]);
        });
      }
    });
    
    return false;
  }, []);

  const handleImport = useCallback(async () => {
    if (!previewBook) return;
    
    setUploading(true);
    try {
      const parsed = await epubParser.load(previewBook.file);
      
      const book: Book = {
        id: crypto.randomUUID(),
        metadata: parsed.metadata,
        cover: parsed.cover,
        file: previewBook.file,
        addedAt: new Date(),
        updatedAt: new Date(),
      };
      
      await addBook(book);
      message.success('书籍导入成功！');
      setPreviewVisible(false);
      setPreviewBook(null);
      setFileList([]);
      onImport();
    } catch (error) {
      message.error(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploading(false);
    }
  }, [previewBook, onImport]);

  return (
    <>
      <Upload
        fileList={fileList}
        onChange={({ fileList: newFileList }) => setFileList(newFileList)}
        beforeUpload={handleBeforeUpload}
        accept=".epub,application/epub+zip"
        maxCount={1}
        showUploadList={false}
      >
        <Button icon={<UploadOutlined />} type="primary">
          导入书籍
        </Button>
      </Upload>

      <Modal
        title="确认导入"
        open={previewVisible}
        onOk={handleImport}
        onCancel={() => {
          setPreviewVisible(false);
          setPreviewBook(null);
          setFileList([]);
        }}
        confirmLoading={uploading}
        okText="确认导入"
        cancelText="取消"
      >
        {previewBook && (
          <div style={{ textAlign: 'center' }}>
            {previewBook.cover ? (
              <img
                src={previewBook.cover}
                alt="封面"
                style={{
                  maxWidth: 200,
                  maxHeight: 300,
                  objectFit: 'contain',
                  marginBottom: 16,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 200,
                  height: 300,
                  backgroundColor: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  borderRadius: 4,
                }}
              >
                暂无封面
              </div>
            )}
            <h3 style={{ margin: '16px 0 8px' }}>{previewBook.title}</h3>
            <p style={{ color: '#666', margin: 0 }}>作者：{previewBook.author}</p>
          </div>
        )}
      </Modal>
    </>
  );
};
