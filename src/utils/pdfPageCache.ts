import type { PDFPageProxy } from 'pdfjs-dist';

interface CachedPageData {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  scale: number;
  timestamp: number;
}

interface PageRenderRequest {
  pageNumber: number;
  scale: number;
  canvas: HTMLCanvasElement;
  resolve: () => void;
  reject: (error: Error) => void;
}

class PdfPageCacheManager {
  private cache = new Map<number, CachedPageData>();
  private maxCacheSize = 10;
  private offscreenCanvasMap = new Map<number, OffscreenCanvas>();
  private renderQueue: PageRenderRequest[] = [];
  private isProcessingQueue = false;
  private currentDocument: { getPage: (pageNumber: number) => Promise<PDFPageProxy | null> } | null = null;

  /**
   * 设置当前 PDF 文档
   */
  setDocument(document: { getPage: (pageNumber: number) => Promise<PDFPageProxy | null> } | null): void {
    this.currentDocument = document;
    this.clearCache();
  }

  /**
   * 获取缓存的页面
   */
  getCachedPage(pageNumber: number, scale: number): HTMLCanvasElement | null {
    const cached = this.cache.get(pageNumber);
    if (cached && cached.scale === scale) {
      // 更新访问时间
      cached.timestamp = Date.now();
      return cached.canvas;
    }
    return null;
  }

  /**
   * 获取离屏 canvas
   */
  getOffscreenCanvas(pageNumber: number, width: number, height: number): OffscreenCanvas {
    let offscreen = this.offscreenCanvasMap.get(pageNumber);
    
    if (!offscreen || offscreen.width !== width || offscreen.height !== height) {
      offscreen = new OffscreenCanvas(width, height);
      this.offscreenCanvasMap.set(pageNumber, offscreen);
    }
    
    return offscreen;
  }

  /**
   * 将页面添加到缓存
   */
  setCachedPage(pageNumber: number, scale: number, canvas: HTMLCanvasElement): void {
    // 如果缓存已满，移除最旧的条目
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(pageNumber)) {
      this.removeOldestEntry();
    }

    this.cache.set(pageNumber, {
      pageNumber,
      canvas,
      scale,
      timestamp: Date.now(),
    });
  }

  /**
   * 渲染页面
   */
  async renderPage(
    pageNumber: number,
    scale: number,
    targetCanvas: HTMLCanvasElement
  ): Promise<void> {
    // 检查缓存
    const cached = this.getCachedPage(pageNumber, scale);
    if (cached) {
      // 从缓存复制到目标 canvas
      const ctx = targetCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        ctx.drawImage(cached, 0, 0);
      }
      return;
    }

    // 添加到渲染队列
    return new Promise((resolve, reject) => {
      this.renderQueue.push({
        pageNumber,
        scale,
        canvas: targetCanvas,
        resolve,
        reject,
      });
      this.processRenderQueue();
    });
  }

  /**
   * 处理渲染队列
   */
  private async processRenderQueue(): Promise<void> {
    if (this.isProcessingQueue || this.renderQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.renderQueue.length > 0) {
      const request = this.renderQueue.shift();
      if (!request) continue;

      try {
        await this.performRender(request);
        request.resolve();
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * 执行实际渲染
   */
  private async performRender(request: PageRenderRequest): Promise<void> {
    const { pageNumber, scale, canvas } = request;

    if (!this.currentDocument) {
      throw new Error('No document loaded');
    }

    const page = await this.currentDocument.getPage(pageNumber);
    if (!page) {
      throw new Error(`Page ${pageNumber} not found`);
    }

    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;
    
    // 设置 canvas 尺寸（CSS 尺寸）
    const cssWidth = viewport.width;
    const cssHeight = viewport.height;
    
    // 物理尺寸（HiDPI）
    const physicalWidth = Math.floor(cssWidth * pixelRatio);
    const physicalHeight = Math.floor(cssHeight * pixelRatio);
    
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // 缩放 context 以匹配 HiDPI
    ctx.scale(pixelRatio, pixelRatio);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTask = (page as any).render({
      canvasContext: ctx,
      viewport,
    });

    await renderTask.promise;
    
    // 缓存渲染结果（使用原始物理尺寸）
    const cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = physicalWidth;
    cacheCanvas.height = physicalHeight;
    cacheCanvas.style.width = `${cssWidth}px`;
    cacheCanvas.style.height = `${cssHeight}px`;
    const cacheCtx = cacheCanvas.getContext('2d');
    if (cacheCtx) {
      cacheCtx.drawImage(canvas, 0, 0);
      this.setCachedPage(pageNumber, scale, cacheCanvas);
    }

    page.cleanup();
  }

  /**
   * 移除最旧的缓存条目
   */
  private removeOldestEntry(): void {
    let oldestKey: number | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, value] of this.cache) {
      if (value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.cache.delete(oldestKey);
      this.offscreenCanvasMap.delete(oldestKey);
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.offscreenCanvasMap.clear();
    this.renderQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * 预加载页面
   */
  async preloadPages(pageNumbers: number[], scale: number): Promise<void> {
    for (const pageNumber of pageNumbers) {
      if (!this.cache.has(pageNumber)) {
        // 创建一个临时 canvas 用于预加载
        const tempCanvas = document.createElement('canvas');
        try {
          await this.renderPage(pageNumber, scale, tempCanvas);
        } catch (error) {
          console.warn(`Failed to preload page ${pageNumber}:`, error);
        }
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; maxSize: number; offscreenCount: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      offscreenCount: this.offscreenCanvasMap.size,
    };
  }

  /**
   * 设置最大缓存大小
   */
  setMaxCacheSize(size: number): void {
    this.maxCacheSize = size;
    // 如果当前缓存超过新的大小限制，移除多余的条目
    while (this.cache.size > this.maxCacheSize) {
      this.removeOldestEntry();
    }
  }
}

// 导出单例实例
export const pdfPageCache = new PdfPageCacheManager();

// 导出类以便需要时创建新实例
export { PdfPageCacheManager };
