import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
// 引入 pdf.js 的 CSS 样式（用于文本层正确渲染）
import 'pdfjs-dist/web/pdf_viewer.css';

interface PdfPageProps {
  pageNumber: number;
  width: number;
  height: number;
  pdfDocument: { getPage: (pageNumber: number) => Promise<PDFPageProxy | null> } | null;
  isVisible: boolean;
  onRenderComplete?: () => void;
  onRenderError?: (error: Error) => void;
  className?: string;
}

export const PdfPage: React.FC<PdfPageProps> = React.memo(({
  pageNumber,
  width,
  height,
  pdfDocument,
  isVisible,
  onRenderComplete,
  onRenderError,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // 追踪是否已经渲染完成，避免重复渲染
  const hasRenderedRef = useRef(false);
  // 追踪上一次的 isVisible 状态
  const prevIsVisibleRef = useRef(false);

  // 存储 PDF 渲染任务用于取消
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);
  
  // 存储 TextLayer 实例用于清理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textLayerInstanceRef = useRef<any>(null);

  // 渲染文本层 - 使用 pdf.js 官方的 TextLayer 类
  const renderTextLayer = useCallback(async (page: PDFPageProxy) => {
    if (!textLayerRef.current || !isMountedRef.current) return;

    const textLayer = textLayerRef.current;
    textLayer.innerHTML = '';

    // 清理之前的 TextLayer 实例
    if (textLayerInstanceRef.current) {
      textLayerInstanceRef.current.cancel();
      textLayerInstanceRef.current = null;
    }

    try {
      // 使用容器尺寸（已由 PdfReader 根据 scale 计算好）
      const containerWidth = width;
      const containerHeight = height;

      // 计算缩放比例：容器尺寸 / 原始页面尺寸（与 canvas 渲染保持一致）
      const baseViewport = page.getViewport({ scale: 1 });
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      const fitScale = Math.min(scaleX, scaleY);

      // 获取与 canvas 相同的 viewport
      const viewport = page.getViewport({ scale: fitScale });

      // 设置文本层尺寸与 viewport 一致
      textLayer.style.width = `${viewport.width}px`;
      textLayer.style.height = `${viewport.height}px`;

      // 设置 pdf.js CSS 所需的 CSS 变量
      textLayer.style.setProperty('--total-scale-factor', `${fitScale}`);

      // 使用官方的 TextLayer 类
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textLayerInstance = new (pdfjsLib as any).TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: false,
        }),
        container: textLayer,
        viewport: viewport,
      });

      textLayerInstanceRef.current = textLayerInstance;

      // 渲染文本层
      await textLayerInstance.render();
    } catch (error) {
      console.warn(`Failed to render text layer for page ${pageNumber}:`, error);
    }
  }, [pageNumber, width, height]);

  // 渲染页面
  const renderPage = useCallback(async () => {
    if (!canvasRef.current || !pdfDocument || !isMountedRef.current) {
      return;
    }

    // 如果页面不可见，延迟渲染
    if (!isVisible) {
      setIsLoading(false);
      return;
    }

    // 如果已经渲染过，不再重复渲染
    if (hasRenderedRef.current) {
      setIsLoading(false);
      setHasError(false);
      return;
    }

    try {
      const page = await pdfDocument.getPage(pageNumber);
      if (!page) {
        throw new Error(`Page ${pageNumber} not found`);
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const pixelRatio = window.devicePixelRatio || 1;

      // 使用容器尺寸计算渲染尺寸
      // width/height 已经由 PdfReader 根据 scale 计算好，直接使用
      const containerWidth = width;
      const containerHeight = height;

      // 计算缩放比例：容器尺寸 / 原始页面尺寸
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      const fitScale = Math.min(scaleX, scaleY);

      // 获取适合容器大小的 viewport
      const scaledViewport = page.getViewport({ scale: fitScale });

      // 设置 canvas 尺寸（物理像素）
      const physicalWidth = Math.floor(scaledViewport.width * pixelRatio);
      const physicalHeight = Math.floor(scaledViewport.height * pixelRatio);

      canvasRef.current.width = physicalWidth;
      canvasRef.current.height = physicalHeight;
      canvasRef.current.style.width = `${scaledViewport.width}px`;
      canvasRef.current.style.height = `${scaledViewport.height}px`;

      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // 缩放 context 以匹配 HiDPI
      ctx.scale(pixelRatio, pixelRatio);

      // 取消之前未完成的渲染任务
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore cancel errors
        }
        renderTaskRef.current = null;
      }

      // 渲染 PDF 页面
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderTask = (page as any).render({
        canvasContext: ctx,
        viewport: scaledViewport,
      });
      
      // 保存当前渲染任务
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      renderTaskRef.current = null;

      // 渲染文本层
      if (isMountedRef.current) {
        await renderTextLayer(page);
      }

      page.cleanup();

      if (isMountedRef.current) {
        setIsLoading(false);
        hasRenderedRef.current = true;
        onRenderComplete?.();
      }
    } catch (error) {
      if (isMountedRef.current) {
        setHasError(true);
        setIsLoading(false);
        onRenderError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }, [pageNumber, width, height, pdfDocument, isVisible, renderTextLayer, onRenderComplete, onRenderError]);

  // 监听尺寸变化和可见性变化
  useEffect(() => {
    isMountedRef.current = true;
    
    // 当 width 或 height 变化时，重置渲染状态
    hasRenderedRef.current = false;
    
    // 取消正在进行的渲染任务
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // ignore cancel errors
      }
      renderTaskRef.current = null;
    }
    
    // 清理画布
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    // 清理文本层
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = '';
    }
    if (textLayerInstanceRef.current) {
      textLayerInstanceRef.current.cancel();
      textLayerInstanceRef.current = null;
    }
    
    return () => {
      isMountedRef.current = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [width, height]);

  // 监听 isVisible 变化，触发渲染
  useEffect(() => {
    // 如果可见且未渲染过，则触发渲染
    if (isVisible && !hasRenderedRef.current) {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      renderTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          renderPage();
        }
      }, 0);
    }
    // 如果变为不可见，记录状态但不清理（保留已渲染的内容）
    prevIsVisibleRef.current = isVisible;
  }, [isVisible, renderPage]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      // 取消正在进行的 PDF 渲染任务
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore cancel errors
        }
        renderTaskRef.current = null;
      }
      // 清理 TextLayer 实例
      if (textLayerInstanceRef.current) {
        textLayerInstanceRef.current.cancel();
        textLayerInstanceRef.current = null;
      }
      // 清理文本层 DOM
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
      }
    };
  }, []);

  const containerStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative',
    backgroundColor: '#fff',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    margin: '0 auto 16px',
    overflow: 'hidden',
  };

  const canvasStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  };

  const textLayerStyle: React.CSSProperties = {
    // 基础定位由 pdf.js CSS 处理，这里只确保层级正确
    zIndex: 1,
  };

  const loadingStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#999',
  };

  const errorStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#ff4d4f',
    textAlign: 'center',
  };

  return (
    <div ref={containerRef} style={containerStyle} className={className}>
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        aria-label={`PDF page ${pageNumber}`}
      />
      <div
        ref={textLayerRef}
        style={textLayerStyle}
        className="textLayer"
      />
      {isLoading && (
        <div style={loadingStyle}>加载中...{pageNumber}</div>
      )}
      {hasError && !isLoading && (
        <div style={errorStyle}>
          页面加载失败
          <br />
          <small>第 {pageNumber} 页</small>
        </div>
      )}
    </div>
  );
});
