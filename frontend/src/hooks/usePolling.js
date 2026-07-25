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

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (!cancelled) {
          setData(result);
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
