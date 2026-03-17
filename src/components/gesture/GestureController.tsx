import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult, Landmark } from '@mediapipe/tasks-vision';
import { useGestureStore } from '../../stores/gestureStore';
import {
  detectGesture,
  getFingerTipPosition,
  mapToScreenCoordinates,
} from '../../utils/gestureDetector';
import type { GestureState } from '../../stores/gestureStore';
import { setCursorPosition, setCursorState } from '../../utils/cursorManager';

interface GestureControllerProps {
  enabled?: boolean;
  onPinch?: () => void;
  onScroll?: (deltaY: number) => void;
}

const SCROLL_MULTIPLIER = 1.5;
const SCROLL_THROTTLE_MS = 16;
const MAX_SCROLL_DELTA = 50;
const MIN_SCROLL_DELTA = 0.5;
const SCROLL_SMOOTHING = 0.3;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// WASM URLs
const REMOTE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const LOCAL_WASM_URL = '/wasm';

// Model URLs
const REMOTE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const LOCAL_MODEL_URL = '/models/hand_landmarker.task';

// Check if local resource exists
const checkLocalResource = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};

// Initialize vision with retry logic
const initializeVision = async (retryCount = 0, signal?: AbortSignal): Promise<ReturnType<typeof FilesetResolver.forVisionTasks>> => {
  // Try local first, then remote
  const urls = [
    LOCAL_WASM_URL,
    REMOTE_WASM_URL
  ];
  
  for (const url of urls) {
    try {
      if (signal?.aborted) {
        throw new Error('Initialization aborted');
      }
      
      console.log(`[Gesture] Trying WASM from: ${url}`);
      const vision = await FilesetResolver.forVisionTasks(url);
      console.log(`[Gesture] WASM loaded successfully from: ${url}`);
      return vision;
    } catch (error) {
      console.warn(`[Gesture] Failed to load WASM from ${url}:`, error);
      
      // If this is the last URL and we have retries left, try again
      if (url === urls[urls.length - 1] && retryCount < MAX_RETRY_ATTEMPTS) {
        console.log(`[Gesture] Retrying WASM initialization (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        return initializeVision(retryCount + 1, signal);
      }
    }
  }
  
  throw new Error('Failed to initialize WASM from all sources');
};

// Get model URL with fallback
const getModelUrl = async (): Promise<string> => {
  // Check local first
  const hasLocalModel = await checkLocalResource(LOCAL_MODEL_URL);
  if (hasLocalModel) {
    console.log('[Gesture] Using local model');
    return LOCAL_MODEL_URL;
  }
  
  console.log('[Gesture] Using remote CDN model');
  return REMOTE_MODEL_URL;
};

export interface GestureControllerRef {
  cleanup: () => void;
}

export const GestureController = forwardRef<GestureControllerRef, GestureControllerProps>(({
  enabled = false,
  onPinch,
  onScroll,
}, ref) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<GestureState>('idle');
  const lastPinchTimeRef = useRef<number>(0);
  const prevPositionsRef = useRef<{ x: number; y: number }[]>([]);
  const lastVideoTimeRef = useRef<number>(-1);
  const isInitializedRef = useRef(false);
  const isInitializingRef = useRef(false);
  const savedCursorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollVelocityRef = useRef<number>(0);

  const setGestureState = useGestureStore((state) => state.setGestureState);
  const setInitializing = useGestureStore((state) => state.setInitializing);
  const setError = useGestureStore((state) => state.setError);
  const resetRuntime = useGestureStore((state) => state.resetRuntime);
  const updateRuntimeState = useGestureStore((state) => state.updateRuntimeState);

  const onPinchRef = useRef(onPinch);
  const onScrollRef = useRef(onScroll);
  onPinchRef.current = onPinch;
  onScrollRef.current = onScroll;

  const cleanup = useCallback(() => {
    console.log('[Gesture] Cleanup...');

    isInitializedRef.current = false;
    isInitializingRef.current = false;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (handLandmarkerRef.current) {
      try {
        handLandmarkerRef.current.close();
      } catch {
        // ignore
      }
      handLandmarkerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
      localVideoRef.current.pause();
    }

    lastPositionRef.current = null;
    prevPositionsRef.current = [];
    lastGestureRef.current = 'idle';
    lastVideoTimeRef.current = -1;
    savedCursorPositionRef.current = null;

    setCursorState('idle');
    resetRuntime();
  }, [resetRuntime]);

  useImperativeHandle(ref, () => ({
    cleanup,
  }), [cleanup]);

  useEffect(() => {
    if (!enabled) {
      if (isInitializedRef.current || isInitializingRef.current) {
        cleanup();
      }
      return;
    }

    if (isInitializedRef.current || isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;

    let cancelled = false;

    const abortController = new AbortController();

    const initialize = async () => {
      try {
        console.log('[Gesture] Initializing...');
        setInitializing(true);
        setError(null);

        const videoElement = localVideoRef.current;
        if (!videoElement) {
          throw new Error('Video element not found');
        }

        // Initialize WASM with retry logic
        const vision = await initializeVision(0, abortController.signal);

        if (cancelled || abortController.signal.aborted) return;

        // Get model URL (local first, then remote)
        const modelUrl = await getModelUrl();

        if (cancelled || abortController.signal.aborted) return;

        // Try to create hand landmarker with retry logic for model loading
        let handLandmarker: HandLandmarker | null = null;
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
          if (cancelled || abortController.signal.aborted) return;
          
          try {
            if (attempt > 0) {
              console.log(`[Gesture] Retrying model loading (${attempt}/${MAX_RETRY_ATTEMPTS})...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
            
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: modelUrl,
                delegate: 'GPU',
              },
              runningMode: 'VIDEO',
              numHands: 1,
              minHandDetectionConfidence: 0.7,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
            
            // Success!
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(`[Gesture] Model loading attempt ${attempt + 1} failed:`, lastError.message);
            
            // If model URL failed, try the other one
            if (attempt === 0 && modelUrl === LOCAL_MODEL_URL) {
              console.log('[Gesture] Local model failed, trying remote CDN...');
              // Continue with same attempt count but different URL
              try {
                handLandmarker = await HandLandmarker.createFromOptions(vision, {
                  baseOptions: {
                    modelAssetPath: REMOTE_MODEL_URL,
                    delegate: 'GPU',
                  },
                  runningMode: 'VIDEO',
                  numHands: 1,
                  minHandDetectionConfidence: 0.7,
                  minHandPresenceConfidence: 0.5,
                  minTrackingConfidence: 0.5,
                });
                console.log('[Gesture] Remote CDN model loaded successfully');
                break;
              } catch (remoteError) {
                console.warn('[Gesture] Remote model also failed:', remoteError);
              }
            }
          }
        }
        
        if (!handLandmarker) {
          throw lastError || new Error('Failed to initialize hand landmarker after all retries');
        }

        if (cancelled) {
          handLandmarker.close();
          return;
        }

        handLandmarkerRef.current = handLandmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: 'user',
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        videoElement.srcObject = stream;

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => {
            videoElement.removeEventListener('loadeddata', onLoaded);
            resolve();
          };

          videoElement.addEventListener('loadeddata', onLoaded);
          videoElement.play().catch(reject);

          setTimeout(() => {
            videoElement.removeEventListener('loadeddata', onLoaded);
            reject(new Error('Video load timeout'));
          }, 10000);
        });

        if (cancelled) return;

        let frameCount = 0;
        let lastFpsTime = performance.now();

        const processFrame = () => {
          if (!isInitializedRef.current || cancelled) return;

          if (videoElement && handLandmarkerRef.current && videoElement.readyState >= 2) {
            const currentTime = videoElement.currentTime;
            if (currentTime !== lastVideoTimeRef.current) {
              lastVideoTimeRef.current = currentTime;

              try {
                const results: HandLandmarkerResult = handLandmarkerRef.current!.detectForVideo(videoElement, performance.now());

                if (results.landmarks && results.landmarks.length > 0) {
                  const landmarks = results.landmarks[0] as Landmark[];

                  const fingerTip = getFingerTipPosition(landmarks);
                  if (fingerTip && videoElement) {
                    let position = mapToScreenCoordinates(
                      fingerTip,
                      videoElement.videoWidth,
                      videoElement.videoHeight,
                      window.innerWidth,
                      window.innerHeight
                    );

                    if (lastGestureRef.current === 'idle' && savedCursorPositionRef.current) {
                      position = savedCursorPositionRef.current;
                    }

                    setCursorPosition(position.x, position.y);

                    prevPositionsRef.current.push(position);
                    if (prevPositionsRef.current.length > 3) {
                      prevPositionsRef.current.shift();
                    }
                    lastPositionRef.current = position;
                    savedCursorPositionRef.current = position;

                    const { sensitivity, scrollSpeed } = useGestureStore.getState().settings;
                    const gesture = detectGesture(landmarks, sensitivity);

                    if (gesture === 'pinch') {
                      lastGestureRef.current = 'pinch';
                      setCursorState('pinch');
                      setGestureState('pinch', position, true);
                      updateRuntimeState({ lastCursorPosition: position });
                      const now = Date.now();
                      if (now - lastPinchTimeRef.current > 300) {
                        lastPinchTimeRef.current = now;
                        console.log('[Gesture] Pinch triggered at', position);
                        onPinchRef.current?.();
                      }
                    } else if (gesture === 'peace') {
                      if (prevPositionsRef.current.length >= 2) {
                        const now = performance.now();
                        const timeSinceLastScroll = now - lastScrollTimeRef.current;
                        
                        if (timeSinceLastScroll >= SCROLL_THROTTLE_MS) {
                          const prevPos = prevPositionsRef.current[prevPositionsRef.current.length - 2];
                          let rawDelta = (position.y - prevPos.y) * SCROLL_MULTIPLIER * scrollSpeed;
                          
                          rawDelta = Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, rawDelta));
                          
                          scrollVelocityRef.current = scrollVelocityRef.current * (1 - SCROLL_SMOOTHING) + rawDelta * SCROLL_SMOOTHING;
                          
                          const deltaY = Math.abs(scrollVelocityRef.current) >= MIN_SCROLL_DELTA 
                            ? scrollVelocityRef.current 
                            : 0;
                          
                          if (deltaY !== 0) {
                            console.log('[Gesture] Scroll deltaY:', deltaY.toFixed(2));
                            onScrollRef.current?.(deltaY);
                          }
                          
                          lastScrollTimeRef.current = now;
                        }
                      }
                      lastGestureRef.current = 'scroll';
                      setCursorState('scroll');
                      setGestureState('scroll', position, true);
                      updateRuntimeState({ lastCursorPosition: position });
                    } else if (gesture === 'open') {
                      scrollVelocityRef.current = 0;
                      lastGestureRef.current = 'tracking';
                      setCursorState('tracking');
                      setGestureState('tracking', position, true);
                      updateRuntimeState({ lastCursorPosition: position });
                    }
                  }
                } else {
                  if (lastPositionRef.current) {
                    savedCursorPositionRef.current = lastPositionRef.current;
                    updateRuntimeState({ lastCursorPosition: lastPositionRef.current });
                  }
                  prevPositionsRef.current = [];
                  lastGestureRef.current = 'idle';
                  setCursorState('idle');
                  setGestureState('idle', savedCursorPositionRef.current, false);
                }

                frameCount++;
                const now = performance.now();
                if (now - lastFpsTime >= 1000) {
                  console.log('[Gesture] FPS:', frameCount);
                  frameCount = 0;
                  lastFpsTime = now;
                }
              } catch {
                // Ignore processing errors
              }
            }
          }

          if (isInitializedRef.current && !cancelled) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
          }
        };

        isInitializedRef.current = true;
        isInitializingRef.current = false;
        processFrame();

        console.log('[Gesture] Ready!');
        setInitializing(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[Gesture] Init error:', err);
        isInitializingRef.current = false;
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setInitializing(false);
        cleanup();
      }
    };

    initialize();

    return () => {
      cancelled = true;
      abortController.abort();
      cleanup();
    };
  }, [enabled, cleanup, setGestureState, setInitializing, setError, updateRuntimeState]);

  if (!enabled) return null;

  return (
    <video
      ref={localVideoRef}
      style={{ display: 'none' }}
      playsInline
      muted
      autoPlay
    />
  );
});

GestureController.displayName = 'GestureController';
