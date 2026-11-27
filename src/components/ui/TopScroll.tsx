"use client";
// A horizontally scrolling area whose scrollbar sits on top (and stays visible
// while you scroll down long columns), instead of at the very bottom.
import { useEffect, useRef, useState, type ReactNode } from "react";

export function TopScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [needed, setNeeded] = useState(false);
  const [top, setTop] = useState(0);

  // Sit right under the page's top bar when it stays pinned while scrolling.
  useEffect(() => {
    const place = () => {
      const header = bar.current?.closest("main")?.querySelector("header");
      setTop(header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height : 0);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => { setWidth(el.scrollWidth); setNeeded(el.scrollWidth > el.clientWidth + 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [children]);

  // Keep the two in step, whichever one moves.
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && Math.abs(to.scrollLeft - from.scrollLeft) > 1) to.scrollLeft = from.scrollLeft;
  };

  return (
    <div>
      <div ref={bar} onScroll={() => sync(bar.current, body.current)} aria-hidden
        style={{ top }} className={`sticky z-10 overflow-x-auto overflow-y-hidden bg-[#F5F5F0] ${needed ? "h-4 mb-1" : "h-0"}`}>
        <div style={{ width, height: 1 }} />
      </div>
      <div ref={body} onScroll={() => sync(body.current, bar.current)} className={`overflow-x-auto no-scrollbar ${className}`}>
        {children}
      </div>
    </div>
  );
}
