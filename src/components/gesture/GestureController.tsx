import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { useGestureSettings } from '../../contexts/useGestureHooks';
import {
  detectGesture,
  getFingerTipPosition,
  mapToScreenCoordinates,
} from '../../utils/gestureDetector';
import type { GestureState, Point } from '../../types/gesture';
import { setCursorPosition, setCursorState } from '../../utils/cursorManager';
import { getMediaPipeLoaderAsync } from '../../utils/mediaPipeLoader';

interface HandsResults {
  multiHandLandmarks?: Point[][];
  image?: HTMLVideoElement | HTMLImageElement;
}

interface GestureControllerProps {
  enabled?: boolean;
  onPinch?: () => void;
  onScroll?: (deltaY: number) => void;
  updateGestureState: (state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => void;
}

const SCROLL_MULTIPLIER = 5;

let frameCount = 0;
let lastFpsTime = performance.now();

export interface GestureControllerRef {
  cleanup: () => void;
}

export const GestureController = forwardRef<GestureControllerRef, GestureControllerProps>(({
  enabled = true,
  onPinch,
  onScroll,
  updateGestureState,
}, ref) => {
  const { settings } = useGestureSettings();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const handsRef = useRef<unknown>(null);
  const cameraRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<GestureState>('idle');
  const lastPinchTimeRef = useRef<number>(0);
  const prevPositionsRef = useRef<{ x: number; y: number }[]>([]);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const isInitializedRef = useRef(false);
  const isRunningRef = useRef(false);

  const handlePinch = useCallback(() => {
    const now = Date.now();
    if (now - lastPinchTimeRef.current > 300) {
      lastPinchTimeRef.current = now;
      onPinch?.();
    }
  }, [onPinch]);

  const cleanup = useCallback(() => {
    isRunningRef.current = false;
    
    if (cameraRef.current) {
      (cameraRef.current as { stop: () => void }).stop();
      cameraRef.current = null;
    }
    if (handsRef.current) {
      (handsRef.current as { close: () => Promise<void> }).close();
      handsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    isInitializedRef.current = false;
  }, []);

  useImperativeHandle(ref, () => ({
    cleanup,
  }), [cleanup]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    if (initPromiseRef.current || isInitializedRef.current) {
      return;
    }

    const initPromise = (async () => {
      try {
        console.log('[Gesture] Initializing MediaPipe loader...');
        
        const loader = await getMediaPipeLoaderAsync();
        
        if (!enabled) return;
        
        console.log('[Gesture] MediaPipe scripts loaded');

        const HandsClass = loader.getHandsClass();
        
        if (!HandsClass) {
          console.error('[Gesture] Hands class not found');
          setError('Failed to load MediaPipe Hands');
          return;
        }

        const modelBaseUrl = loader.getModelBaseUrl();
        
        isRunningRef.current = true;
        
        console.log('[Gesture] Creating Hands instance...');
        const hands = new HandsClass({
          locateFile: (file: string) => `${modelBaseUrl}/${file}`,
        }) as {
          setOptions: (options: Record<string, unknown>) => void;
          onResults: (callback: (results: HandsResults) => void) => void;
          send: (input: { image: HTMLVideoElement | HTMLCanvasElement }) => Promise<void>;
          close: () => Promise<void>;
        };

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results: HandsResults) => {
          if (!isRunningRef.current) return;
          
          frameCount++;
          const now = performance.now();
          if (now - lastFpsTime >= 1000) {
            console.log('[Gesture] FPS:', frameCount);
            frameCount = 0;
            lastFpsTime = now;
          }

          if (!localVideoRef.current) return;

          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];

            if (isRunningRef.current && enabled) {
              const fingerTip = getFingerTipPosition(landmarks);
              if (fingerTip && localVideoRef.current) {
                const position = mapToScreenCoordinates(
                  fingerTip,
                  localVideoRef.current.videoWidth,
                  localVideoRef.current.videoHeight,
                  window.innerWidth,
                  window.innerHeight
                );

                setCursorPosition(position.x, position.y);

                prevPositionsRef.current.push(position);
                if (prevPositionsRef.current.length > 3) prevPositionsRef.current.shift();
                lastPositionRef.current = position;

                const gesture = detectGesture(landmarks, settings.sensitivity);

                if (gesture === 'pinch') {
                  lastGestureRef.current = 'pinch';
                  setCursorState('pinch');
                  updateGestureState('pinch', position, true);
                  handlePinch();
                } else if (gesture === 'fist') {
                  if (lastGestureRef.current !== 'scroll' && lastPositionRef.current) {
                    const prevPos = prevPositionsRef.current[prevPositionsRef.current.length - 2];
                    if (prevPos) {
                      const deltaY = (position.y - prevPos.y) * SCROLL_MULTIPLIER * settings.scrollSpeed;
                      onScroll?.(deltaY);
                    }
                  }
                  lastGestureRef.current = 'scroll';
                  setCursorState('scroll');
                  updateGestureState('scroll', position, true);
                } else if (gesture === 'open') {
                  lastGestureRef.current = 'tracking';
                  setCursorState('tracking');
                  updateGestureState('tracking', position, true);
                }
              }
            }
          } else {
            lastPositionRef.current = null;
            prevPositionsRef.current = [];
            lastGestureRef.current = 'idle';
            setCursorState('idle');
            updateGestureState('idle', null, false);
          }
        });

        handsRef.current = hands;

        console.log('[Gesture] Creating Camera instance...');
        
        const CameraClass = loader.getCameraClass();

        if (!CameraClass) {
          console.warn('[Gesture] Camera class not found, falling back to manual frame processing');
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
            audio: false,
          });
        
          
          streamRef.current = stream;
          
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
            await localVideoRef.current.play();
            
            const processFrame = async () => {
              if (!isRunningRef.current || !handsRef.current || !localVideoRef.current) return;
              try {
                await (handsRef.current as { send: (input: { image: HTMLVideoElement }) => Promise<void> }).send({ image: localVideoRef.current });
              } catch (_e) {
                // ignore
              }
              if (isRunningRef.current) {
                requestAnimationFrame(processFrame);
              }
            };
            
            console.log('[Gesture] Ready!');
            isInitializedRef.current = true;
            processFrame();
          }
          return;
        }

        const camera = new CameraClass(localVideoRef.current!, {
          onFrame: async () => {
            if (!isRunningRef.current || !handsRef.current || !localVideoRef.current) return;
            try {
              await (handsRef.current as { send: (input: { image: HTMLVideoElement }) => Promise<void> }).send({ image: localVideoRef.current });
            } catch (_e) {
              // ignore
            }
          },
          width: 320,
          height: 240,
        });

        cameraRef.current = camera;

        console.log('[Gesture] Starting camera...');
        await camera.start();
        console.log('[Gesture] Ready!');
        isInitializedRef.current = true;
      } catch (err) {
        console.error('[Gesture] Init error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = initPromise;

    return () => {
      cleanup();
    };
  }, [enabled, settings.sensitivity, settings.scrollSpeed, handlePinch, onScroll, cleanup, updateGestureState]);

  if (!enabled) return null;

  return (
    <>
      {error && (
        <div style={{
          position: 'absolute', right: 16, bottom: 16,
          padding: 8, fontSize: 11, color: '#c00', zIndex: 1001,
        }}>
          {error}
        </div>
      )}
      <video
        ref={localVideoRef}
        style={{ display: 'none' }}
        playsInline muted autoPlay
      />
    </>
  );
});
