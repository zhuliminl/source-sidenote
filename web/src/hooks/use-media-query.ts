import { useSyncExternalStore } from "react";

const queries = new Map<string, MediaQueryList>();
const get = (query: string) => {
  let mql = queries.get(query);
  if (!mql) queries.set(query, (mql = matchMedia(query)));
  return mql;
};

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = get(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => get(query).matches,
  );
}
