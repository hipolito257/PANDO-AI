"use client";
// Turn push notifications on for this device and choose which ones to get.
import { useCallback, useEffect, useState } from "react";

type Data = {
  configured: boolean; publicKey: string | null;
  devices: { id: string; endpoint: string; device: string | null; createdAt: string }[];
  prefs: Record<string, boolean>;
  kinds: { key: string; label: string }[];
};

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  const app = window.matchMedia("(display-mode: standalone)").matches ? " app" : "";
  return `${os}${browser ? ` · ${browser}` : ""}${app}`;
}

export function PushSettings() {
  const [data, setData] = useState<Data | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null); // this device's subscription
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [env, setEnv] = useState({ supported: true, ios: false, standalone: false, permission: "default" as NotificationPermission | "unsupported" });

  const load = useCallback(async () => {
    const r = await fetch("/api/push");
    if (r.ok) setData(await r.json());
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
    } catch { setEndpoint(null); }
  }, []);

  useEffect(() => {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setEnv({ supported, ios, standalone, permission: "Notification" in window ? Notification.permission : "unsupported" });
    load();
  }, [load]);

  async function enable() {
    if (!data?.publicKey) return;
    setBusy("enable"); setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      setEnv(e => ({ ...e, permission }));
      if (permission !== "granted") { setMsg({ text: "Notifications are blocked for PANDO. Allow them in this device's settings and try again.", error: true }); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(data.publicKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName() }) });
      if (!res.ok) throw new Error("save");
      setMsg({ text: "Notifications are on for this device." });
      await load();
    } catch {
      setMsg({ text: "Couldn't turn notifications on for this device.", error: true });
    } finally { setBusy(null); }
  }

  async function disable(target?: string) {
    setBusy("disable"); setMsg(null);
    try {
      if (!target || target === endpoint) {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        await sub?.unsubscribe();
      }
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: target ?? endpoint }) });
      await load();
    } finally { setBusy(null); }
  }

  async function setPref(key: string, on: boolean) {
    setData(d => (d ? { ...d, prefs: { ...d.prefs, [key]: on } } : d));
    await fetch("/api/push", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: { [key]: on } }) });
  }

  async function test() {
    setBusy("test"); setMsg(null);
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) }).then(r => r.json()).catch(() => ({}));
    setBusy(null);
    setMsg(r.sent ? { text: `Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` } : { text: "No device received it. Turn notifications on first.", error: true });
  }

  const thisOn = !!endpoint && !!data?.devices.some(d => d.endpoint === endpoint);
  const btn = "text-[12px] font-medium rounded-[8px] px-3 py-1.5 border transition-opacity disabled:opacity-50";

  return (
    <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-4 mb-8">
      <div>
        <h2 className="text-[16px] font-semibold text-carbon">Notifications on your phone</h2>
        <p className="text-[12px] text-slate mt-1">Get a notification when something needs you, even with PANDO closed.</p>
      </div>

      {!data ? <p className="text-[12px] text-slate">Loading…</p> : !data.configured ? (
        <p className="text-[12px] text-graphite">Push notifications aren&apos;t set up on the server yet (VAPID keys missing in Vercel).</p>
      ) : !env.supported ? (
        env.ios && !env.standalone ? (
          <div className="text-[12px] text-graphite bg-fog rounded-[8px] p-3 space-y-1">
            <p className="font-semibold text-carbon">On iPhone, install PANDO first:</p>
            <p>1. In Safari, tap the Share button (square with an arrow).</p>
            <p>2. Choose <b>Add to Home Screen</b>.</p>
            <p>3. Open PANDO from the new icon and come back to Settings to turn notifications on.</p>
          </div>
        ) : <p className="text-[12px] text-graphite">This browser doesn&apos;t support notifications. Try Chrome, Edge or Safari.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {thisOn ? (
              <>
                <span className="text-[12px] text-forest font-medium">● On for this device</span>
                <button disabled={!!busy} onClick={test} className={`${btn} border-carbon text-carbon hover:bg-fog`}>{busy === "test" ? "Sending…" : "Send a test"}</button>
                <button disabled={!!busy} onClick={() => disable()} className={`${btn} border-chalk text-slate hover:text-carbon`}>Turn off here</button>
              </>
            ) : (
              <button disabled={!!busy} onClick={enable} className={`${btn} bg-carbon text-white border-carbon hover:opacity-85`}>{busy === "enable" ? "Turning on…" : "Turn on for this device"}</button>
            )}
          </div>
          {env.permission === "denied" && <p className="text-[12px] text-red-600">Notifications are blocked for PANDO in this browser. Allow them in the site / app settings.</p>}

          <div>
            <p className="text-[12px] font-semibold text-carbon mb-1.5">Notify me about</p>
            <div className="space-y-1.5">
              {data.kinds.map(k => (
                <label key={k.key} className="flex items-center gap-2 text-[13px] text-carbon cursor-pointer">
                  <input type="checkbox" checked={data.prefs[k.key] !== false} onChange={e => setPref(k.key, e.target.checked)} />
                  {k.label}
                </label>
              ))}
            </div>
          </div>

          {data.devices.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-carbon mb-1">Devices with notifications on</p>
              {data.devices.map(d => (
                <div key={d.id} className="flex items-center justify-between text-[12px] text-graphite py-1 border-b border-chalk last:border-0">
                  <span>{d.device ?? "Device"}{d.endpoint === endpoint ? " (this one)" : ""} · since {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <button onClick={() => disable(d.endpoint)} className="text-slate hover:text-red-600">Remove</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {msg && <p className={`text-[12px] ${msg.error ? "text-red-600" : "text-forest"}`}>{msg.text}</p>}
    </div>
  );
}
