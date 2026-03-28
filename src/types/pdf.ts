export interface PdfMetadata {
  title: string;
  author: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  pageCount: number;
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number;
  dest?: unknown;
  items: PdfOutlineItem[];
}

export interface ParsedPdf {
  metadata: PdfMetadata;
  outline: PdfOutlineItem[];
  pageCount: number;
  cover?: string;
  file: Blob;
}

export interface PdfViewport {
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

export interface PdfPageInfo {
  pageNumber: number;
  viewport: PdfViewport;
}

export interface RenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export interface CachedPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  scale: number;
  timestamp: number;
  renderTask?: RenderTask;
}

export type BookFormat = 'epub' | 'pdf';

export interface BookWithFormat {
  id: string;
  format: BookFormat;
  metadata: {
    title: string;
    author: string;
    description?: string;
    language?: string;
    publisher?: string;
    publicationDate?: string;
    identifier?: string;
  };
  cover?: string;
  file: Blob;
  addedAt: Date;
  updatedAt: Date;
}

export interface PdfReadingProgress {
  bookId: string;
  currentPage: number;
  currentPosition: number;
  lastReadAt: Date;
  totalProgress: number;
  scale: number;
}
