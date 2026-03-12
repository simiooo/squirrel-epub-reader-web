import React, { useCallback, useRef } from 'react';
import { GestureController, type GestureControllerRef } from './GestureController';
import { GestureCursor } from './GestureCursor';
import { useGestureStore } from '../../stores/gestureStore';

export const GestureOverlay: React.FC = () => {
  const enabled = useGestureStore((state) => state.settings.enabled);
  const cursorPosition = useGestureStore((state) => state.runtime.cursorPosition);
  const gestureState = useGestureStore((state) => state.runtime.state);
  const controllerRef = useRef<GestureControllerRef>(null);

  const handlePinch = useCallback(() => {
    if (cursorPosition) {
      const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y);
      if (element) {
        const clickableElement = element.closest('button, a, [data-gesture-clickable]');
        if (clickableElement) {
          (clickableElement as HTMLElement).click();
        }
      }
    }
  }, [cursorPosition]);

  const handleScroll = useCallback((deltaY: number) => {
    if (gestureState === 'scroll') {
      const scrollable = document.querySelector('[data-gesture-scrollable]') as HTMLElement;
      if (scrollable) {
        scrollable.scrollTop += deltaY;
      } else {
        window.scrollBy(0, deltaY);
      }
    }
  }, [gestureState]);

  return (
    <>
      <GestureController
        ref={controllerRef}
        enabled={enabled}
        onPinch={handlePinch}
        onScroll={handleScroll}
      />
      <GestureCursor position={cursorPosition} state={gestureState} />
    </>
  );
};
