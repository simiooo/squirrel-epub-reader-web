type LoadCallback = () => void;
type ErrorCallback = (error: Error) => void;

interface ScriptInfo {
  loaded: boolean;
  loading: boolean;
  loadPromise: Promise<void> | null;
  callbacks: LoadCallback[];
  errorCallbacks: ErrorCallback[];
}

const SCRIPT_CONFIG = [
  { key: 'hands', url: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js' },
  { key: 'camera_utils', url: 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js' },
  { key: 'drawing_utils', url: 'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js' },
];

class MediaPipeLoader {
  private scripts: Map<string, ScriptInfo> = new Map();
  private modelBaseUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240';
  private loadingModel = false;
  private modelLoadPromise: Promise<void> | null = null;
  private modelLoaded = false;
  private modelCallbacks: LoadCallback[] = [];
  private modelErrorCallbacks: ErrorCallback[] = [];
  private allScriptsPromise: Promise<void> | null = null;

  constructor() {
    SCRIPT_CONFIG.forEach(({ key }) => {
      this.scripts.set(key, {
        loaded: false,
        loading: false,
        loadPromise: null,
        callbacks: [],
        errorCallbacks: [],
      });
    });
  }

  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(script);
    });
  }

  loadScriptWithCallback(key: string, onLoad: LoadCallback, onError?: ErrorCallback): void {
    const info = this.scripts.get(key);
    if (!info) {
      onError?.(new Error(`Unknown script: ${key}`));
      return;
    }

    if (info.loaded) {
      setTimeout(onLoad, 0);
      return;
    }

    info.callbacks.push(onLoad);
    if (onError) {
      info.errorCallbacks.push(onError);
    }

    if (info.loading && info.loadPromise) {
      return;
    }

    const config = SCRIPT_CONFIG.find(s => s.key === key);
    if (!config) {
      const err = new Error(`Script config not found: ${key}`);
      info.errorCallbacks.forEach(cb => cb(err));
      info.callbacks = [];
      info.errorCallbacks = [];
      return;
    }

    info.loading = true;
    info.loadPromise = this.loadScript(config.url)
      .then(() => {
        info.loaded = true;
        info.loading = false;
        info.callbacks.forEach(cb => cb());
        info.callbacks = [];
        info.errorCallbacks = [];
      })
      .catch((err) => {
        info.loading = false;
        info.loadPromise = null;
        info.errorCallbacks.forEach(cb => cb(err));
        info.callbacks = [];
        info.errorCallbacks = [];
      });
  }

  async loadAllScripts(): Promise<void> {
    if (this.allScriptsPromise) {
      return this.allScriptsPromise;
    }

    const loadPromises = SCRIPT_CONFIG.map(({ key }) => {
      return new Promise<void>((resolve, reject) => {
        this.loadScriptWithCallback(key, resolve, reject);
      });
    });

    this.allScriptsPromise = Promise.all(loadPromises)
      .then(() => {
        this.allScriptsPromise = null;
      })
      .catch((err) => {
        this.allScriptsPromise = null;
        throw err;
      });

    return this.allScriptsPromise;
  }

  isScriptLoaded(key: string): boolean {
    return this.scripts.get(key)?.loaded ?? false;
  }

  setModelBaseUrl(url: string): void {
    this.modelBaseUrl = url;
  }

  getModelBaseUrl(): string {
    return this.modelBaseUrl;
  }

  async loadModelFiles(onProgress?: (progress: number) => void): Promise<void> {
    if (this.modelLoaded) {
      return;
    }

    if (this.modelLoadPromise) {
      return this.modelLoadPromise;
    }

    this.modelLoadPromise = (async () => {
      const modelFiles = ['hand_landmark.tflite', 'hands.tflite'];
      const total = modelFiles.length;

      for (let i = 0; i < modelFiles.length; i++) {
        const file = modelFiles[i];
        try {
          await fetch(`${this.modelBaseUrl}/${file}`);
          onProgress?.(((i + 1) / total) * 100);
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Model loading failed');
          this.modelErrorCallbacks.forEach(cb => cb(error));
          this.modelCallbacks = [];
          this.modelErrorCallbacks = [];
          throw error;
        }
      }

      this.modelLoaded = true;
      this.modelCallbacks.forEach(cb => cb());
      this.modelCallbacks = [];
      this.modelErrorCallbacks = [];
    })();

    const result = this.modelLoadPromise;
    this.modelLoadPromise = null;
    return result;
  }

  isModelLoaded(): boolean {
    return this.modelLoaded;
  }

  getHandsClass(): typeof Hands | undefined {
    if (!this.scripts.get('hands')?.loaded) return undefined;
    return (window as unknown as { Hands?: typeof Hands }).Hands ?? (window as unknown as { MediaPipeHands?: typeof Hands }).MediaPipeHands;
  }

  getCameraClass(): typeof Camera | undefined {
    if (!this.scripts.get('camera_utils')?.loaded) return undefined;
    return (window as unknown as { Camera?: typeof Camera }).Camera ?? (window as unknown as { MediaPipeCameraUtils?: { Camera?: typeof Camera } }).MediaPipeCameraUtils?.Camera;
  }

  getDrawingUtils(): unknown {
    return (window as unknown as { drawingUtils?: unknown }).drawingUtils;
  }
}

let mediaPipeLoaderInstance: MediaPipeLoader | null = null;
let initPromise: Promise<MediaPipeLoader> | null = null;

export function getMediaPipeLoader(): MediaPipeLoader {
  if (mediaPipeLoaderInstance) {
    return mediaPipeLoaderInstance;
  }

  if (initPromise) {
    throw new Error('MediaPipeLoader is being initialized, please await getMediaPipeLoaderAsync()');
  }

  mediaPipeLoaderInstance = new MediaPipeLoader();
  return mediaPipeLoaderInstance;
}

export async function initMediaPipeLoader(): Promise<MediaPipeLoader> {
  if (mediaPipeLoaderInstance) {
    return mediaPipeLoaderInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const loader = new MediaPipeLoader();
    
    await loader.loadAllScripts();
    
    mediaPipeLoaderInstance = loader;
    initPromise = null;
    
    return loader;
  })();

  return initPromise;
}

export async function getMediaPipeLoaderAsync(): Promise<MediaPipeLoader> {
  if (mediaPipeLoaderInstance) {
    return mediaPipeLoaderInstance;
  }
  return initMediaPipeLoader();
}

export type { MediaPipeLoader };
