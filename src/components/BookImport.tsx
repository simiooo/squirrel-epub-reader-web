import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Button, message, Modal, Typography, theme } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { epubParser } from '../utils/epubParser';
import { pdfParser } from '../utils/pdfParser';
import { addBook, findBookByChecksum } from '../db';
import { generateChecksum } from '../utils/bookHash';
import type { Book, BookMetadata } from '../types';

type BookFormat = 'epub' | 'pdf';

interface PreviewBook {
  title: string;
  author: string;
  cover?: string;
  file: File;
  format: BookFormat;
}

const { Text, Title } = Typography;
const { useToken } = theme;

interface BookImportProps {
  onImport: () => void;
}

export const BookImport: React.FC<BookImportProps> = ({ onImport }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewBook, setPreviewBook] = useState<PreviewBook | null>(null);

  const getFileFormat = (file: File): BookFormat | null => {
    const isEpub = file.type === 'application/epub+zip' || file.name.endsWith('.epub');
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    
    if (isEpub) return 'epub';
    if (isPdf) return 'pdf';
    return null;
  };

  const handleBeforeUpload = useCallback((file: File) => {
    const format = getFileFormat(file);
    
    if (!format) {
      message.error(t('book.selectValidFile'));
      return Upload.LIST_IGNORE;
    }
    
    // Validate file format
    const validateAndParse = async () => {
      try {
        let valid = false;
        let error: string | undefined;
        
        if (format === 'epub') {
          const result = await epubParser.validate(file);
          valid = result.valid;
          error = result.error;
        } else {
          const result = await pdfParser.validate(file);
          valid = result.valid;
          error = result.error;
        }
        
        if (!valid) {
          message.error(error || t('book.invalidFile'));
          setFileList([]);
          return;
        }
        
        // Parse metadata for preview
        let title = '';
        let author = 'Unknown Author';
        let cover: string | undefined;
        
        if (format === 'epub') {
          const parsed = await epubParser.load(file);
          title = parsed.metadata.title;
          author = parsed.metadata.author;
          cover = parsed.cover;
        } else {
          const parsed = await pdfParser.load(file);
          title = parsed.metadata.title;
          author = parsed.metadata.author;
          cover = parsed.cover;
        }
        
        // If title is empty, use filename without extension
        if (!title || title.trim() === '') {
          title = file.name.replace(/\.[^/.]+$/, '');
        }
        
        setPreviewBook({
          title,
          author,
          cover,
          file,
          format,
        });
        setPreviewVisible(true);
      } catch (err) {
        message.error(`${t('book.parseFailed')}: ${err instanceof Error ? err.message : String(err)}`);
        setFileList([]);
      }
    };
    
    validateAndParse();
    return false;
  }, [t]);

  const handleImport = useCallback(async () => {
    if (!previewBook) return;
    
    setUploading(true);
    try {
      // 生成文件 checksum
      const checksum = await generateChecksum(previewBook.file);
      
      // 检查是否已存在相同书籍
      const existingBook = await findBookByChecksum(checksum);
      if (existingBook) {
        message.warning(`书籍 "${existingBook.metadata.title}" 已经存在于本地书架中`);
        setPreviewVisible(false);
        setPreviewBook(null);
        setFileList([]);
        return;
      }
      
      let metadata: BookMetadata;
      let cover: string | undefined;
      
      if (previewBook.format === 'epub') {
        const parsed = await epubParser.load(previewBook.file);
        metadata = {
          ...parsed.metadata,
          title: parsed.metadata.title || previewBook.file.name.replace(/\.[^/.]+$/, ''),
        };
        cover = parsed.cover;
      } else {
        const parsed = await pdfParser.load(previewBook.file);
        metadata = {
          title: parsed.metadata.title || previewBook.file.name.replace(/\.[^/.]+$/, ''),
          author: parsed.metadata.author,
          description: parsed.metadata.subject,
          publisher: parsed.metadata.creator,
          publicationDate: parsed.metadata.creationDate?.toISOString(),
          identifier: parsed.metadata.keywords,
        };
        cover = parsed.cover;
      }
      
      const book: Book = {
        id: crypto.randomUUID(),
        metadata,
        cover,
        file: previewBook.file,
        format: previewBook.format,
        checksum,
        addedAt: new Date(),
        updatedAt: new Date(),
      };
      
      await addBook(book);
      message.success(t('book.importSuccess'));
      setPreviewVisible(false);
      setPreviewBook(null);
      setFileList([]);
      onImport();
    } catch (error) {
      message.error(`${t('book.importFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploading(false);
    }
  }, [previewBook, onImport, t]);

  return (
    <>
      <Upload
        fileList={fileList}
        onChange={({ fileList: newFileList }) => setFileList(newFileList)}
        beforeUpload={handleBeforeUpload}
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        maxCount={1}
        showUploadList={false}
      >
        <Button icon={<UploadOutlined />} type="primary">
          {t('book.import')}
        </Button>
      </Upload>

      <Modal
        title={t('book.importLocalOnly')}
        open={previewVisible}
        onOk={handleImport}
        onCancel={() => {
          setPreviewVisible(false);
          setPreviewBook(null);
          setFileList([]);
        }}
        confirmLoading={uploading}
        okText={t('book.importToLocal')}
        cancelText={t('common.cancel')}
        styles={{ body: { padding: '24px 0' } }}
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
                  marginBottom: 20,
                  borderRadius: 8,
                  boxShadow: token.boxShadowSecondary,
                }}
              />
            ) : (
              <div
                style={{
                  width: 200,
                  height: 300,
                  background: `linear-gradient(145deg, ${token.colorPrimary} 0%, ${token.colorPrimary}80 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.7)' }}>{t('book.noCover')}</Text>
              </div>
            )}
            <Title level={4} style={{ margin: '0 0 8px' }}>{previewBook.title}</Title>
            <Text type="secondary">{t('book.author')}：{previewBook.author}</Text>
            <div style={{ 
              marginTop: 20, 
              padding: '12px 16px', 
              backgroundColor: token.colorFillAlter, 
              borderRadius: token.borderRadius,
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
            }}>
              {t('book.localOnlyTip')}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
