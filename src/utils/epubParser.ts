import JSZip from 'jszip';
import type { BookMetadata, Chapter, ParsedEpub, ParsedChapter, EpubImage } from '../types';

export class EpubParser {
  private zip: JSZip | null = null;
  private opfPath: string = '';
  private opfContent: Document | null = null;
  private manifest: Map<string, { href: string; 'media-type': string; properties?: string }> = new Map();
  private spine: string[] = [];
  private basePath: string = '';
  private images: Map<string, EpubImage> = new Map();

  async load(file: File | Blob): Promise<ParsedEpub & { images: EpubImage[] }> {
    this.zip = await JSZip.loadAsync(file);
    
    // Find OPF file path from container.xml
    await this.findOpfPath();
    
    // Parse OPF file
    await this.parseOpf();
    
    // Extract metadata
    const metadata = await this.extractMetadata();
    
    // Extract cover
    const cover = await this.extractCover();
    
    // Parse table of contents
    const tableOfContents = await this.parseTableOfContents();
    
    // Parse chapters (this will also collect images)
    const chapters = await this.parseChapters();
    
    return {
      metadata,
      cover,
      tableOfContents,
      chapters,
      images: Array.from(this.images.values()),
    };
  }

  private async findOpfPath(): Promise<void> {
    if (!this.zip) throw new Error('EPUB not loaded');
    
    const containerFile = this.zip.file('META-INF/container.xml');
    if (!containerFile) {
      throw new Error('Invalid EPUB: container.xml not found');
    }
    
    const content = await containerFile.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xml');
    
    const rootfile = doc.querySelector('rootfile[media-type="application/oebps-package+xml"]');
    if (!rootfile) {
      throw new Error('Invalid EPUB: rootfile not found in container.xml');
    }
    
    this.opfPath = rootfile.getAttribute('full-path') || '';
    this.basePath = this.opfPath.includes('/') 
      ? this.opfPath.substring(0, this.opfPath.lastIndexOf('/') + 1)
      : '';
  }

  private async parseOpf(): Promise<void> {
    if (!this.zip || !this.opfPath) throw new Error('OPF path not found');
    
    const opfFile = this.zip.file(this.opfPath);
    if (!opfFile) {
      throw new Error(`OPF file not found: ${this.opfPath}`);
    }
    
    const content = await opfFile.async('text');
    const parser = new DOMParser();
    this.opfContent = parser.parseFromString(content, 'application/xml');
    
    // Parse manifest
    const manifestItems = this.opfContent.querySelectorAll('manifest item');
      manifestItems.forEach(item => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type');
      const properties = item.getAttribute('properties') || '';
      if (id && href) {
        this.manifest.set(id, { href, 'media-type': mediaType || '', properties });
      }
    });
    
    // Parse spine
    const spineItems = this.opfContent.querySelectorAll('spine itemref');
    spineItems.forEach(item => {
      const idref = item.getAttribute('idref');
      if (idref) {
        this.spine.push(idref);
      }
    });
  }

  private async extractMetadata(): Promise<BookMetadata> {
    if (!this.opfContent) throw new Error('OPF not parsed');
    
    const metadata: BookMetadata = {
      title: 'Unknown Title',
      author: 'Unknown Author',
    };
    
    const titleElem = this.opfContent.querySelector('metadata title');
    if (titleElem) {
      metadata.title = titleElem.textContent || 'Unknown Title';
    }
    
    const creatorElem = this.opfContent.querySelector('metadata creator');
    if (creatorElem) {
      metadata.author = creatorElem.textContent || 'Unknown Author';
    }
    
    const descriptionElem = this.opfContent.querySelector('metadata description');
    if (descriptionElem) {
      metadata.description = descriptionElem.textContent || undefined;
    }
    
    const languageElem = this.opfContent.querySelector('metadata language');
    if (languageElem) {
      metadata.language = languageElem.textContent || undefined;
    }
    
    const publisherElem = this.opfContent.querySelector('metadata publisher');
    if (publisherElem) {
      metadata.publisher = publisherElem.textContent || undefined;
    }
    
    const dateElem = this.opfContent.querySelector('metadata date');
    if (dateElem) {
      metadata.publicationDate = dateElem.textContent || undefined;
    }
    
    const identifierElem = this.opfContent.querySelector('metadata identifier');
    if (identifierElem) {
      metadata.identifier = identifierElem.textContent || undefined;
    }
    
    return metadata;
  }

  private async extractCover(): Promise<string | undefined> {
    if (!this.zip || !this.opfContent) return undefined;
    
    // Try to find cover from meta element
    let coverId: string | null = null;
    
    const coverMeta = this.opfContent.querySelector('meta[name="cover"]');
    if (coverMeta) {
      coverId = coverMeta.getAttribute('content');
    }
    
    // Also look for item with properties="cover-image" in the manifest
    if (!coverId) {
      for (const [id, entry] of this.manifest) {
        if (entry.properties === 'cover-image') {
          coverId = id;
          break;
        }
      }
    }
    
    if (coverId && this.manifest.has(coverId)) {
      const coverEntry = this.manifest.get(coverId)!;
      const coverPath = this.basePath + coverEntry.href;
      const coverFile = this.zip.file(coverPath);
      
      if (coverFile) {
        const blob = await coverFile.async('blob');
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }
    
    return undefined;
  }

  private async parseTableOfContents(): Promise<Chapter[]> {
    if (!this.zip || !this.opfContent) return [];
    
    // Look for NCX file
    let ncxId: string | null = null;
    let navId: string | null = null;
    
    for (const [id, entry] of this.manifest) {
      if (entry['media-type'] === 'application/x-dtbncx+xml') {
        ncxId = id;
      }
      if (entry.properties === 'nav' || entry['media-type'] === 'application/xhtml+xml') {
        const href = entry.href.toLowerCase();
        if (href.includes('nav') || href.includes('toc')) {
          navId = id;
        }
      }
    }
    
    // Try NCX first, then navigation document
    if (ncxId) {
      return this.parseNcx(ncxId);
    } else if (navId) {
      return this.parseNavDocument(navId);
    }
    
    // Fallback: create TOC from spine
    return this.createTocFromSpine();
  }

  private async parseNcx(ncxId: string): Promise<Chapter[]> {
    if (!this.zip) return [];
    
    const ncxEntry = this.manifest.get(ncxId);
    if (!ncxEntry) return [];
    
    const ncxPath = this.basePath + ncxEntry.href;
    const ncxFile = this.zip.file(ncxPath);
    if (!ncxFile) return [];
    
    const content = await ncxFile.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xml');
    
    const navMap = doc.querySelector('navMap');
    if (!navMap) return [];
    
    const parseNavPoint = (elem: Element, level: number): Chapter => {
      const id = elem.getAttribute('id') || '';
      const contentElem = elem.querySelector('content');
      const href = contentElem?.getAttribute('src') || '';
      
      const navLabel = elem.querySelector('navLabel text');
      const title = navLabel?.textContent || 'Untitled';
      
      const chapter: Chapter = {
        id,
        title: title || 'Untitled',
        href,
        level,
      };
      
      const childNavPoints = elem.querySelectorAll(':scope > navPoint');
      if (childNavPoints.length > 0) {
        chapter.children = Array.from(childNavPoints).map(child => 
          parseNavPoint(child, level + 1)
        );
      }
      
      return chapter;
    };
    
    const topLevelNavPoints = navMap.querySelectorAll(':scope > navPoint');
    return Array.from(topLevelNavPoints).map(np => parseNavPoint(np, 0));
  }

  private async parseNavDocument(navId: string): Promise<Chapter[]> {
    if (!this.zip) return [];
    
    const navEntry = this.manifest.get(navId);
    if (!navEntry) return [];
    
    const navPath = this.basePath + navEntry.href;
    const navFile = this.zip.file(navPath);
    if (!navFile) return [];
    
    const content = await navFile.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xhtml+xml');
    
    const tocNav = doc.querySelector('nav[epub:type="toc"], nav#toc');
    if (!tocNav) return [];
    
    const parseList = (elem: Element, level: number): Chapter[] => {
      const chapters: Chapter[] = [];
      const items = elem.querySelectorAll(':scope > li');
      
      items.forEach((item, index) => {
        const link = item.querySelector('a');
        if (link) {
          const href = link.getAttribute('href') || '';
          const title = link.textContent || 'Untitled';
          
          const chapter: Chapter = {
            id: `nav-${level}-${index}`,
            title: title || 'Untitled',
            href,
            level,
          };
          
          const subList = item.querySelector(':scope > ol, :scope > ul');
          if (subList) {
            chapter.children = parseList(subList, level + 1);
          }
          
          chapters.push(chapter);
        }
      });
      
      return chapters;
    };
    
    const topList = tocNav.querySelector('ol, ul');
    if (topList) {
      return parseList(topList, 0);
    }
    
    return [];
  }

  private createTocFromSpine(): Promise<Chapter[]> {
    const chapters: Chapter[] = this.spine.map((idref, index) => {
      const entry = this.manifest.get(idref);
      return {
        id: idref,
        title: `Chapter ${index + 1}`,
        href: entry?.href || '',
        level: 0,
      };
    });
    
    return Promise.resolve(chapters);
  }

  private async parseChapters(): Promise<ParsedChapter[]> {
    if (!this.zip) return [];
    
    const chapters: ParsedChapter[] = [];
    
    for (let i = 0; i < this.spine.length; i++) {
      const idref = this.spine[i];
      const entry = this.manifest.get(idref);
      
      if (!entry) continue;
      
      const chapterPath = this.basePath + entry.href;
      const chapterFile = this.zip.file(chapterPath);
      
      if (!chapterFile) continue;
      
      const content = await chapterFile.async('text');
      
      // Parse chapter to extract title and clean content
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'application/xhtml+xml');
      
      // Try to get title from heading
      let title = `Chapter ${i + 1}`;
      const h1 = doc.querySelector('h1');
      const titleElem = doc.querySelector('title');
      if (h1?.textContent) {
        title = h1.textContent;
      } else if (titleElem?.textContent) {
        title = titleElem.textContent;
      }
      
      // Clean up content - convert relative URLs to absolute
      const body = doc.querySelector('body');
      let chapterContent = '';
      
      if (body) {
        // Process images: extract them and replace src with data attribute
        const images = body.querySelectorAll('img');
        let imageIndex = 0;
        for (const img of images) {
          const src = img.getAttribute('src');
          if (src && !src.startsWith('http') && !src.startsWith('data:')) {
            // Construct full image path
            const imagePath = src.startsWith('/') 
              ? src.substring(1) 
              : this.basePath + src;
            
            // Try to extract image from ZIP
            const imageFile = this.zip.file(imagePath);
            if (imageFile) {
              const blob = await imageFile.async('blob');
              const imageId = `img-${idref}-${imageIndex}`;
              
              // Store image for later use
              this.images.set(imageId, {
                id: imageId,
                path: imagePath,
                blob
              });
              
              // Replace src with data attribute for lazy loading
              img.setAttribute('data-epub-image', imageId);
              img.removeAttribute('src');
              img.classList.add('epub-lazy-image');
              
              // Set a placeholder style
              img.style.minHeight = '100px';
              img.style.backgroundColor = 'var(--antd-color-fill-secondary, #f5f5f5)';
              
              imageIndex++;
            } else {
              // Image not found in EPUB, remove it
              img.remove();
            }
          }
        }
        
        // Process links: mark them for handling by the reader component
        const links = body.querySelectorAll('a');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            // Keep href but add data attribute for identification
            link.setAttribute('data-epub-link', 'true');
            // Remove target to prevent default external navigation
            link.removeAttribute('target');
          }
        });

        // Remove empty block elements that only contain &nbsp; or whitespace
        // These are often used for spacing in EPUBs but create too much vertical space
        const emptyBlockSelectors = ['p', 'div', 'section', 'article'];
        emptyBlockSelectors.forEach(selector => {
          const elements = body.querySelectorAll(selector);
          elements.forEach(el => {
            const textContent = el.textContent || '';
            const innerHTML = el.innerHTML || '';
            const hasNoChildren = el.childElementCount === 0;
            
            // Skip elements that contain important structural elements like tables, images, etc.
            const hasImportantContent = el.querySelector('table, img, svg, canvas, iframe, video, audio, object, embed, pre, code, blockquote') !== null;
            if (hasImportantContent) {
              return;
            }
            
            // Check if element only contains &nbsp;, whitespace, or is effectively empty
            const isOnlyWhitespace = /^[\s\u00A0]*$/.test(textContent);
            const isOnlyNbsp = /^(\s|&nbsp;|&#160;|\xA0)*$/i.test(innerHTML.trim());
            
            if ((isOnlyWhitespace || isOnlyNbsp || textContent.trim().length === 0) && hasNoChildren) {
              el.remove();
            }
          });
        });
        
        chapterContent = body.innerHTML;
      } else {
        chapterContent = content;
      }
      
      chapters.push({
        id: idref,
        title,
        href: entry.href,
        level: 0,
        content: chapterContent,
      });
    }
    
    return chapters;
  }

  async validate(file: File | Blob): Promise<{ valid: boolean; error?: string }> {
    try {
      const zip = await JSZip.loadAsync(file);
      
      // Check for container.xml
      const containerFile = zip.file('META-INF/container.xml');
      if (!containerFile) {
        return { valid: false, error: 'Invalid EPUB: container.xml not found' };
      }
      
      const containerContent = await containerFile.async('text');
      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerContent, 'application/xml');
      
      const rootfile = containerDoc.querySelector('rootfile[media-type="application/oebps-package+xml"]');
      if (!rootfile) {
        return { valid: false, error: 'Invalid EPUB: rootfile not found' };
      }
      
      const opfPath = rootfile.getAttribute('full-path');
      if (!opfPath) {
        return { valid: false, error: 'Invalid EPUB: OPF path not found' };
      }
      
      const opfFile = zip.file(opfPath);
      if (!opfFile) {
        return { valid: false, error: `Invalid EPUB: OPF file not found at ${opfPath}` };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `Invalid EPUB file: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

export const epubParser = new EpubParser();
