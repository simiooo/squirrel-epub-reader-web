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
    // 拇指：比较指尖(4)与食指根部(5)的距离来判断是否伸展
    const indexMcp = getLandmarkPosition(landmarks, 5);
    const distance = calculateDistance(tip, indexMcp);
    return distance > 0.15;
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

  const indexExtended = isFingerExtended(landmarks, 1);
  const middleExtended = isFingerExtended(landmarks, 2);
  const ringExtended = isFingerExtended(landmarks, 3);
  const pinkyExtended = isFingerExtended(landmarks, 4);
  const thumbExtended = isFingerExtended(landmarks, 0);

  const fingersExtendedCount = [
    thumbExtended,
    indexExtended,
    middleExtended,
    ringExtended,
    pinkyExtended,
  ].filter(Boolean).length;

  // 和平手势：食指和中指树立，拇指、无名指、小指收起
  if (indexExtended && middleExtended && !thumbExtended && !ringExtended && !pinkyExtended) {
    return 'peace';
  }

  const allFingersExtended = [
    indexExtended,
    middleExtended,
    ringExtended,
    pinkyExtended,
  ].every(Boolean);

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
