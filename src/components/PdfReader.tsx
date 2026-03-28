import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layout,
  Button,
  Space,
  Typography,
  Progress,
  Slider,
  Affix,
  theme,
  message,
  Tree,
} from 'antd';
import type { TreeDataNode } from 'antd';
import {
  HomeOutlined,
  MenuUnfoldOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons';
import { VList, type VListHandle } from 'virtua';
import { pdfParser } from '../utils/pdfParser';
import { pdfPageCache } from '../utils/pdfPageCache';
import { PdfPage } from './PdfPage';
import type { ParsedPdf, PdfOutlineItem, PdfViewport } from '../types/pdf';
import type { Book } from '../types';
import { saveProgress, getProgress } from '../db';
import type { PdfReadingProgress } from '../types/pdf';

const { Content, Sider } = Layout;
const { Text, Title } = Typography;
const { useToken } = theme;

interface PdfReaderProps {
  book: Book;
  onClose: () => void;
}

interface PageInfo {
  pageNumber: number;
  viewport: PdfViewport;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;
const SCALE_STEP = 0.25;

export const PdfReader: React.FC<PdfReaderProps> = ({ book, onClose }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [pdfData, setPdfData] = useState<ParsedPdf | null>(null);
  const [loading, setLoading] = useState(true);
  const [tocVisible, setTocVisible] = useState(true);
  const [scale, setScale] = useState(1.0);
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });
  
  const listRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VListHandle>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());

  // 加载 PDF
  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        const parsed = await pdfParser.load(book.file);
        setPdfData(parsed);
        
        // 设置文档到缓存管理器
        pdfPageCache.setDocument({
          getPage: pdfParser.getPage.bind(pdfParser),
        });

        // 获取所有页面的尺寸信息
        const infos: PageInfo[] = [];
        for (let i = 1; i <= parsed.pageCount; i++) {
          const page = await pdfParser.getPage(i);
          if (page) {
            const viewport = page.getViewport({ scale: 1.0 });
            infos.push({
              pageNumber: i,
              viewport: {
                width: viewport.width,
                height: viewport.height,
                rotation: viewport.rotation,
                scale: 1.0,
              },
            });
            page.cleanup();
          }
        }
        setPageInfos(infos);

        // 加载保存的阅读进度
        const savedProgress = await getProgress(book.id);
        if (savedProgress) {
          const pdfProgress = savedProgress as unknown as PdfReadingProgress;
          if (pdfProgress.currentPage) {
            setCurrentPage(pdfProgress.currentPage);
            setScale(pdfProgress.scale || 1.0);
          }
        }
      } catch (error) {
        message.error(t('book.loadBookFailed'));
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      // 清理资源
      pdfPageCache.clearCache();
      pdfParser.destroy();
    };
  }, [book.id, book.file, t]);

  // 保存阅读进度
  const saveReadingProgress = useCallback(async () => {
    const progressData: PdfReadingProgress = {
      bookId: book.id,
      currentPage: currentPage,
      currentPosition: scrollPosition.y,
      lastReadAt: new Date(),
      totalProgress: pdfData ? (currentPage / pdfData.pageCount) * 100 : 0,
      scale,
    };

    await saveProgress(progressData as unknown as import('../types').ReadingProgress);
  }, [book.id, currentPage, scrollPosition.y, pdfData, scale]);

  useEffect(() => {
    if (!loading && pdfData) {
      saveReadingProgress();
    }
  }, [currentPage, scale, loading, pdfData, saveReadingProgress]);

  // 计算页面高度（根据缩放比例）
  const getPageHeight = useCallback((pageInfo: PageInfo) => {
    return (pageInfo.viewport.height * scale) + 16; // 16px margin
  }, [scale]);

  // 获取当前可见页面
  const handleScroll = useCallback((offset: number) => {
    if (!vlistRef.current || pageInfos.length === 0) return;
    
    // 找到当前页面索引
    const index = vlistRef.current.findItemIndex(offset);
    if (index >= 0 && index < pageInfos.length) {
      setCurrentPage(pageInfos[index].pageNumber);
      
      // 更新可见页面集合
      visiblePagesRef.current.clear();
      for (let i = index; i < Math.min(index + 3, pageInfos.length); i++) {
        visiblePagesRef.current.add(pageInfos[i].pageNumber);
      }
    }
  }, [pageInfos]);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  }, []);

  // 拖拽支持
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键
    setIsDragging(true);
    setDragStart({ x: e.clientX - scrollPosition.x, y: e.clientY - scrollPosition.y });
  }, [scrollPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setScrollPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        await contentRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, [isFullscreen]);

  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 跳转到指定页面
  const goToPage = useCallback((pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= (pdfData?.pageCount || 0)) {
      const index = pageInfos.findIndex(p => p.pageNumber === pageNumber);
      if (index >= 0 && vlistRef.current) {
        vlistRef.current.scrollToIndex(index);
        setCurrentPage(pageNumber);
      }
    }
  }, [pdfData?.pageCount, pageInfos]);

  // 将 PDF outline 转换为 Tree 数据
  const outlineToTreeData = useCallback((items: PdfOutlineItem[]): TreeDataNode[] => {
    return items.map((item) => ({
      key: `page-${item.pageNumber}`,
      title: item.title,
      isLeaf: item.items.length === 0,
      children: item.items.length > 0 ? outlineToTreeData(item.items) : undefined,
    }));
  }, []);

  // 处理 Tree 选择
  const handleTreeSelect = useCallback((selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string;
      const pageNumber = parseInt(key.replace('page-', ''), 10);
      if (!isNaN(pageNumber)) {
        goToPage(pageNumber);
      }
    }
  }, [goToPage]);

  // 计算总进度
  const totalProgress = useMemo(() => {
    if (!pdfData) return 0;
    return Math.round((currentPage / pdfData.pageCount) * 100);
  }, [currentPage, pdfData]);

  // 渲染单个页面
  const renderPageItem = useCallback((pageInfo: PageInfo) => {
    const height = getPageHeight(pageInfo);
    const width = pageInfo.viewport.width * scale;

    return (
      <PdfPage
        key={pageInfo.pageNumber}
        pageNumber={pageInfo.pageNumber}
        scale={scale}
        width={width}
        height={height - 16} // 减去 margin
        pdfDocument={{ getPage: pdfParser.getPage.bind(pdfParser) }}
        isVisible={visiblePagesRef.current.has(pageInfo.pageNumber)}
        onRenderComplete={() => console.log(`Page ${pageInfo.pageNumber} rendered`)}
        onRenderError={(error) => console.error(`Page ${pageInfo.pageNumber} error:`, error)}
      />
    );
  }, [scale, getPageHeight]);

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <Affix>
        <div
          style={{
            padding: '0 24px',
            height: 56,
            backgroundColor: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 100,
          }}
        >
          <Button 
            type="text" 
            icon={<HomeOutlined />} 
            onClick={onClose}
            style={{ marginLeft: -8 }}
          >
            {t('nav.backToBookshelf')}
          </Button>

          <Text strong style={{ 
            flex: 1, 
            textAlign: 'center', 
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 16px',
          }}>
            {book.metadata.title}
          </Text>

          <Space size={16}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {currentPage} / {pdfData?.pageCount || 0}
            </Text>
            <Progress
              percent={totalProgress}
              size="small"
              style={{ width: 60 }}
              showInfo={false}
            />
            <Button
              icon={<ZoomOutOutlined />}
              onClick={handleZoomOut}
              disabled={scale <= MIN_SCALE}
            />
            <Text style={{ minWidth: 50, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </Text>
            <Button
              icon={<ZoomInOutlined />}
              onClick={handleZoomIn}
              disabled={scale >= MAX_SCALE}
            />
            <Button
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
            />
          </Space>
        </div>
      </Affix>

      <Layout style={{ height: 'calc(100vh - 56px)' }}>
        {/* 目录侧边栏 */}
        {tocVisible && (
          <Sider
            width={300}
            style={{
              backgroundColor: token.colorBgContainer,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              overflow: 'auto',
              padding: '16px 0',
            }}
          >
            <div style={{ marginBottom: 16, padding: '0 16px' }}>
              <Title level={5} style={{ margin: 0 }}>{t('reader.toc')}</Title>
            </div>
            
            {(pdfData?.outline?.length || 0) > 0 ? (
              <div style={{ padding: '0 8px' }}>
                <Tree
                  treeData={outlineToTreeData(pdfData?.outline || [])}
                  onSelect={handleTreeSelect}
                  selectedKeys={[`page-${currentPage}`]}
                  defaultExpandAll
                  style={{ backgroundColor: 'transparent' }}
                />
              </div>
            ) : (
              <div style={{ padding: '0 16px', color: token.colorTextSecondary }}>
                {t('reader.noToc')}
              </div>
            )}
          </Sider>
        )}
        
        {!tocVisible && (
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={() => setTocVisible(true)}
            style={{
              position: 'absolute',
              left: 8,
              top: 64,
              zIndex: 101,
            }}
          />
        )}

        {/* 内容区域 */}
        <Content
          ref={contentRef}
          style={{
            overflow: 'hidden',
            backgroundColor: token.colorFillTertiary,
            position: 'relative',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loading ? (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%' 
            }}>
              {t('common.loading')}
            </div>
          ) : (
            <div
              ref={listRef}
              style={{
                height: '100%',
                overflow: 'auto',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            >
              <VList
                ref={vlistRef}
                data={pageInfos}
                onScroll={handleScroll}
                style={{
                  padding: '24px 0',
                }}
              >
                {renderPageItem}
              </VList>
            </div>
          )}
          
          {/* 页面跳转滑块 */}
          {!loading && pdfData && (
            <div
              style={{
                position: 'absolute',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: token.colorBgContainer,
                padding: '8px 16px',
                borderRadius: token.borderRadius,
                boxShadow: token.boxShadow,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                zIndex: 100,
              }}
            >
              <Text type="secondary">{t('reader.page')}</Text>
              <Slider
                min={1}
                max={pdfData.pageCount}
                value={currentPage}
                onChange={(value) => goToPage(value)}
                style={{ width: 200 }}
              />
              <Text>{currentPage} / {pdfData.pageCount}</Text>
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};
