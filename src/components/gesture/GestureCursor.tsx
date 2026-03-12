import React, { useEffect, useRef } from 'react';
import type { GestureState } from '../../types/gesture';
import { setCursorElement, startHoverCheck, stopHoverCheck } from '../../utils/cursorManager';

interface GestureCursorProps {
  position: { x: number; y: number } | null;
  state: GestureState;
}

const cursorStyles: Record<GestureState, React.CSSProperties> = {
  idle: {
    opacity: 0,
    transform: 'scale(0)',
  },
  tracking: {
    width: 40,
    height: 40,
    border: '3px solid #1890ff',
    borderRadius: '50%',
    background: 'rgba(24, 144, 255, 0.1)',
  },
  pinch: {
    width: 40,
    height: 40,
    border: '3px solid #52c41a',
    borderRadius: '50%',
    background: 'rgba(82, 196, 26, 0.2)',
    animation: 'pulse 0.3s ease',
  },
  scroll: {
    width: 50,
    height: 50,
    border: '3px solid #faad14',
    borderRadius: '8px',
    background: 'rgba(250, 173, 20, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#faad14',
  },
};

export const GestureCursor: React.FC<GestureCursorProps> = ({ position: _position, state }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(0.6); }
        100% { transform: scale(1); }
      }
      .gesture-cursor {
        position: fixed;
        pointer-events: none;
        z-index: 9999;
        will-change: transform, opacity;
        transition: opacity 0.15s ease;
      }
      .gesture-cursor[data-state="tracking"][data-hovering="true"] {
        border-color: #52c41a !important;
        box-shadow: 0 0 12px rgba(82, 196, 26, 0.5);
      }
      .gesture-cursor[data-state="pinch"] {
        border-color: #52c41a !important;
        background: rgba(82, 196, 26, 0.3) !important;
      }
      .gesture-cursor[data-state="scroll"] {
        border-color: #faad14 !important;
        background: rgba(250, 173, 20, 0.2) !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    setCursorElement(containerRef.current);
    if (containerRef.current) {
      startHoverCheck();
    }
    
    return () => {
      setCursorElement(null);
      stopHoverCheck();
    };
  }, []);

  const baseStyle: React.CSSProperties = {
    ...cursorStyles[state],
  };

  return (
    <div
      ref={containerRef}
      className="gesture-cursor"
      data-state={state}
      style={{
        ...baseStyle,
        left: 0,
        top: 0,
      }}
    >
      {state === 'scroll' && '⇕'}
    </div>
  );
};
