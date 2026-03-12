import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { GestureState } from '../../types/gesture';
import { setCursorElement, startHoverCheck, stopHoverCheck } from '../../utils/cursorManager';

interface GestureCursorProps {
  position: { x: number; y: number } | null;
  state: GestureState;
}

const cursorConfigs = {
  idle: {
    primaryColor: 'var(--antd-color-primary, #007AFF)',
    size: 0,
    opacity: 0,
  },
  tracking: {
    primaryColor: 'var(--antd-color-primary, #007AFF)',
    size: 20,
    opacity: 0.6,
  },
  pinch: {
    primaryColor: 'var(--antd-color-success, #34C759)',
    size: 28,
    opacity: 0.8,
  },
  scroll: {
    primaryColor: 'var(--antd-color-warning, #FF9500)',
    size: 24,
    opacity: 0.7,
  },
};

export const GestureCursor: React.FC<GestureCursorProps> = ({ state }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'idle') {
      setCursorElement(containerRef.current);
      if (containerRef.current) {
        startHoverCheck();
      }
    }

    return () => {
      setCursorElement(null);
      stopHoverCheck();
    };
  }, [state]);

  if (state === 'idle') {
    return null;
  }

  const config = cursorConfigs[state];

  return (
    <motion.div
      ref={containerRef}
      className="gesture-cursor"
      data-state={state}
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: config.opacity,
        width: config.size,
        height: config.size,
      }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{
        type: 'spring',
        stiffness: 500,
        damping: 30,
        mass: 0.5,
      }}
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        left: 0,
        top: 0,
        borderRadius: '50%',
        backgroundColor: config.primaryColor,
        boxShadow: `0 2px 8px ${config.primaryColor}40`,
      }}
    >
      {/* iPad-style subtle inner highlight */}
      <motion.div
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          right: 2,
          bottom: 2,
          borderRadius: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%)',
        }}
      />

      {/* Pinch state: outer ring */}
      {state === 'pinch' && (
        <motion.div
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'easeOut',
          }}
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: `1.5px solid ${config.primaryColor}`,
          }}
        />
      )}

      {/* Scroll state: subtle vertical elongation effect */}
      {state === 'scroll' && (
        <motion.div
          animate={{ scaleY: [1, 1.2, 1] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            backgroundColor: 'inherit',
          }}
        />
      )}
    </motion.div>
  );
};
