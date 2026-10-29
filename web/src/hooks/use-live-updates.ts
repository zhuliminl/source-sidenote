import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribe } from "@/lib/api";
import { keys } from "@/lib/queries";

/**
 * Keeps queries in sync with server events. Bursts are coalesced because topic
 * views re-read documented sources on the server to judge freshness.
 */
export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    const abort = new AbortController();
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (
        pending.has("jobs") ||
        pending.has("projects") ||
        pending.has("topics")
      ) {
        void qc.invalidateQueries({ queryKey: keys.jobs });
        // Project stats and file coverage live under ["projects"].
        void qc.invalidateQueries({ queryKey: keys.projects });
        // Topic progress, plans and documents live under ["topics"].
        void qc.invalidateQueries({ queryKey: keys.topicsRoot });
      }
      if (pending.has("config"))
        void qc.invalidateQueries({ queryKey: keys.config });
      pending.clear();
    };
    const onTopic = (topic: string) => {
      if (topic === "hello") return;
      pending.add(topic);
      clearTimeout(timer);
      timer = setTimeout(flush, 400);
    };
    (async () => {
      // Reconnect with backoff, e.g. after the service restarts.
      for (
        let delay = 1000;
        !abort.signal.aborted;
        delay = Math.min(delay * 2, 15000)
      ) {
        try {
          await subscribe(onTopic, abort.signal);
          delay = 1000;
        } catch {}
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, delay));
        flush();
      }
    })();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [qc]);
}
