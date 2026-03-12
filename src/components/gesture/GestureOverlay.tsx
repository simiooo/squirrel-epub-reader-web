import React, { useCallback, useRef } from 'react';
import { GestureController, type GestureControllerRef } from './GestureController';
import { GestureCursor } from './GestureCursor';
import { useGestureStore } from '../../stores/gestureStore';

export const GestureOverlay: React.FC = () => {
  const enabled = useGestureStore((state) => state.settings.enabled);
  const cursorPosition = useGestureStore((state) => state.runtime.cursorPosition);
  const lastCursorPosition = useGestureStore((state) => state.runtime.lastCursorPosition);
  const gestureState = useGestureStore((state) => state.runtime.state);
  const controllerRef = useRef<GestureControllerRef>(null);

  const handlePinch = useCallback(() => {
    const position = cursorPosition || lastCursorPosition;
    if (position) {
      console.log('[GestureOverlay] Pinch at position:', position);
      const element = document.elementFromPoint(position.x, position.y);
      console.log('[GestureOverlay] Element under cursor:', element?.tagName, element?.className);
      if (element) {
        const clickableElement = element.closest('button, a, [data-gesture-clickable], [role="treeitem"], .ant-tree-node-content-wrapper');
        console.log('[GestureOverlay] Clickable element:', clickableElement?.tagName, clickableElement?.className);
        if (clickableElement) {
          console.log('[GestureOverlay] Clicking element');
          (clickableElement as HTMLElement).click();
        }
      }
    }
  }, [cursorPosition, lastCursorPosition]);

  const handleScroll = useCallback((deltaY: number) => {
    const position = cursorPosition || lastCursorPosition;
    if (position) {
      const element = document.elementFromPoint(position.x, position.y);
      if (element) {
        const scrollable = element.closest('[data-gesture-scrollable]') as HTMLElement;
        if (scrollable) {
          console.log('[GestureOverlay] Scrolling element, deltaY:', deltaY);
          scrollable.scrollTop += deltaY;
          return;
        }
      }
      console.log('[GestureOverlay] No scrollable found, scrolling window');
      window.scrollBy(0, deltaY);
    }
  }, [cursorPosition, lastCursorPosition]);

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
