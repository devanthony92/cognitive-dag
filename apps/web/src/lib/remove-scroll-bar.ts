import { useEffect } from 'react';

/**
 * Replaces `react-remove-scroll-bar` (an alias in `vite.config.ts`). The original injects a stylesheet
 * node every time a dialog, sheet or menu opens, and the production CSP (`style-src 'self'`) blocks
 * it: a violation in the console and no scroll lock. This version only marks the body while an overlay
 * is open, and `index.css` holds the rule (`body[data-scroll-locked]`).
 */
const LOCK_ATTRIBUTE = 'data-scroll-locked';

function counter(): number {
  const value = parseInt(document.body.getAttribute(LOCK_ATTRIBUTE) ?? '0', 10);
  return Number.isFinite(value) ? value : 0;
}

export function RemoveScrollBar(): null {
  useEffect(() => {
    document.body.setAttribute(LOCK_ATTRIBUTE, String(counter() + 1));
    return () => {
      const next = counter() - 1;
      if (next <= 0) document.body.removeAttribute(LOCK_ATTRIBUTE);
      else document.body.setAttribute(LOCK_ATTRIBUTE, String(next));
    };
  }, []);
  return null;
}
