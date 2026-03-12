export interface GestureSettings {
  enabled: boolean;
  sensitivity: number;
  scrollSpeed: number;
}

export type GestureState = 'idle' | 'tracking' | 'pinch' | 'scroll';

export interface GestureRuntimeState {
  state: GestureState;
  cursorPosition: { x: number; y: number } | null;
  isHandDetected: boolean;
}

export interface GestureSettingsContextValue {
  settings: GestureSettings;
  updateSettings: (settings: Partial<GestureSettings>) => void;
}

export interface GestureRuntimeContextValue {
  runtimeState: GestureRuntimeState;
  updateGestureState: (state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => void;
}

export interface GestureContextValue {
  settings: GestureSettings;
  state: GestureState;
  cursorPosition: { x: number; y: number } | null;
  isHandDetected: boolean;
  updateSettings: (settings: Partial<GestureSettings>) => void;
  updateGestureState: (state: GestureState, position: { x: number; y: number } | null, handDetected: boolean) => void;
}

export interface Point {
  x: number;
  y: number;
}

export interface HandLandmarks {
  landmarks: Point[];
  worldLandmarks: Point[];
}

export type GestureType = 'open' | 'pinch' | 'fist' | 'unknown';
