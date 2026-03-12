import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GestureState = 'idle' | 'tracking' | 'pinch' | 'scroll';

export interface GestureSettings {
  enabled: boolean;
  sensitivity: number;
  scrollSpeed: number;
}

export interface GestureRuntimeState {
  state: GestureState;
  cursorPosition: { x: number; y: number } | null;
  isHandDetected: boolean;
  isInitializing: boolean;
  error: string | null;
}

interface GestureStore {
  // Settings (persisted)
  settings: GestureSettings;
  updateSettings: (settings: Partial<GestureSettings>) => void;
  toggleEnabled: () => void;

  // Runtime state (not persisted)
  runtime: GestureRuntimeState;
  updateRuntimeState: (runtime: Partial<GestureRuntimeState>) => void;
  setGestureState: (state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => void;
  setInitializing: (isInitializing: boolean) => void;
  setError: (error: string | null) => void;
  resetRuntime: () => void;
}

const defaultSettings: GestureSettings = {
  enabled: false,
  sensitivity: 1.0,
  scrollSpeed: 5,
};

const defaultRuntime: GestureRuntimeState = {
  state: 'idle',
  cursorPosition: null,
  isHandDetected: false,
  isInitializing: false,
  error: null,
};

export const useGestureStore = create<GestureStore>()(
  persist(
    (set) => ({
      // Settings
      settings: defaultSettings,
      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },
      toggleEnabled: () => {
        set((state) => ({
          settings: { ...state.settings, enabled: !state.settings.enabled },
        }));
      },

      // Runtime
      runtime: defaultRuntime,
      updateRuntimeState: (newRuntime) => {
        set((state) => ({
          runtime: { ...state.runtime, ...newRuntime },
        }));
      },
      setGestureState: (gestureState, position, handDetected) => {
        set((state) => ({
          runtime: {
            ...state.runtime,
            state: gestureState,
            cursorPosition: position,
            isHandDetected: handDetected,
          },
        }));
      },
      setInitializing: (isInitializing) => {
        set((state) => ({
          runtime: { ...state.runtime, isInitializing },
        }));
      },
      setError: (error) => {
        set((state) => ({
          runtime: { ...state.runtime, error },
        }));
      },
      resetRuntime: () => {
        set({ runtime: defaultRuntime });
      },
    }),
    {
      name: 'squirrel-gesture-store',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);

// Selectors for better performance
export const selectGestureSettings = (state: GestureStore) => state.settings;
export const selectGestureEnabled = (state: GestureStore) => state.settings.enabled;
export const selectGestureRuntime = (state: GestureStore) => state.runtime;
export const selectGestureState = (state: GestureStore) => state.runtime.state;
