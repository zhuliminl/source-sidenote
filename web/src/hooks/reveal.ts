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

/**
 * Plays a Material-style ripple inside `el`, spreading from `point` (viewport pixels) or, when
 * the change came from elsewhere, from near the row's left edge. `el` must clip its overflow.
 */
export function ripple(el: HTMLElement, point?: { x: number; y: number }) {
  const r = el.getBoundingClientRect();
  const x = (point?.x ?? r.left + Math.min(24, r.width / 2)) - r.left;
  const y = (point?.y ?? r.top + r.height / 2) - r.top;
  const size =
    2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
  const ink = document.createElement("span");
  ink.className = "ripple-ink";
  Object.assign(ink.style, {
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
  });
  el.appendChild(ink);
  ink.addEventListener("animationend", () => ink.remove());
  // Reduced motion disables the animation, so animationend never fires.
  setTimeout(() => ink.remove(), 1000);
}
