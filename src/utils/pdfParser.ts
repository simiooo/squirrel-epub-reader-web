import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PdfMetadata, PdfOutlineItem, ParsedPdf } from '../types/pdf';

// 动态设置 PDF.js worker
let workerInitialized = false;

async function initWorker(): Promise<void> {
  if (workerInitialized) return;
  
  // 使用 CDN worker，它已内联 OpenJPEG WASM 等所有解码器资源
  // Blob URL 方式会导致 WASM 文件路径解析失败（JpxError: OpenJPEG failed to initialize）
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  workerInitialized = true;
}

interface PdfInfo {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
  [key: string]: unknown;
}

export class PdfParser {
  private pdfDocument: PDFDocumentProxy | null = null;

  async load(file: File | Blob): Promise<ParsedPdf> {
    await initWorker();
    
    const arrayBuffer = await file.arrayBuffer();
    this.pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const metadata = await this.extractMetadata();
    const outline = await this.parseOutline();
    const cover = await this.extractCover();

    return {
      metadata,
      outline,
      pageCount: this.pdfDocument.numPages,
      cover,
      file,
    };
  }

  private async extractMetadata(): Promise<PdfMetadata> {
    if (!this.pdfDocument) {
      throw new Error('PDF not loaded');
    }

    const meta = await this.pdfDocument.getMetadata();
    const info = meta.info as PdfInfo;

    return {
      title: info?.Title || 'Unknown Title',
      author: info?.Author || 'Unknown Author',
      subject: info?.Subject || undefined,
      keywords: info?.Keywords || undefined,
      creator: info?.Creator || undefined,
      producer: info?.Producer || undefined,
      creationDate: info?.CreationDate ? this.parsePdfDate(info.CreationDate) : undefined,
      modificationDate: info?.ModDate ? this.parsePdfDate(info.ModDate) : undefined,
      pageCount: this.pdfDocument.numPages,
    };
  }

  private parsePdfDate(dateStr: string): Date | undefined {
    try {
      if (dateStr.startsWith('D:')) {
        const year = parseInt(dateStr.substring(2, 6), 10);
        const month = parseInt(dateStr.substring(6, 8), 10) - 1;
        const day = parseInt(dateStr.substring(8, 10), 10);
        const hour = parseInt(dateStr.substring(10, 12) || '0', 10);
        const minute = parseInt(dateStr.substring(12, 14) || '0', 10);
        const second = parseInt(dateStr.substring(14, 16) || '0', 10);
        return new Date(year, month, day, hour, minute, second);
      }
      return new Date(dateStr);
    } catch {
      return undefined;
    }
  }

  private async parseOutline(): Promise<PdfOutlineItem[]> {
    if (!this.pdfDocument) {
      return [];
    }

    try {
      const outline = await this.pdfDocument.getOutline();
      if (!outline || outline.length === 0) {
        return [];
      }

      return await this.processOutlineItems(outline);
    } catch {
      return [];
    }
  }

  private async processOutlineItems(items: unknown[]): Promise<PdfOutlineItem[]> {
    if (!this.pdfDocument) {
      return [];
    }

    const result: PdfOutlineItem[] = [];

    for (const item of items) {
      const outlineItem = item as {
        title: string;
        dest?: string | unknown[];
        items?: unknown[];
      };

      let pageNumber = 1;
      if (outlineItem.dest) {
        try {
          const dest = await this.pdfDocument.getDestination(
            Array.isArray(outlineItem.dest) ? '' : outlineItem.dest
          );
          if (dest) {
            const ref = dest[0];
            pageNumber = await this.pdfDocument.getPageIndex(ref) + 1;
          }
        } catch {
          // 如果无法解析目的地，使用默认页码
        }
      }

      const processedItem: PdfOutlineItem = {
        title: outlineItem.title || 'Untitled',
        pageNumber,
        dest: outlineItem.dest,
        items: outlineItem.items 
          ? await this.processOutlineItems(outlineItem.items) 
          : [],
      };

      result.push(processedItem);
    }

    return result;
  }

  private async extractCover(): Promise<string | undefined> {
    if (!this.pdfDocument) {
      return undefined;
    }

    try {
      const page = await this.pdfDocument.getPage(1);
      const viewport = page.getViewport({ scale: 0.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        page.cleanup();
        return undefined;
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderTask = (page as any).render({
        canvasContext: context,
        viewport,
      });

      await renderTask.promise;
      page.cleanup();

      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/jpeg', 0.85);
      });
    } catch (error) {
      console.error('Failed to extract cover:', error);
      return undefined;
    }
  }

  async getPage(pageNumber: number): Promise<PDFPageProxy | null> {
    if (!this.pdfDocument) {
      return null;
    }

    if (pageNumber < 1 || pageNumber > this.pdfDocument.numPages) {
      return null;
    }

    return this.pdfDocument.getPage(pageNumber);
  }

  async validate(file: File | Blob): Promise<{ valid: boolean; error?: string }> {
    try {
      await initWorker();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      await pdf.destroy();
      
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: `Invalid PDF file: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  getDocument(): PDFDocumentProxy | null {
    return this.pdfDocument;
  }

  async destroy(): Promise<void> {
    if (this.pdfDocument) {
      await this.pdfDocument.destroy();
      this.pdfDocument = null;
    }
  }
}

export const pdfParser = new PdfParser();
