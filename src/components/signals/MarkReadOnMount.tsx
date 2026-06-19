"use client";
import { useEffect } from "react";

export function MarkReadOnMount({
  types,
  excludeTypes,
}: {
  types?: string[];
  excludeTypes?: string[];
}) {
  useEffect(() => {
    fetch("/api/signals/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ types, excludeTypes }),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
