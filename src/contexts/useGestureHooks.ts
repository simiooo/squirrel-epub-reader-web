import { useContext } from 'react';
import type { GestureSettingsContextValue, GestureRuntimeContextValue, GestureContextValue } from '../types/gesture';
import { GestureSettingsContext, GestureRuntimeContext } from './GestureContext';

export const useGesture = (): GestureContextValue => {
  const settingsContext = useContext(GestureSettingsContext);
  const runtimeContext = useContext(GestureRuntimeContext);
  if (!settingsContext || !runtimeContext) {
    throw new Error('useGesture must be used within a GestureProvider');
  }
  return {
    ...settingsContext,
    ...runtimeContext.runtimeState,
    updateGestureState: runtimeContext.updateGestureState,
  };
};

export const useGestureSettings = (): GestureSettingsContextValue => {
  const context = useContext(GestureSettingsContext);
  if (!context) {
    throw new Error('useGestureSettings must be used within a GestureProvider');
  }
  return context;
};

export const useGestureRuntime = (): GestureRuntimeContextValue => {
  const context = useContext(GestureRuntimeContext);
  if (!context) {
    throw new Error('useGestureRuntime must be used within a GestureProvider');
  }
  return context;
};
