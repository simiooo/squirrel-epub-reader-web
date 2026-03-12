/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { GestureSettings, GestureState, GestureRuntimeState } from '../types/gesture';

const STORAGE_KEY = 'squirrel-gesture-settings';

const defaultSettings: GestureSettings = {
  enabled: false,
  sensitivity: 1.0,
  scrollSpeed: 5,
};

const loadSettings = (): GestureSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load gesture settings:', e);
  }
  return defaultSettings;
};

const saveSettings = (settings: GestureSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save gesture settings:', e);
  }
};

export interface GestureSettingsContextValue {
  settings: GestureSettings;
  updateSettings: (settings: Partial<GestureSettings>) => void;
}

export const GestureSettingsContext = createContext<GestureSettingsContextValue | null>(null);

export interface GestureRuntimeContextValue {
  runtimeState: GestureRuntimeState;
  updateGestureState: (state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => void;
}

export const GestureRuntimeContext = createContext<GestureRuntimeContextValue | null>(null);

interface GestureProviderProps {
  children: React.ReactNode;
}

export const GestureProvider: React.FC<GestureProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<GestureSettings>(loadSettings);
  const [runtimeState, setRuntimeState] = useState<GestureRuntimeState>({
    state: 'idle',
    cursorPosition: null,
    isHandDetected: false,
  });

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((newSettings: Partial<GestureSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const updateGestureState = useCallback((state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => {
    setRuntimeState({ state, cursorPosition: position, isHandDetected: handDetected });
  }, []);

  const settingsValue = useMemo<GestureSettingsContextValue>(
    () => ({ settings, updateSettings }),
    [settings, updateSettings]
  );

  const runtimeValue = useMemo<GestureRuntimeContextValue>(
    () => ({ runtimeState, updateGestureState }),
    [runtimeState, updateGestureState]
  );

  return (
    <GestureSettingsContext.Provider value={settingsValue}>
      <GestureRuntimeContext.Provider value={runtimeValue}>
        {children}
      </GestureRuntimeContext.Provider>
    </GestureSettingsContext.Provider>
  );
};
