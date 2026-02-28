export interface BookMetadata {
  title: string;
  author: string;
  description?: string;
  language?: string;
  publisher?: string;
  publicationDate?: string;
  identifier?: string;
}

export interface Chapter {
  id: string;
  title: string;
  href: string;
  level: number;
  children?: Chapter[];
}

export interface Book {
  id: string;
  metadata: BookMetadata;
  cover?: string;
  file: Blob;
  addedAt: Date;
  updatedAt: Date;
}

export interface ReadingProgress {
  bookId: string;
  currentChapter: string;
  currentPosition: number;
  lastReadAt: Date;
  totalProgress: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  position: number;
  text: string;
  createdAt: Date;
}

export interface ParsedChapter {
  id: string;
  title: string;
  href: string;
  level: number;
  content: string;
}

export interface ParsedEpub {
  metadata: BookMetadata;
  cover?: string;
  tableOfContents: Chapter[];
  chapters: ParsedChapter[];
}

export interface EpubImage {
  id: string;
  path: string;
  blob: Blob;
  mimeType: string;
}
