let cursorElement: HTMLElement | null = null;
let hoverCheckRafId: number | null = null;
let isHoveringClickable = false;
let lastHoveredCard: HTMLElement | null = null;
let lastHoveredButton: HTMLElement | null = null;
let pinchStartTime: number | null = null;
let isPinching = false;
let cursorPosition: { x: number; y: number } | null = null;

// 连续帧验证
let pendingCard: HTMLElement | null = null;
let pendingButton: HTMLElement | null = null;
let confirmationFrames = 0;
const REQUIRED_CONFIRMATION_FRAMES = 3; // 需要连续3帧检测到相同元素才确认

const PINCH_DURATION_THRESHOLD = 500; // 捏合手势持续时间阈值（毫秒）

export const setCursorTargetPosition = (x: number, y: number) => {
  cursorPosition = { x, y };
};

// 直接触发一次 hover 检测（供外部调用）
export const checkHoverAtPosition = (x: number, y: number) => {
  if (!cursorElement) return;
  
  // 临时隐藏光标以获得准确检测
  cursorElement.style.visibility = 'hidden';
  
  const element = document.elementFromPoint(x, y);
  
  cursorElement.style.visibility = '';
  
  // 检测书籍卡片和按钮
  const detectedCard = element?.closest('.book-card') as HTMLElement | null;
  const detectedButton = element?.closest('[data-gesture-clickable], button, a, .ant-btn, .ant-btn-icon-only') as HTMLElement | null;
  
  // 直接应用 hover 状态，不需要连续帧验证
  applyHoverState(detectedCard, detectedButton);
};

export const setCursorElement = (el: HTMLElement | null) => {
  cursorElement = el;
};

export const setCursorPosition = (x: number, y: number) => {
  if (cursorElement) {
    cursorElement.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
  }
};

export const setCursorState = (state: string) => {
  if (cursorElement) {
    cursorElement.dataset.state = state;
    cursorElement.style.opacity = state === 'idle' ? '0' : '1';
    if (state === 'idle') {
      cursorElement.style.transform = 'scale(0)';
    }
  }
};

const triggerClick = (element: HTMLElement) => {
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
  });
  element.dispatchEvent(clickEvent);
  
  element.classList.add('gesture-clicked');
  setTimeout(() => {
    element.classList.remove('gesture-clicked');
  }, 200);
};

const getElementAtCursor = (x: number, y: number): Element | null => {
  // 暂时隐藏光标以获得准确检测
  if (cursorElement) {
    cursorElement.style.visibility = 'hidden';
  }
  
  const element = document.elementFromPoint(x, y);
  
  if (cursorElement) {
    cursorElement.style.visibility = '';
  }
  
  return element;
};

// 应用hover状态变更
const applyHoverState = (newCard: HTMLElement | null, newButton: HTMLElement | null) => {
  // 更新卡片hover状态
  if (newCard !== lastHoveredCard) {
    if (lastHoveredCard) {
      lastHoveredCard.classList.remove('gesture-hover');
    }
    
    if (newCard) {
      newCard.classList.add('gesture-hover');
    }
    
    lastHoveredCard = newCard;
  }
  
  // 更新按钮hover状态
  if (newButton !== lastHoveredButton) {
    if (lastHoveredButton) {
      lastHoveredButton.classList.remove('gesture-button-hover');
    }
    
    if (newButton) {
      newButton.classList.add('gesture-button-hover');
    }
    
    lastHoveredButton = newButton;
  }
  
  // 更新可点击状态指示器
  const newIsHovering = !!(newButton);
  if (newIsHovering !== isHoveringClickable && cursorElement) {
    isHoveringClickable = newIsHovering;
    cursorElement.dataset.hovering = String(isHoveringClickable);
  }
};

const checkHover = () => {
  if (!cursorElement || !cursorPosition) return;
  
  const centerX = cursorPosition.x;
  const centerY = cursorPosition.y;
  
  // 获取光标下的元素
  const element = getElementAtCursor(centerX, centerY);
  
  // 检测书籍卡片和按钮
  const detectedCard = element?.closest('.book-card') as HTMLElement | null;
  const detectedButton = element?.closest('[data-gesture-clickable], button, a, .ant-btn, .ant-btn-icon-only') as HTMLElement | null;
  
  // 连续帧验证
  const isSameAsPending = detectedCard === pendingCard && detectedButton === pendingButton;
  
  if (isSameAsPending) {
    confirmationFrames++;
    
    // 只有连续多帧检测到相同元素才确认
    if (confirmationFrames >= REQUIRED_CONFIRMATION_FRAMES) {
      applyHoverState(detectedCard, detectedButton);
    }
  } else {
    // 检测到不同元素，重置计数
    pendingCard = detectedCard;
    pendingButton = detectedButton;
    confirmationFrames = 1;
    
    // 如果之前没有hover任何元素，立即应用（为了响应速度）
    if (!lastHoveredCard && !lastHoveredButton) {
      applyHoverState(detectedCard, detectedButton);
      confirmationFrames = REQUIRED_CONFIRMATION_FRAMES;
    }
  }
  
  hoverCheckRafId = requestAnimationFrame(checkHover);
};

export const startHoverCheck = () => {
  if (!hoverCheckRafId && cursorElement) {
    // 重置状态
    pendingCard = null;
    pendingButton = null;
    confirmationFrames = 0;
    checkHover();
  }
};

export const stopHoverCheck = () => {
  if (hoverCheckRafId) {
    cancelAnimationFrame(hoverCheckRafId);
    hoverCheckRafId = null;
  }
  
  // 重置状态
  pendingCard = null;
  pendingButton = null;
  confirmationFrames = 0;
  
  // 清理hover状态
  if (lastHoveredCard) {
    lastHoveredCard.classList.remove('gesture-hover');
    lastHoveredCard = null;
  }
  if (lastHoveredButton) {
    lastHoveredButton.classList.remove('gesture-button-hover');
    lastHoveredButton = null;
  }
  
  isHoveringClickable = false;
};

// 处理捏合手势（点击）
export const handlePinchStart = () => {
  if (isPinching) return;
  
  isPinching = true;
  pinchStartTime = Date.now();
  
  if (cursorElement) {
    cursorElement.classList.add('pinching');
  }
};

export const handlePinchEnd = () => {
  if (!isPinching) return;
  
  const pinchDuration = Date.now() - (pinchStartTime || 0);
  
  if (pinchDuration >= PINCH_DURATION_THRESHOLD && lastHoveredButton) {
    triggerClick(lastHoveredButton);
  }
  
  isPinching = false;
  pinchStartTime = null;
  
  if (cursorElement) {
    cursorElement.classList.remove('pinching');
  }
};

export const isHoveringCard = () => !!lastHoveredCard;
export const isHoveringButton = () => !!lastHoveredButton;
export const getHoveredCard = () => lastHoveredCard;
export const getHoveredButton = () => lastHoveredButton;
