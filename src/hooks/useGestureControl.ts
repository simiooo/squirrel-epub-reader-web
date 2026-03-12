import { useCallback, useRef } from 'react';
import { useGestureSettings } from '../contexts/useGestureHooks';
import type { GestureType } from '../types/gesture';

interface GestureControlCallbacks {
  onPinch?: () => void;
  onScroll?: (deltaY: number) => void;
}

const SCROLL_MULTIPLIER = 5;

export const useGestureControl = (callbacks?: GestureControlCallbacks) => {
  const { settings, updateSettings } = useGestureSettings();
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const currentGestureRef = useRef<GestureType>('unknown');

  const handleGesture = useCallback(
    (gesture: GestureType, position: { x: number; y: number } | null) => {
      if (!settings.enabled) return;

      if (position && lastPositionRef.current) {
        const deltaY = (position.y - lastPositionRef.current.y) * SCROLL_MULTIPLIER * (settings.scrollSpeed / 5);

        if (currentGestureRef.current === 'fist' && deltaY !== 0) {
          callbacks?.onScroll?.(deltaY);
        }
      }

      if (position) {
        lastPositionRef.current = position;
      }

      currentGestureRef.current = gesture;

      if (gesture === 'pinch') {
        callbacks?.onPinch?.();
      }
    },
    [settings.enabled, settings.scrollSpeed, callbacks]
  );

  const resetPosition = useCallback(() => {
    lastPositionRef.current = null;
  }, []);

  const toggleEnabled = useCallback(() => {
    updateSettings({ enabled: !settings.enabled });
  }, [settings.enabled, updateSettings]);

  return {
    enabled: settings.enabled,
    sensitivity: settings.sensitivity,
    scrollSpeed: settings.scrollSpeed,
    handleGesture,
    resetPosition,
    toggleEnabled,
    updateSettings,
  };
};
