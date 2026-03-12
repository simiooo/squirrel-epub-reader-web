import React, { useState, useRef, useCallback } from 'react';
import { useGestureSettings } from '../../contexts/useGestureHooks';

export const GestureCamera: React.FC = () => {
  const { settings } = useGestureSettings();
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const isVisible = settings.enabled;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          width: isMinimized ? 40 : 160,
          height: isMinimized ? 40 : 120,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: '#000',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          transition: 'all 0.3s ease',
        }}
      >
        {isMinimized ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
            }}
          >
            📷
          </div>
        ) : (
          <>
            <div
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                zIndex: 1,
                display: 'flex',
                gap: 4,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(true);
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.7)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}
              >
                −
              </button>
            </div>
          </>
        )}
      </div>
      {isMinimized && (
        <div
          onClick={() => setIsMinimized(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            cursor: 'pointer',
          }}
        />
      )}
    </div>
  );
};
