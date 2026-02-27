/**
 * Image Resource Manager with Lazy Loading and Memory Management
 * 
 * Features:
 * - Lazy loading: Images are only loaded when they enter the viewport
 * - LRU cache: Automatically evicts least recently used images when limit reached
 * - Automatic cleanup: Removes object URLs when images leave viewport
 * - Memory limit: Configurable maximum number of cached images
 * - Thread-safe: Handles race conditions from rapid scrolling/chapter changes
 */

interface ImageCacheEntry {
  blob: Blob;
  objectUrl: string;
  lastAccessed: number;
  element: WeakRef<HTMLImageElement> | null;
  loading: boolean;
  releaseTimeoutId?: ReturnType<typeof setTimeout>;
}

interface ImageResource {
  id: string;
  path: string;
  blob: Blob;
}

export class ImageResourceManager {
  private images: Map<string, ImageResource> = new Map();
  private cache: Map<string, ImageCacheEntry> = new Map();
  private observers: Map<HTMLElement, IntersectionObserver> = new Map();
  private maxCacheSize: number;
  private cleanupTimeout: number;

  constructor(_bookId: string, options: { maxCacheSize?: number; cleanupTimeout?: number } = {}) {
    this.maxCacheSize = options.maxCacheSize || 10;
    this.cleanupTimeout = options.cleanupTimeout || 5000;
  }

  /**
   * Register an image resource from EPUB parsing
   */
  registerImage(id: string, path: string, blob: Blob): void {
    this.images.set(id, { id, path, blob });
  }

  /**
   * Get or create an object URL for an image
   * Thread-safe: prevents duplicate creation if called concurrently
   */
  getImageUrl(id: string): string | undefined {
    // Check if already cached
    const cached = this.cache.get(id);
    if (cached) {
      cached.lastAccessed = Date.now();
      
      // Cancel any pending release
      if (cached.releaseTimeoutId !== undefined) {
        clearTimeout(cached.releaseTimeoutId);
        cached.releaseTimeoutId = undefined;
        console.log(`[ImageManager] Cancelled release for: ${id}`);
      }
      
      return cached.objectUrl;
    }

    // Load from storage
    const resource = this.images.get(id);
    if (!resource) {
      console.warn(`[ImageManager] Image not found: ${id}`);
      return undefined;
    }

    // Double-check after potential race condition
    const doubleCheck = this.cache.get(id);
    if (doubleCheck) {
      return doubleCheck.objectUrl;
    }

    // Evict old entries if at capacity
    this.ensureCacheCapacity();

    // Create object URL
    const objectUrl = URL.createObjectURL(resource.blob);
    this.cache.set(id, {
      blob: resource.blob,
      objectUrl,
      lastAccessed: Date.now(),
      element: null,
      loading: false,
    });

    console.log(`[ImageManager] Loaded image: ${id} (${this.cache.size}/${this.maxCacheSize})`);
    return objectUrl;
  }

  /**
   * Release an image from cache (called when leaving viewport)
   * Thread-safe: cancels previous release timeouts and checks viewport before releasing
   */
  releaseImage(id: string, delay: number = this.cleanupTimeout): void {
    const cached = this.cache.get(id);
    if (!cached) return;

    // Cancel any existing release timeout
    if (cached.releaseTimeoutId !== undefined) {
      clearTimeout(cached.releaseTimeoutId);
    }

    // Set new release timeout
    cached.releaseTimeoutId = globalThis.setTimeout(() => {
      this.doReleaseImage(id);
    }, delay);
  }

  private doReleaseImage(id: string): void {
    const cached = this.cache.get(id);
    if (!cached) return;

    // Check if image is still in viewport before releasing
    const element = cached.element?.deref();
    if (element) {
      const rect = element.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
      if (isInViewport) {
        console.log(`[ImageManager] Image ${id} still in viewport, skipping release`);
        return;
      }
    }

    URL.revokeObjectURL(cached.objectUrl);
    this.cache.delete(id);
    console.log(`[ImageManager] Released image: ${id} (${this.cache.size}/${this.maxCacheSize})`);
  }

  /**
   * Set the image element reference for a cached image
   */
  setImageElement(id: string, element: HTMLImageElement): void {
    const cached = this.cache.get(id);
    if (cached) {
      cached.element = new WeakRef(element);
    }
  }

  /**
   * Setup lazy loading for an image element
   * Thread-safe: disconnects existing observers and prevents duplicate loading
   */
  setupLazyLoading(element: HTMLImageElement, imageId: string): void {
    // Disconnect any existing observer for this specific element
    const existingObserver = this.observers.get(element);
    if (existingObserver) {
      existingObserver.disconnect();
      this.observers.delete(element);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Image entered viewport - load it
            const url = this.getImageUrl(imageId);
            if (url && element.src !== url) {
              element.src = url;
              this.setImageElement(imageId, element);
            }
          } else {
            // Image left viewport - release after delay
            this.releaseImage(imageId);
          }
        });
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0,
      }
    );

    observer.observe(element);
    this.observers.set(element, observer);
  }

  /**
   * Ensure cache doesn't exceed max size by evicting LRU entries
   */
  private ensureCacheCapacity(): void {
    while (this.cache.size >= this.maxCacheSize) {
      // Find least recently used entry
      let lruId: string | null = null;
      let lruTime = Infinity;

      this.cache.forEach((entry, id) => {
        // Skip entries with pending releases (they're being used)
        if (entry.releaseTimeoutId !== undefined) return;
        
        if (entry.lastAccessed < lruTime) {
          lruTime = entry.lastAccessed;
          lruId = id;
        }
      });

      if (lruId) {
        this.doReleaseImage(lruId);
      } else {
        // All entries have pending releases, can't evict
        break;
      }
    }
  }

  /**
   * Setup lazy loading for all images in a container
   * Thread-safe: clears previous observers before setting up new ones
   */
  setupContainer(container: HTMLElement): void {
    // Disconnect all existing observers first to prevent accumulation
    this.observers.forEach((observer) => {
      observer.disconnect();
    });
    this.observers.clear();

    const images = container.querySelectorAll('img[data-epub-image]');
    images.forEach((img) => {
      const imageId = img.getAttribute('data-epub-image');
      if (imageId && img instanceof HTMLImageElement) {
        this.setupLazyLoading(img, imageId);
      }
    });
  }

  /**
   * Cleanup all resources when closing the book
   * Thread-safe: clears all timeouts and observers
   */
  dispose(): void {
    // Clear all pending release timeouts
    this.cache.forEach((entry) => {
      if (entry.releaseTimeoutId !== undefined) {
        clearTimeout(entry.releaseTimeoutId);
      }
    });

    // Revoke all object URLs
    this.cache.forEach((entry) => {
      URL.revokeObjectURL(entry.objectUrl);
    });
    this.cache.clear();
    this.images.clear();

    // Disconnect all observers
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();

    console.log('[ImageManager] Disposed all resources');
  }

  /**
   * Get current memory usage stats
   */
  getStats(): { cached: number; registered: number; maxCache: number; observers: number } {
    return {
      cached: this.cache.size,
      registered: this.images.size,
      maxCache: this.maxCacheSize,
      observers: this.observers.size,
    };
  }
}

// Global map to store image managers per book
const imageManagers = new Map<string, ImageResourceManager>();

export function getImageManager(bookId: string): ImageResourceManager | undefined {
  return imageManagers.get(bookId);
}

export function createImageManager(bookId: string, options?: { maxCacheSize?: number }): ImageResourceManager {
  const existing = imageManagers.get(bookId);
  if (existing) {
    return existing;
  }
  
  const manager = new ImageResourceManager(bookId, options);
  imageManagers.set(bookId, manager);
  return manager;
}

export function disposeImageManager(bookId: string): void {
  const manager = imageManagers.get(bookId);
  if (manager) {
    manager.dispose();
    imageManagers.delete(bookId);
  }
}
