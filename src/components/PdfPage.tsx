import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

interface PdfPageProps {
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
  pdfDocument: { getPage: (pageNumber: number) => Promise<PDFPageProxy | null> } | null;
  isVisible: boolean;
  onRenderComplete?: () => void;
  onRenderError?: (error: Error) => void;
  className?: string;
}

export const PdfPage: React.FC<PdfPageProps> = ({
  pageNumber,
  scale,
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
  const [containerSize, setContainerSize] = useState({ width, height });
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // 监听容器尺寸变化
  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          setContainerSize({ width: w, height: h });
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  // 渲染文本层
  const renderTextLayer = useCallback(async (page: PDFPageProxy) => {
    if (!textLayerRef.current || !isMountedRef.current) return;

    const textLayer = textLayerRef.current;
    textLayer.innerHTML = '';

    try {
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale });

      // 使用容器的实际尺寸
      const containerWidth = containerSize.width;
      const containerHeight = containerSize.height;

      // 设置文本层尺寸与容器一致
      textLayer.style.width = '100%';
      textLayer.style.height = '100%';

      // 计算缩放比例（PDF坐标系到容器像素）
      const scaleX = containerWidth / viewport.width;
      const scaleY = containerHeight / viewport.height;

      // 创建文本片段
      for (const item of textContent.items) {
        const textItem = item as {
          str: string;
          dir: string;
          width: number;
          height: number;
          transform: number[];
          fontName: string;
          hasEOL: boolean;
        };

        const tx = pdfjsLib.Util.transform(viewport.transform, textItem.transform);
        const fontHeight = Math.hypot(tx[0], tx[1]);
        const fontWidth = Math.hypot(tx[2], tx[3]);

        const span = document.createElement('span');
        span.textContent = textItem.str;
        span.style.position = 'absolute';
        // 应用缩放比例
        span.style.left = `${tx[4] * scaleX}px`;
        span.style.top = `${(tx[5] - fontHeight) * scaleY}px`;
        span.style.fontSize = `${fontHeight * scaleY}px`;
        span.style.fontFamily = textItem.fontName;
        span.style.transform = `scaleX(${textItem.width * scaleX / fontWidth})`;
        span.style.transformOrigin = '0% 0%';
        span.style.whiteSpace = 'pre';
        span.style.userSelect = 'text';
        span.style.cursor = 'text';

        textLayer.appendChild(span);
      }
    } catch (error) {
      console.warn(`Failed to render text layer for page ${pageNumber}:`, error);
    }
  }, [pageNumber, scale, containerSize]);

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

    setIsLoading(true);
    setHasError(false);

    try {
      const page = await pdfDocument.getPage(pageNumber);
      if (!page) {
        throw new Error(`Page ${pageNumber} not found`);
      }

      const viewport = page.getViewport({ scale: 1 });
      const pixelRatio = window.devicePixelRatio || 1;

      // 使用容器尺寸计算渲染尺寸
      const containerWidth = containerSize.width;
      const containerHeight = containerSize.height;

      // 计算适应容器的缩放比例
      const scaleX = containerWidth / viewport.width;
      const scaleY = containerHeight / viewport.height;
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

      // 渲染 PDF 页面
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderTask = (page as any).render({
        canvasContext: ctx,
        viewport: scaledViewport,
      });

      await renderTask.promise;

      // 渲染文本层
      if (isMountedRef.current) {
        await renderTextLayer(page);
      }

      page.cleanup();

      if (isMountedRef.current) {
        setIsLoading(false);
        onRenderComplete?.();
      }
    } catch (error) {
      if (isMountedRef.current) {
        setHasError(true);
        setIsLoading(false);
        onRenderError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }, [pageNumber, scale, pdfDocument, isVisible, containerSize, renderTextLayer, onRenderComplete, onRenderError]);

  // 初始化和更新渲染
  useEffect(() => {
    isMountedRef.current = true;

    // 清除之前的超时
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    // 使用 requestAnimationFrame 来避免阻塞主线程
    renderTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        renderPage();
      }
    }, 0);

    return () => {
      isMountedRef.current = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [renderPage]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      // 清理文本层
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
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    opacity: 0.2,
    lineHeight: 1,
    pointerEvents: 'auto',
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
        className="pdf-text-layer"
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
};

// 导入 pdfjsLib 用于文本层渲染
import * as pdfjsLib from 'pdfjs-dist';
