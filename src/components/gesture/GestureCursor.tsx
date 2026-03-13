import React, { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { GestureState } from '../../stores/gestureStore';
import { setCursorElement, startHoverCheck, stopHoverCheck, handlePinchStart, handlePinchEnd } from '../../utils/cursorManager';

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

const SMOOTHING = 0.18;
const VELOCITY_DECAY = 0.65;
const LOW_PASS_ALPHA = 0.35;
const DEAD_ZONE = 2;
const JITTER_THRESHOLD = 0.5;

export const GestureCursor: React.FC<GestureCursorProps> = ({ position, state }) => {
  const rafRef = useRef<number>(0);
  const posRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const isRunningRef = useRef(false);
  const filteredTargetRef = useRef({ x: 0, y: 0 });
  const lastInputRef = useRef({ x: 0, y: 0 });
  const lockedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const prevStateRef = useRef<GestureState>('idle');

  const updateTarget = useCallback(() => {
    if (position) {
      const isTransitioningToAction = 
        prevStateRef.current === 'tracking' && (state === 'pinch' || state === 'scroll');
      const isReturningToTracking = 
        prevStateRef.current !== 'tracking' && state === 'tracking';

      if (isTransitioningToAction) {
        lockedPositionRef.current = { ...filteredTargetRef.current };
      } else if (isReturningToTracking) {
        lockedPositionRef.current = null;
      }

      prevStateRef.current = state;

      let rawX: number, rawY: number;
      if (lockedPositionRef.current && (state === 'pinch' || state === 'scroll')) {
        rawX = lockedPositionRef.current.x;
        rawY = lockedPositionRef.current.y;
      } else {
        const config = cursorConfigs[state];
        rawX = position.x - config.size / 2;
        rawY = position.y - config.size / 2;
      }

      const dx = rawX - lastInputRef.current.x;
      const dy = rawY - lastInputRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < JITTER_THRESHOLD) {
        targetRef.current = { ...filteredTargetRef.current };
      } else {
        filteredTargetRef.current = {
          x: filteredTargetRef.current.x + (rawX - filteredTargetRef.current.x) * LOW_PASS_ALPHA,
          y: filteredTargetRef.current.y + (rawY - filteredTargetRef.current.y) * LOW_PASS_ALPHA,
        };
        targetRef.current = { ...filteredTargetRef.current };
      }

      lastInputRef.current = { x: rawX, y: rawY };
    }
  }, [position, state]);

  const animateRef = useRef<() => void>(() => {});
  
  const animate = useCallback(() => {
    const el = elRef.current;
    const target = targetRef.current;

    if (el && target) {
      const dx = target.x - posRef.current.x;
      const dy = target.y - posRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > DEAD_ZONE) {
        velRef.current.x = velRef.current.x * VELOCITY_DECAY + dx * SMOOTHING;
        velRef.current.y = velRef.current.y * VELOCITY_DECAY + dy * SMOOTHING;

        posRef.current.x += velRef.current.x;
        posRef.current.y += velRef.current.y;
      }

      el.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`;
    }

    if (isRunningRef.current) {
      rafRef.current = requestAnimationFrame(animateRef.current);
    }
  }, []);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  const setElRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      setCursorElement(el);

      if (el && !isRunningRef.current) {
        isRunningRef.current = true;

        if (targetRef.current) {
          posRef.current = { ...targetRef.current };
        }

        if (el) {
          startHoverCheck();
        }

        rafRef.current = requestAnimationFrame(animateRef.current);
      }
    },
    []
  );

  useEffect(() => {
    updateTarget();
  }, [updateTarget]);

  // 监听手势状态变化，处理捏合手势
  useEffect(() => {
    if (state === 'pinch' && prevStateRef.current !== 'pinch') {
      handlePinchStart();
    } else if (state !== 'pinch' && prevStateRef.current === 'pinch') {
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

  if (state === 'idle' || !position) {
    return null;
  }

  const config = cursorConfigs[state];

  return (
    <motion.div
      ref={setElRef}
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
        willChange: 'transform',
      }}
    >
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
};
