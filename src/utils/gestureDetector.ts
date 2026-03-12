import type { GestureType } from '../types/gesture';
import type { Landmark } from '@mediapipe/tasks-vision';

export interface Point {
  x: number;
  y: number;
  z?: number;
}

const FINGER_TIP_INDICES = [4, 8, 12, 16, 20];
const FINGER_PIP_INDICES = [2, 6, 10, 14, 18];
const MOVEMENT_SCALE_X = 1.8;
const MOVEMENT_SCALE_Y = 1.8;

export const getLandmarkPosition = (landmarks: Point[] | Landmark[], index: number): Point => {
  const landmark = landmarks[index];
  if (!landmark) return { x: 0, y: 0 };
  return { x: landmark.x, y: landmark.y, z: 'z' in landmark ? landmark.z : undefined };
};

export const calculateDistance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const isFingerExtended = (landmarks: Point[] | Landmark[], fingerIndex: number): boolean => {
  const tip = getLandmarkPosition(landmarks, FINGER_TIP_INDICES[fingerIndex]);
  const pip = getLandmarkPosition(landmarks, FINGER_PIP_INDICES[fingerIndex]);
  
  if (fingerIndex === 0) {
    return tip.x !== pip.x || Math.abs(tip.y - pip.y) > 0.1;
  }
  
  return tip.y < pip.y;
};

export const detectGesture = (landmarks: Point[] | Landmark[], sensitivity: number = 1.0): GestureType => {
  if (!landmarks || landmarks.length < 21) {
    return 'unknown';
  }

  const thumbTip = getLandmarkPosition(landmarks, 4);
  const indexTip = getLandmarkPosition(landmarks, 8);

  const thumbIndexDistance = calculateDistance(thumbTip, indexTip);
  const pinchThreshold = 0.05 / sensitivity;

  if (thumbIndexDistance < pinchThreshold) {
    return 'pinch';
  }

  const allFingersExtended = [
    isFingerExtended(landmarks, 1),
    isFingerExtended(landmarks, 2),
    isFingerExtended(landmarks, 3),
    isFingerExtended(landmarks, 4),
  ].every(Boolean);

  const thumbExtended = isFingerExtended(landmarks, 0);
  const fingersExtendedCount = [
    thumbExtended,
    isFingerExtended(landmarks, 1),
    isFingerExtended(landmarks, 2),
    isFingerExtended(landmarks, 3),
    isFingerExtended(landmarks, 4),
  ].filter(Boolean).length;

  if (fingersExtendedCount >= 4 && allFingersExtended) {
    return 'open';
  }

  if (fingersExtendedCount <= 1) {
    return 'fist';
  }

  return 'open';
};

export const getFingerTipPosition = (landmarks: Point[] | Landmark[]): Point | null => {
  if (!landmarks || landmarks.length < 9) {
    return null;
  }
  return getLandmarkPosition(landmarks, 8);
};

export const mapToScreenCoordinates = (
  landmarkPoint: Point,
  _videoWidth: number,
  _videoHeight: number,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number } => {
  const rawX = (1 - landmarkPoint.x) * screenWidth;
  const rawY = landmarkPoint.y * screenHeight;
  
  const centerX = screenWidth / 2;
  const centerY = screenHeight / 2;
  
  const scaledX = centerX + (rawX - centerX) * MOVEMENT_SCALE_X;
  const scaledY = centerY + (rawY - centerY) * MOVEMENT_SCALE_Y;

  return {
    x: Math.max(0, Math.min(screenWidth, scaledX)),
    y: Math.max(0, Math.min(screenHeight, scaledY)),
  };
};
