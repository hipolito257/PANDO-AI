"use client";
// Welcome screen: the PANDO mark builds itself on the brand green and waits;
// the platform opens when the person taps "Enter" (or anywhere / presses a
// key). Shown when the app is opened (once per browser session) and whenever
// someone clicks the PANDO logo.
//
// The animation reveals the real logo image through an SVG mask: thick strokes
// are "drawn" along the frame, the divider and the roots, and each letter
// rises in, so what ends on screen is exactly the brand asset.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SPLASH_FLAG = "pando:splash"; // also read by the gate in (dashboard)/layout.tsx
const EXIT_MS = 450;        // fade-out before navigating

const LETTERS: [number, number][] = [[51, 92], [111, 167], [196, 241], [275, 321], [349, 409]];
const ROOTS = [
  "M216,172 C200,195 180,208 150,211 L85,212 C65,214 50,232 35,252 C25,268 15,282 4,292",
  "M224,172 C238,190 250,205 265,215 L300,216 C318,214 330,203 350,203 C372,203 385,212 398,222 C412,230 430,236 455,236",
  "M220,170 L221,250",
  "M98,214 C92,228 88,245 89,262 C91,280 102,298 114,324",
  "M219,250 C205,262 190,275 180,290 C172,302 168,312 167,324",
  "M222,250 C235,262 250,275 260,288 C270,300 276,310 280,324",
  "M280,220 C300,228 318,238 332,250 C345,260 360,265 378,270",
  "M378,270 C380,285 380,300 380,324",
  "M392,272 C405,280 415,290 422,300 C430,308 438,315 444,324",
];
// Root strokes start as the divider finishes, near ones first.
const ROOT_DELAY = [1.05, 1.05, 1.0, 1.35, 1.3, 1.3, 1.35, 1.6, 1.6];

function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/inicio") ? raw : "/";
}

function Splash() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  const enter = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    setTimeout(() => router.replace(next), EXIT_MS);
  }, [router, next]);

  useEffect(() => {
    try { sessionStorage.setItem(SPLASH_FLAG, "1"); } catch { /* private mode */ }
    router.prefetch(next);
    const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") enter(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [enter, next, router]);

  return (
    <main
      onClick={enter}
      className={`splash fixed inset-0 z-[100] flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden ${leaving ? "splash-leave" : ""}`}
      aria-label="PANDO — opening the platform"
    >
      <div className="splash-glow" aria-hidden="true" />
      <svg viewBox="0 0 457 328" className="splash-logo relative w-[min(62vw,340px)] h-auto" role="img" aria-label="PANDO">
        <defs>
          <mask id="pando-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="457" height="328">
            <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
              {/* frame, from the top centre around both sides */}
              <path d="M228,5.5 H451 V322 H228" strokeWidth="20" pathLength={1} className="draw" style={{ animationDelay: "0.15s", animationDuration: "0.9s" }} />
              <path d="M228,5.5 H5.5 V322 H228" strokeWidth="20" pathLength={1} className="draw" style={{ animationDelay: "0.15s", animationDuration: "0.9s" }} />
              {/* divider, opening from the centre */}
              <path d="M228,166 H4" strokeWidth="20" pathLength={1} className="draw" style={{ animationDelay: "0.75s", animationDuration: "0.45s" }} />
              <path d="M228,166 H453" strokeWidth="20" pathLength={1} className="draw" style={{ animationDelay: "0.75s", animationDuration: "0.45s" }} />
              {/* roots */}
              {ROOTS.map((d, i) => (
                <path key={i} d={d} strokeWidth="24" pathLength={1} className="draw" style={{ animationDelay: `${ROOT_DELAY[i]}s`, animationDuration: "0.75s" }} />
              ))}
            </g>
            {/* letters rise in one by one */}
            {LETTERS.map(([x0, x1], i) => (
              <rect key={i} x={x0 - 4} y={46} width={x1 - x0 + 8} height={84} fill="#fff" className="letter" style={{ animationDelay: `${1.55 + i * 0.09}s` }} />
            ))}
            {/* safety net: the whole mark is fully shown at the end */}
            <rect x="0" y="0" width="457" height="328" fill="#fff" className="settle" />
          </mask>
        </defs>
        <image href="/pando-logo.png" x="0" y="0" width="457" height="328" mask="url(#pando-reveal)" />
      </svg>
      <p className="splash-tag relative mt-8 text-[11px] md:text-[12px] tracking-[0.35em] uppercase text-[#D9DBD4]/70">Private Equity Intelligence</p>
      <button onClick={e => { e.stopPropagation(); enter(); }}
        className="splash-enter relative mt-10 px-9 py-3 rounded-full border border-[#D9DBD4]/50 text-[#E8EAE4] text-[12px] tracking-[0.3em] uppercase hover:bg-[#D9DBD4]/10 hover:border-[#D9DBD4] transition-colors">
        Enter
      </button>

      <style>{`
        .splash { background: radial-gradient(120% 90% at 50% 38%, #0B6157 0%, #004F46 45%, #003A33 100%); transition: opacity ${EXIT_MS}ms ease, transform ${EXIT_MS}ms ease; }
        .splash-leave { opacity: 0; transform: scale(1.015); }
        .splash-glow { position: absolute; width: 70vmax; height: 70vmax; border-radius: 9999px; top: 50%; left: 50%; transform: translate(-50%, -55%) scale(.6);
          background: radial-gradient(circle, rgba(217,219,212,.13) 0%, rgba(217,219,212,0) 60%); opacity: 0; animation: glow 2.4s ease-out 1.6s forwards; }
        .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation-name: draw; animation-timing-function: cubic-bezier(.65,0,.35,1); animation-fill-mode: forwards; }
        .letter { opacity: 0; transform: translateY(14px); transform-box: fill-box; animation: letter .55s cubic-bezier(.2,.8,.2,1) forwards; }
        .settle { opacity: 0; animation: settle .35s ease 2.35s forwards; }
        .splash-logo { animation: breathe 3.6s ease-in-out forwards; filter: drop-shadow(0 0 0 rgba(217,219,212,0)); }
        .splash-tag { opacity: 0; transform: translateY(8px); animation: tag .7s ease 2.25s forwards; }
        .splash-enter { opacity: 0; transform: translateY(8px); animation: tag .7s ease 2.6s forwards; }
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes letter { to { opacity: 1; transform: translateY(0); } }
        @keyframes settle { to { opacity: 1; } }
        @keyframes tag { to { opacity: 1; transform: translateY(0); } }
        @keyframes glow { 0% { opacity: 0; transform: translate(-50%, -55%) scale(.6); } 60% { opacity: 1; } 100% { opacity: .7; transform: translate(-50%, -55%) scale(1); } }
        @keyframes breathe { 0%, 60% { transform: scale(.97); filter: drop-shadow(0 0 0 rgba(217,219,212,0)); }
          78% { transform: scale(1); filter: drop-shadow(0 0 18px rgba(217,219,212,.28)); } 100% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(217,219,212,.12)); } }
        @media (prefers-reduced-motion: reduce) {
          .draw, .letter, .settle, .splash-tag, .splash-enter, .splash-glow, .splash-logo { animation-duration: .01s !important; animation-delay: 0s !important; }
        }
      `}</style>
    </main>
  );
}

export default function InicioPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-[#004F46]" />}>
      <Splash />
    </Suspense>
  );
}
