import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface LineRange {
  start: number;
  end: number;
}

/**
 * Hover state shared by the code and the explanation, so each side can point at the other:
 * the line under the mouse in the code, and the range the mouse is on in the explanation.
 * Values and setters are separate contexts so the (large) code view only re-renders for `peek`.
 */
interface Setters {
  setHoverLine: (line: number | null) => void;
  setPeek: (range: LineRange | null) => void;
}

const noop = () => {};
const SettersContext = createContext<Setters>({
  setHoverLine: noop,
  setPeek: noop,
});
const HoverLineContext = createContext<number | null>(null);
const PeekContext = createContext<LineRange | null>(null);

export function ReaderLinkProvider({ children }: { children: ReactNode }) {
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [peek, setPeek] = useState<LineRange | null>(null);
  const setters = useMemo(() => ({ setHoverLine, setPeek }), []);
  return (
    <SettersContext.Provider value={setters}>
      <HoverLineContext.Provider value={hoverLine}>
        <PeekContext.Provider value={peek}>{children}</PeekContext.Provider>
      </HoverLineContext.Provider>
    </SettersContext.Provider>
  );
}

export const useLinkSetters = () => useContext(SettersContext);
export const useHoverLine = () => useContext(HoverLineContext);
export const usePeek = () => useContext(PeekContext);

/** The narrowest range that contains the line: the most specific explanation of it. */
export function narrowest<T extends LineRange>(
  ranges: readonly T[],
  line: number | null,
): T | undefined {
  if (line === null) return undefined;
  let best: T | undefined;
  for (const r of ranges)
    if (
      r.start <= line &&
      line <= r.end &&
      (!best || r.end - r.start < best.end - best.start)
    )
      best = r;
  return best;
}
