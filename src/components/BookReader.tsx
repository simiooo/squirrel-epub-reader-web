import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layout,
  Button,
  Space,
  Typography,
  Divider,
  message,
  Affix,
  Progress,
  Skeleton,
  Card,
  theme,
} from 'antd';
import {
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  LeftOutlined,
  RightOutlined,
  HomeOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { TableOfContents } from './TableOfContents';
import { GestureIndicator } from './gesture/GestureIndicator';
import { GestureOverlay } from './gesture/GestureOverlay';
import { useGestureSettings } from '../contexts/useGestureHooks';
import { epubParser } from '../utils/epubParser';
import { createImageManager, ImageResourceManager } from '../utils/imageManager';
import { saveProgress, getProgress } from '../db';
import type { Book, ParsedChapter, ReadingProgress, Chapter } from '../types';

// Utility function to check if URL is external
const isExternalUrl = (href: string): boolean => {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^ftp:/i.test(href);
};

const { Content, Sider } = Layout;
const { Title, Text } = Typography;
const { useToken } = theme;

interface BookReaderProps {
  book: Book;
  onClose: () => void;
}

export const BookReader: React.FC<BookReaderProps> = ({ book, onClose }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { settings, updateSettings } = useGestureSettings();
  const [chapters, setChapters] = useState<ParsedChapter[]>([]);
  const [tableOfContents, setTableOfContents] = useState<Chapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [imageManager, setImageManager] = useState<ImageResourceManager>()
  const [tocVisible, setTocVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const chapterContentRef = useRef<HTMLDivElement>(null);
  const [, _setProgress] = useState<ReadingProgress | null>(null);
  const [tocToChapterMap, setTocToChapterMap] = useState<Map<string, number>>(new Map());

  // Build mapping from TOC chapter IDs to chapter indices
  const buildTocToChapterMap = useCallback((toc: Chapter[], chapters: ParsedChapter[]): Map<string, number> => {
    const mapping = new Map<string, number>();
    
    const findChapterIndex = (chapterId: string, href: string): number => {
      // Try to match by ID first
      let index = chapters.findIndex(ch => ch.id === chapterId);
      if (index >= 0) return index;
      
      // Try to match by href (file name)
      index = chapters.findIndex(ch => {
        const hrefFile = href.split('#')[0];
        const chHrefFile = ch.href.split('#')[0];
        return hrefFile === chHrefFile || ch.href.includes(hrefFile);
      });
      if (index >= 0) return index;
      
      // Try partial match
      index = chapters.findIndex(ch => 
        ch.href.includes(chapterId) || chapterId.includes(ch.href.split('/').pop() || '')
      );
      
      return index;
    };

    const processChapter = (chapter: Chapter) => {
      const index = findChapterIndex(chapter.id, chapter.href);
      if (index >= 0) {
        mapping.set(chapter.id, index);
      }
      
      if (chapter.children) {
        chapter.children.forEach(processChapter);
      }
    };

    toc.forEach(processChapter);
    
    // Also map spine items that aren't in TOC
    chapters.forEach((ch, index) => {
      if (!mapping.has(ch.id)) {
        mapping.set(ch.id, index);
      }
    });
    
    return mapping;
  }, []);

  // Load book content
  useEffect(() => {
    const loadBook = async () => {
      try {
        setLoading(true);
        const parsed = await epubParser.load(book.file);
        setChapters(parsed.chapters);
        setTableOfContents(parsed.tableOfContents);

        // Initialize image manager for this book (reuse if exists)
        // Set maxCacheSize to 1000 to handle books with many images
        const imageManager = createImageManager(book.id, { maxCacheSize: 1000 });
        
        // Register all extracted images
        parsed.images.forEach((img) => {
          
          imageManager.registerImage(img.id, img.path, img.blob);
        });
        setImageManager(imageManager)
        // Build mapping from TOC to chapter index
        const mapping = buildTocToChapterMap(parsed.tableOfContents, parsed.chapters);
        setTocToChapterMap(mapping);

        // Load saved progress
        const savedProgress = await getProgress(book.id);
        if (savedProgress && savedProgress.currentChapter) {
          const chapterIndex = parsed.chapters.findIndex(
            (ch) => ch.id === savedProgress.currentChapter
          );
          if (chapterIndex >= 0) {
            setCurrentChapterIndex(chapterIndex);
          }
        }
      } catch (error) {
        message.error(t('book.loadBookFailed'));
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadBook();

    // Cleanup image manager only when unmounting (not when changing chapters)
    return () => {
      imageManager?.dispose()
      setImageManager(undefined)
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]); // Only depend on book.id, not the entire book object

  // Save progress when chapter changes
  const saveReadingProgress = useCallback(async () => {
    if (chapters.length === 0) return;

    const currentChapter = chapters[currentChapterIndex];
    const totalProgress = ((currentChapterIndex + 1) / chapters.length) * 100;

    const progressData: ReadingProgress = {
      bookId: book.id,
      currentChapter: currentChapter.id,
      currentPosition: contentRef.current?.scrollTop || 0,
      lastReadAt: new Date(),
      totalProgress: Math.min(totalProgress, 100),
    };

    await saveProgress(progressData);
    _setProgress(progressData);
  }, [book.id, chapters, currentChapterIndex]);

  useEffect(() => {
    if (chapters.length > 0) {
      saveReadingProgress();
    }
  }, [currentChapterIndex, chapters.length, saveReadingProgress]);

  // Handle chapter navigation
  const goToChapter = (index: number) => {
    if (index >= 0 && index < chapters.length) {
      setCurrentChapterIndex(index);
      // Scroll to top of content
      if (contentRef.current) {
        contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleTocSelect = (chapterId: string, anchor?: string) => {
    const index = tocToChapterMap.get(chapterId);
    if (index !== undefined && index >= 0) {
      // Navigate to target chapter
      setCurrentChapterIndex(index);

      // If there's an anchor, scroll to it after chapter loads
      if (anchor) {
        setTimeout(() => {
          const element = chapterContentRef.current?.querySelector(`[id="${anchor}"], [name="${anchor}"]`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            // Scroll to top if anchor not found
            if (contentRef.current) {
              contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }, 150);
      } else {
        // Scroll to top of content
        if (contentRef.current) {
          contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } else {
      // Fallback: try to find directly in chapters
      const fallbackIndex = chapters.findIndex(ch => ch.id === chapterId);
      if (fallbackIndex >= 0) {
        setCurrentChapterIndex(fallbackIndex);
        if (contentRef.current) {
          contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  };

  const goToPrevious = () => {
    goToChapter(currentChapterIndex - 1);
  };

  const goToNext = () => {
    goToChapter(currentChapterIndex + 1);
  };

  // Get current chapter
  const currentChapter = useMemo(() => {
    const chapter = chapters[currentChapterIndex];
    if (!chapter || !imageManager) return chapter;

    // Parse HTML and replace img src with object URLs
    const parser = new DOMParser();
    const doc = parser.parseFromString(chapter.content, 'text/html');
    const images = doc.querySelectorAll('img');

    images.forEach((img) => {
      const imageId = img.dataset["epubImage"];
      
      if (imageId) {
        // Get the image ID from the src (EPUB images are referenced by relative path)
        // The image ID might be the full path or just the filename
        const imageUrl = imageManager.getImageUrl(imageId);
        if (imageUrl) {
          img.setAttribute('src', imageUrl);
        }
      }
    });

    // Return chapter with processed content
    return {
      ...chapter,
      content: doc.body.innerHTML,
    };
  }, [chapters, currentChapterIndex, imageManager]);


  
  // Find current TOC chapter ID for highlighting
  const findCurrentTocId = (): string | undefined => {
    if (!currentChapter) return undefined;
    
    // Find TOC ID that maps to current chapter index
    for (const [tocId, index] of tocToChapterMap) {
      if (index === currentChapterIndex) {
        return tocId;
      }
    }
    
    return currentChapter.id;
  };

  const currentTocId = findCurrentTocId();

  // Handle link clicks within chapter content
  const handleContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    
    if (!anchor) return;
    
    const href = anchor.getAttribute('href');
    if (!href) return;
    
    // Handle external links
    if (isExternalUrl(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    
    // Handle internal EPUB links
    event.preventDefault();
    
    // Parse href: could be "#anchor", "file.xhtml", or "file.xhtml#anchor"
    const [filePart, anchorPart] = href.split('#');
    const targetFile = filePart || '';
    const targetAnchor = anchorPart || '';
    
    // Find target chapter
    let targetChapterIndex = -1;
    
    if (!targetFile) {
      // Only anchor - stay on current chapter
      targetChapterIndex = currentChapterIndex;
    } else {
      // Find chapter by file name
      targetChapterIndex = chapters.findIndex(ch => {
        const chFile = ch.href.split('#')[0];
        return chFile === targetFile || 
               ch.href.includes(targetFile) || 
               targetFile.includes(chFile.split('/').pop() || '');
      });
    }
    
    if (targetChapterIndex >= 0) {
      // Navigate to target chapter
      setCurrentChapterIndex(targetChapterIndex);
      
      // If there's an anchor, scroll to it after chapter loads
      if (targetAnchor) {
        setTimeout(() => {
          const element = chapterContentRef.current?.querySelector(`#${targetAnchor}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      } else {
        // Scroll to top of content
        if (contentRef.current) {
          contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } else {
      message.warning(t('reader.chapterNotFound'));
    }
  }, [chapters, currentChapterIndex, t]);

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <GestureOverlay />
      {/* Header */}
      <Affix>
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 100,
          }}
        >
          <Space>
            <Button icon={<HomeOutlined />} onClick={onClose}>
              {t('nav.backToBookshelf')}
            </Button>
            <Button
              icon={tocVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setTocVisible(!tocVisible)}
            >
              {tocVisible ? t('reader.hideToc') : t('reader.showToc')}
            </Button>
          </Space>

          <div style={{ flex: 1, textAlign: 'center', padding: '0 24px' }}>
            <Title level={5} style={{ margin: 0 }}>
              {book.metadata.title}
            </Title>
            {currentChapter && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {currentChapter.title}
              </Text>
            )}
          </div>

          <Space>
            <GestureIndicator onClick={() => {
              updateSettings({ enabled: !settings.enabled });
            }} />
            {chapters.length > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentChapterIndex + 1} / {chapters.length}
                </Text>
                <Progress
                  percent={Math.round(((currentChapterIndex + 1) / chapters.length) * 100)}
                  size="small"
                  style={{ width: 80 }}
                  showInfo={false}
                />
              </>
            )}
          </Space>
        </div>
      </Affix>

      <Layout style={{ height: 'calc(100vh - 57px)' }}>
        {/* Table of Contents Sidebar */}
        {tocVisible && (
          <Sider
            width={300}
            style={{
              backgroundColor: token.colorBgContainer,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              overflow: 'auto',
            }}
          >
            <div style={{ padding: 16 }}>
              <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
                <BookOutlined style={{ marginRight: 8 }} />
                {t('reader.tableOfContents')}
              </Title>
              <TableOfContents
                chapters={tableOfContents}
                currentChapterId={currentTocId}
                onSelect={handleTocSelect}
              />
            </div>
          </Sider>
        )}

        {/* Content Area */}
        <Content
          style={{
            overflow: 'auto',
            backgroundColor: token.colorBgContainer,
          }}
        >
          {loading ? (
            <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
              <Skeleton active paragraph={{ rows: 10 }} />
            </div>
          ) : currentChapter ? (
            <div
              ref={contentRef}
              style={{
                maxWidth: 800,
                margin: '0 auto',
                padding: '40px 24px',
              }}
            >
              {/* Chapter Title */}
              <Title
                level={2}
                style={{
                  textAlign: 'center',
                  marginBottom: token.marginXL,
                  color: token.colorTextHeading,
                }}
              >
                {currentChapter.title}
              </Title>

              <Divider />

              {/* Chapter Content - Styled with Ant Design Typography */}
              <div
                ref={chapterContentRef}
                className="chapter-content"
                dangerouslySetInnerHTML={{ __html: currentChapter?.content || '' }}
                onClick={handleContentClick}
                style={{
                  fontSize: token.fontSizeLG,
                  lineHeight: token.lineHeightLG,
                  color: token.colorText,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  MozUserSelect: 'text',
                  msUserSelect: 'text',
                  // Ant Design CSS Variables for EPUB content
                  '--antd-color-text': token.colorText,
                  '--antd-color-text-secondary': token.colorTextSecondary,
                  '--antd-color-text-heading': token.colorTextHeading,
                  '--antd-color-border': token.colorBorder,
                  '--antd-color-border-secondary': token.colorBorderSecondary,
                  '--antd-color-bg-container': token.colorBgContainer,
                  '--antd-color-bg-elevated': token.colorBgElevated,
                  '--antd-color-fill': token.colorFill,
                  '--antd-color-fill-secondary': token.colorFillSecondary,
                  '--antd-color-fill-alter': token.colorFillAlter,
                  '--antd-color-primary': token.colorPrimary,
                  '--antd-border-radius': `${token.borderRadius}px`,
                  '--antd-border-radius-lg': `${token.borderRadiusLG}px`,
                  '--antd-border-radius-sm': `${token.borderRadiusSM}px`,
                  '--antd-font-family': token.fontFamily,
                  '--antd-font-family-code': token.fontFamilyCode,
                  '--antd-font-size': `${token.fontSize}px`,
                  '--antd-font-size-lg': `${token.fontSizeLG}px`,
                  '--antd-font-size-sm': `${token.fontSizeSM}px`,
                  '--antd-line-height': token.lineHeight,
                  '--antd-line-height-lg': token.lineHeightLG,
                  '--antd-line-height-sm': token.lineHeightSM,
                  '--antd-margin-xs': `${token.marginXS}px`,
                  '--antd-margin-sm': `${token.marginSM}px`,
                  '--antd-margin': `${token.margin}px`,
                  '--antd-margin-md': `${token.marginMD}px`,
                  '--antd-margin-lg': `${token.marginLG}px`,
                  '--antd-margin-xl': `${token.marginXL}px`,
                  '--antd-padding-xs': `${token.paddingXS}px`,
                  '--antd-padding-sm': `${token.paddingSM}px`,
                  '--antd-padding': `${token.padding}px`,
                  '--antd-padding-md': `${token.paddingMD}px`,
                  '--antd-padding-lg': `${token.paddingLG}px`,
                  '--antd-padding-xl': `${token.paddingXL}px`,
                } as React.CSSProperties}
              />

              {/* Navigation Footer */}
              <Divider style={{ marginTop: token.marginXL * 2, marginBottom: token.marginLG }}>
                <Text type="secondary">
                  {t('reader.chapterProgress', { current: currentChapterIndex + 1, total: chapters.length })}
                </Text>
              </Divider>

              <Card
                style={{
                  marginBottom: token.marginXL,
                  backgroundColor: token.colorFillAlter,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Button
                    icon={<LeftOutlined />}
                    onClick={goToPrevious}
                    disabled={currentChapterIndex === 0}
                    size="large"
                  >
                    {t('reader.previous')}
                  </Button>

                  <Space direction="vertical" align="center" size={4}>
                    <Text type="secondary">
                      {t('reader.readProgress', { progress: Math.round(((currentChapterIndex + 1) / chapters.length) * 100) })}
                    </Text>
                    <Progress
                      percent={Math.round(((currentChapterIndex + 1) / chapters.length) * 100)}
                      size="small"
                      style={{ width: 120 }}
                      status={currentChapterIndex === chapters.length - 1 ? 'success' : 'active'}
                    />
                  </Space>

                  <Button
                    icon={<RightOutlined />}
                    onClick={goToNext}
                    disabled={currentChapterIndex === chapters.length - 1}
                    size="large"
                  >
                    {t('reader.next')}
                  </Button>
                </div>
              </Card>
            </div>
          ) : (
            <div style={{ textAlign: 'center', paddingTop: 100 }}>
              {t('reader.noContent')}
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};
