let cursorElement: HTMLElement | null = null;
let hoverCheckRafId: number | null = null;
let isHoveringClickable = false;

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

const checkHover = () => {
  if (!cursorElement) return;
  
  const rect = cursorElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const element = document.elementFromPoint(centerX, centerY);
  const newIsHovering = !!(
    element?.closest('[data-gesture-clickable]') ||
    element?.tagName === 'BUTTON' ||
    element?.tagName === 'A' ||
    element?.closest('button') ||
    element?.closest('a')
  );
  
  if (newIsHovering !== isHoveringClickable) {
    isHoveringClickable = newIsHovering;
    cursorElement.dataset.hovering = String(isHoveringClickable);
  }
  
  hoverCheckRafId = requestAnimationFrame(checkHover);
};

export const startHoverCheck = () => {
  if (!hoverCheckRafId && cursorElement) {
    checkHover();
  }
};

export const stopHoverCheck = () => {
  if (hoverCheckRafId) {
    cancelAnimationFrame(hoverCheckRafId);
    hoverCheckRafId = null;
  }
};
