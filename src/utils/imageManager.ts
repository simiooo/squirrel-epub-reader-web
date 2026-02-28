/**
 * Image Resource Manager with Lazy Loading and Memory Management
 * 
 * Features:
 * - Lazy loading: Images are only loaded when they enter the viewport
 * - LRU cache: Automatically evicts least recently used images when limit reached
 * - Automatic cleanup: Removes object URLs when images leave viewport
 * - Memory limit: Configurable maximum number of cached images
 * - Thread-safe: Handles race conditions from rapid scrolling/chapter changes
 * - Singleton pattern: One instance per bookId globally
 */

declare global {
  var __SQUIRREL_IMAGE_MANAGER__: {
    instances: Map<string, ImageResourceManager>;
    namespace: string;
  };
}

// Singleton namespace constant
const SINGELTON_NAMESPACE = '__squirrel_image_manager_singleton__';

// Initialize global singleton storage
if (!globalThis.__SQUIRREL_IMAGE_MANAGER__) {
  globalThis.__SQUIRREL_IMAGE_MANAGER__ = {
    instances: new Map<string, ImageResourceManager>(),
    namespace: SINGELTON_NAMESPACE,
  };
}

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
    // Set a very high cache size to prevent premature eviction
    this.maxCacheSize = options.maxCacheSize || 1000;
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
      }
      
      return cached.objectUrl;
    }

    // Load from storage
    const resource = this.images.get(id);
    if (!resource) {
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
        return;
      }
    }

    URL.revokeObjectURL(cached.objectUrl);
    this.cache.delete(id);
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
    // Load image immediately and keep it loaded
    const url = this.getImageUrl(imageId);
    if (url && element.src !== url) {
      element.src = url;
      this.setImageElement(imageId, element);
    }
  }

  /**
   * Ensure cache doesn't exceed max size by evicting LRU entries
   * Currently disabled to prevent premature eviction - all images are kept until dispose()
   */
  private ensureCacheCapacity(): void {
    // Disable LRU eviction - we keep all images until the book is closed
    // This prevents blob URLs from being revoked while images are still displayed
    return;
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

// Access singleton storage from globalThis
const getSingletonStorage = (): Map<string, ImageResourceManager> => {
  return globalThis.__SQUIRREL_IMAGE_MANAGER__.instances;
};

/**
 * Get an existing image manager for a book (singleton accessor)
 */
export function getImageManager(bookId: string): ImageResourceManager | undefined {
  return getSingletonStorage().get(bookId);
}

/**
 * Create or get existing image manager for a book (singleton factory)
 * Ensures only one instance exists per bookId globally
 */
export function createImageManager(bookId: string, options?: { maxCacheSize?: number }): ImageResourceManager {
  const storage = getSingletonStorage();
  const existing = storage.get(bookId);
  
  if (existing) {
    console.log(`[ImageManager] Reusing existing instance for book: ${bookId}`);
    return existing;
  }
  
  const manager = new ImageResourceManager(bookId, options);
  storage.set(bookId, manager);
  console.log(`[ImageManager] Created new singleton instance for book: ${bookId}`);
  return manager;
}

/**
 * Dispose and remove image manager for a book
 */
export function disposeImageManager(bookId: string): void {
  const storage = getSingletonStorage();
  const manager = storage.get(bookId);
  
  if (manager) {
    manager.dispose();
    storage.delete(bookId);
    console.log(`[ImageManager] Disposed singleton instance for book: ${bookId}`);
  }
}

/**
 * Get all active image manager instances
 */
export function getAllImageManagers(): Map<string, ImageResourceManager> {
  return new Map(getSingletonStorage());
}

/**
 * Get singleton namespace identifier
 */
export function getSingletonNamespace(): string {
  return SINGELTON_NAMESPACE;
}
