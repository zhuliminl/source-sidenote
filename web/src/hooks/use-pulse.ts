import { useEffect, useState } from "react";

/**
 * True for a moment after `active` turns on (or `key` changes while active), to play a
 * one-off "you are here" animation without replaying it on every render.
 */
export function usePulse(active: boolean, key?: unknown) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 800);
    return () => clearTimeout(t);
  }, [active, key]);
  return on;
}

/** Scrolls an element to the middle of its scroll container, but only if it is not fully visible. */
export function revealCentered(el: Element | null | undefined) {
  if (!el) return;
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY))
    box = box.parentElement;
  if (!box) return;
  const outer = box.getBoundingClientRect();
  const inner = el.getBoundingClientRect();
  if (inner.top >= outer.top && inner.bottom <= outer.bottom) return;
  // Scroll the container itself: Chrome cancels a smooth scrollIntoView when another starts,
  // and the tree and the map often reveal their rows at the same moment.
  box.scrollTo({
    top:
      box.scrollTop + inner.top - outer.top - (outer.height - inner.height) / 2,
    behavior: "smooth",
  });
}
