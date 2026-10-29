import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/** Where the floating topic map currently is on screen (viewport pixels), or null when absent. */
export interface MapRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

let current: MapRect | null = null;
const listeners = new Set<() => void>();

export function publishMapRect(rect: MapRect | null) {
  const same =
    rect && current
      ? rect.left === current.left &&
        rect.right === current.right &&
        rect.top === current.top &&
        rect.bottom === current.bottom
      : rect === current;
  if (same) return;
  current = rect;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * How many pixels at the bottom of `ref` the map covers, so that panel can end above the map
 * instead of hiding content under it.
 */
export function useMapOverlap(ref: RefObject<HTMLElement | null>) {
  const map = useSyncExternalStore(subscribe, () => current);
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox(el.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      removeEventListener("resize", measure);
    };
  }, [ref]);

  if (!map || !box) return 0;
  const sideBySide = map.right <= box.left || map.left >= box.right;
  if (sideBySide || map.top >= box.bottom) return 0;
  // Leave a small gap above the map; never collapse the panel entirely.
  return Math.min(box.height - 120, Math.max(0, box.bottom - map.top + 8));
}
