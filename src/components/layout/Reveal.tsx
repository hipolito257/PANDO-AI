"use client";
// Soft reveal, as on the Pando website: cards and sections fade up as they
// enter the screen, slightly staggered. Works for content that loads later
// (MutationObserver). The hidden state only applies once this script runs
// (html.reveal-on), and anything not revealed within 1.5 s is shown anyway,
// so nothing can stay invisible. Respects "reduce motion".
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const SELECTOR = "main .shadow-card, main [data-reveal]";

export function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.classList.add("reveal-on");

    let batch = 0;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.style.setProperty("--reveal-d", `${Math.min(batch, 6) * 70}ms`);
        el.classList.add("revealed");
        batch++;
        io.unobserve(el);
      }
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => { batch = 0; }, 120);
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });

    const watch = () => {
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach(el => {
        if (el.dataset.revealWatched) return;
        // Nested cards (a card inside a card) move with their parent.
        if (el.parentElement?.closest(SELECTOR)) { el.classList.add("revealed"); el.dataset.revealWatched = "1"; return; }
        el.dataset.revealWatched = "1";
        el.classList.add("reveal-item");
        io.observe(el);
      });
    };
    watch();
    const mo = new MutationObserver(() => watch());
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });

    // Safety net: never leave anything hidden.
    const safety = setTimeout(() => {
      document.querySelectorAll<HTMLElement>(".reveal-item:not(.revealed)").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight) el.classList.add("revealed");
      });
    }, 1500);

    return () => { io.disconnect(); mo.disconnect(); clearTimeout(safety); if (batchTimer) clearTimeout(batchTimer); };
  }, [pathname]);

  return null;
}
