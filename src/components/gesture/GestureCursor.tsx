import React, { useEffect, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import type { GestureState } from '../../stores/gestureStore';
import { setCursorElement, startHoverCheck, stopHoverCheck, handlePinchStart, handlePinchEnd, setCursorTargetPosition } from '../../utils/cursorManager';

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
} as const;

const JITTER_THRESHOLD = 1.5;

interface CursorVisualProps {
  state: GestureState;
  config: typeof cursorConfigs[keyof typeof cursorConfigs];
}

const CursorVisual = memo(({ state, config }: CursorVisualProps) => {
  return (
    <motion.div
      className="gesture-cursor-visual"
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
        width: config.size,
        height: config.size,
        borderRadius: '50%',
        backgroundColor: config.primaryColor,
        boxShadow: `0 2px 8px ${config.primaryColor}40`,
        position: 'relative',
        willChange: 'transform, width, height, opacity',
      }}
    >
      <div
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
});

export const GestureCursor: React.FC<GestureCursorProps> = memo(({ position, state }) => {
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isRunningRef = useRef(false);
  const positionRef = useRef(position);
  const stateRef = useRef(state);
  const lastPositionRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef(0);

  useEffect(() => {
    positionRef.current = position;
    stateRef.current = state;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const animate = (timestamp: number) => {
      const currentPosition = positionRef.current;
      const currentState = stateRef.current;

      if (!currentPosition) {
        if (isRunningRef.current) {
          rafRef.current = requestAnimationFrame(animate);
        }
        return;
      }

      const config = cursorConfigs[currentState];
      const targetX = currentPosition.x - config.size / 2;
      const targetY = currentPosition.y - config.size / 2;

      const dx = targetX - lastPositionRef.current.x;
      const dy = targetY - lastPositionRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > JITTER_THRESHOLD) {
        lastPositionRef.current = { x: targetX, y: targetY };
        container.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
        // 使用手势输入的中心位置进行 hover 检测
        setCursorTargetPosition(currentPosition.x, currentPosition.y);
      }

      lastTimeRef.current = timestamp;

      if (isRunningRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    if (!isRunningRef.current) {
      isRunningRef.current = true;
      startHoverCheck();
      rafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      isRunningRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const prevState = state === 'pinch' ? 'tracking' : 'pinch';
    if (state === 'pinch') {
      handlePinchStart();
    } else if (prevState === 'pinch') {
      handlePinchEnd();
    }
  }, [state]);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      setCursorElement(null);
      stopHoverCheck();
    };
  }, []);

  const setContainerRef = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    setCursorElement(el);
  };

  if (state === 'idle' || !position) {
    return null;
  }

  const config = cursorConfigs[state];

  return (
    <div
      ref={setContainerRef}
      className="gesture-cursor-container"
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        left: 0,
        top: 0,
        transition: 'transform 60ms ease-out',
        willChange: 'transform',
        contain: 'layout style paint',
      }}
    >
      <CursorVisual state={state} config={config} />
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.state === nextProps.state;
});
