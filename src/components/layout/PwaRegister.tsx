"use client";
import { useEffect } from "react";

// Registers the service worker (push notifications, app install).
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
