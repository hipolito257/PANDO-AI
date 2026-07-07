import { useEffect, useState, Dispatch, SetStateAction } from "react";

// Drop-in replacement for useState that survives navigating away and back
// (sessionStorage persists per-tab until the tab is closed) — used for
// documentos page state so switching to Settings and back doesn't lose an
// in-progress draft, uploaded files, or form inputs.
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `pando:${key}`;
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // ignore quota/serialization errors — worst case, progress just isn't persisted
    }
  }, [storageKey, state]);

  return [state, setState];
}
