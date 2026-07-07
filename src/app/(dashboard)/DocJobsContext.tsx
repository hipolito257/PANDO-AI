"use client";
import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";

// Navigating within the dashboard (e.g. Documents -> Settings -> Documents)
// unmounts and remounts the page component, but browser fetches keep running
// regardless — only the setState calls that would report their outcome
// become no-ops once their component is gone. This context lives in the
// dashboard layout, which stays mounted across that navigation, so a
// long-running document generation's status/result/error is always
// captured somewhere a component can read it back from, even if no one was
// looking when it finished.
export interface JobState<T = unknown> {
  status: "running" | "done" | "error";
  error?: string;
  result?: T;
}

interface DocJobsContextValue {
  jobs: Record<string, JobState>;
  runJob: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>;
  clearJob: (key: string) => void;
}

const DocJobsContext = createContext<DocJobsContextValue | null>(null);

export function DocJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  // Guards against a superseded run (e.g. user clicked "regenerate" again)
  // overwriting a newer run's result once the stale one finally settles.
  const runIdRef = useRef<Record<string, number>>({});

  const runJob = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const runId = (runIdRef.current[key] ?? 0) + 1;
    runIdRef.current[key] = runId;
    setJobs(prev => ({ ...prev, [key]: { status: "running" } }));
    try {
      const result = await fn();
      if (runIdRef.current[key] !== runId) return undefined; // superseded
      setJobs(prev => ({ ...prev, [key]: { status: "done", result } }));
      return result;
    } catch (err) {
      if (runIdRef.current[key] !== runId) return undefined;
      setJobs(prev => ({ ...prev, [key]: { status: "error", error: err instanceof Error ? err.message : String(err) } }));
      return undefined;
    }
  }, []);

  const clearJob = useCallback((key: string) => {
    setJobs(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return (
    <DocJobsContext.Provider value={{ jobs, runJob, clearJob }}>
      {children}
    </DocJobsContext.Provider>
  );
}

export function useDocJobs() {
  const ctx = useContext(DocJobsContext);
  if (!ctx) throw new Error("useDocJobs must be used within DocJobsProvider");
  return ctx;
}
