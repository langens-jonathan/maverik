import { useEffect, useRef, useState } from "react";

// Calls `fn` immediately and then every `intervalMs` while `enabled` is true. Returns the
// latest resolved value, any error from the most recent call, and whether the first call has
// completed yet. No dependency needed for something this small — matches the plain-polling
// pattern already used by the chat reference client (wwwroot/index.html).
export function usePolling(fn, intervalMs, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // JSON.stringify, not the freshly-parsed object itself — every tick's fetch response is a new
  // object even when nothing on the server changed, and a poll-driven page (e.g. RunDetailPage,
  // which recreates its chart data on every render) re-running effects off an identical-content-
  // but-different-reference value causes visible churn (charts tearing down/redrawing every
  // 1.5-2.5s, which can even reset scroll position as their container briefly collapses). Content
  // here is always plain JSON from our own API, so string comparison is a safe stand-in for deep
  // equality.
  const lastJsonRef = useRef(undefined);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (!cancelled) {
          const json = JSON.stringify(result);
          if (json !== lastJsonRef.current) {
            lastJsonRef.current = json;
            setData(result);
          }
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, enabled]);

  return { data, error, loading };
}
