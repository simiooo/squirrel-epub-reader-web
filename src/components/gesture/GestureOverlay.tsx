import React, { useCallback, useRef, useEffect } from 'react';
import { GestureController, type GestureControllerRef } from './GestureController';
import { GestureCursor } from './GestureCursor';
import { useGestureSettings, useGestureRuntime } from '../../contexts/useGestureHooks';

export const GestureOverlay: React.FC = () => {
  const { settings } = useGestureSettings();
  const { runtimeState, updateGestureState } = useGestureRuntime();
  const controllerRef = useRef<GestureControllerRef>(null);
  const prevEnabledRef = useRef(settings.enabled);

  useEffect(() => {
    if (prevEnabledRef.current && !settings.enabled) {
      console.log('[GestureOverlay] Gesture disabled, calling cleanup');
      controllerRef.current?.cleanup();
    }
    prevEnabledRef.current = settings.enabled;
  }, [settings.enabled]);

  const handlePinch = useCallback(() => {
    if (runtimeState.cursorPosition) {
      const element = document.elementFromPoint(runtimeState.cursorPosition.x, runtimeState.cursorPosition.y);
      if (element) {
        const clickableElement = element.closest('button, a, [data-gesture-clickable]');
        if (clickableElement) {
          (clickableElement as HTMLElement).click();
        }
      }
    }
  }, [runtimeState.cursorPosition]);

  const handleScroll = useCallback((deltaY: number) => {
    if (runtimeState.state === 'scroll') {
      const scrollable = document.querySelector('[data-gesture-scrollable]') as HTMLElement;
      if (scrollable) {
        scrollable.scrollTop += deltaY;
      } else {
        window.scrollBy(0, deltaY);
      }
    }
  }, [runtimeState.state]);

  return (
    <>
      <GestureController 
        ref={controllerRef} 
        enabled={settings.enabled}
        onPinch={handlePinch} 
        onScroll={handleScroll} 
        updateGestureState={updateGestureState} 
      />
      <GestureCursor position={runtimeState.cursorPosition} state={runtimeState.state} />
    </>
  );
};
