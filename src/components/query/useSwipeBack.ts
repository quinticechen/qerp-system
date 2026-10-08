import { useRef, type RefObject, type TouchEvent } from 'react';

// Movement before the gesture is classified as a horizontal drag or a scroll
const DECIDE_DISTANCE_PX = 10;
// Release past this share of the panel width, or faster than this, closes it
const CLOSE_RATIO = 0.3;
const CLOSE_VELOCITY_PX_PER_MS = 0.5;

interface Gesture {
  startX: number;
  startY: number;
  startTime: number;
  /** null until the first few pixels decide between drag (true) and scroll (false) */
  dragging: boolean | null;
}

interface SwipeBackHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

/** True when the touch began inside something that scrolls sideways (a wide table), or in the input. */
function startsInHorizontalScroller(target: EventTarget, panel: HTMLElement): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== panel) {
    if (el.tagName === 'TEXTAREA') return true;
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Swipe-right-to-go-back for a full-screen panel: the panel follows the finger, and on release
 * it either slides off and calls onBack, or springs back. The panel needs `touch-action: pan-y`
 * so the browser leaves horizontal moves to this handler.
 */
export function useSwipeBack(panelRef: RefObject<HTMLElement>, onBack: () => void): SwipeBackHandlers {
  const gesture = useRef<Gesture | null>(null);

  const settle = (panel: HTMLElement, transform: string) => {
    panel.style.transition = '';
    panel.style.transform = transform;
    if (transform) {
      // Hand the final position back to the open/closed classes once the slide finishes
      panel.addEventListener('transitionend', () => { panel.style.transform = ''; }, { once: true });
    }
  };

  return {
    onTouchStart: (e) => {
      const panel = panelRef.current;
      if (!panel || e.touches.length !== 1 || startsInHorizontalScroller(e.target, panel)) {
        gesture.current = null;
        return;
      }
      const touch = e.touches[0];
      gesture.current = { startX: touch.clientX, startY: touch.clientY, startTime: Date.now(), dragging: null };
    },

    onTouchMove: (e) => {
      const g = gesture.current;
      const panel = panelRef.current;
      if (!g || !panel || g.dragging === false) return;
      const touch = e.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      if (g.dragging === null) {
        if (Math.abs(dx) < DECIDE_DISTANCE_PX && Math.abs(dy) < DECIDE_DISTANCE_PX) return;
        g.dragging = dx > 0 && Math.abs(dx) > Math.abs(dy);
        if (!g.dragging) return;
      }
      panel.style.transition = 'none';
      panel.style.transform = `translateX(${Math.max(0, dx)}px)`;
    },

    onTouchEnd: (e) => {
      const g = gesture.current;
      const panel = panelRef.current;
      gesture.current = null;
      if (!g?.dragging || !panel) return;
      const dx = e.changedTouches[0].clientX - g.startX;
      const velocity = dx / Math.max(1, Date.now() - g.startTime);
      if (dx > panel.offsetWidth * CLOSE_RATIO || velocity > CLOSE_VELOCITY_PX_PER_MS) {
        settle(panel, 'translateX(100%)');
        onBack();
      } else {
        settle(panel, '');
      }
    },

    onTouchCancel: () => {
      const panel = panelRef.current;
      if (gesture.current?.dragging && panel) settle(panel, '');
      gesture.current = null;
    },
  };
}
