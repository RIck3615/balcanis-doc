"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Fine barre de progression en haut de l'écran (bleu marine vers rouge) dès qu'on
// clique sur un lien interne ; elle se termine quand la nouvelle page est affichée.
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }
    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement;
      if (form.method.toLowerCase() === "get" && !form.getAttribute("action")?.startsWith("http")) start();
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  function start() {
    if (timer.current) clearInterval(timer.current);
    setVisible(true);
    setWidth(8);
    // avance vite au début puis de plus en plus lentement, sans jamais atteindre 100 %
    timer.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.08 : w)), 120);
  }

  // nouvelle page affichée : on termine la barre
  useEffect(() => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    setWidth(100);
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 300);
    return () => clearTimeout(t);
  }, [pathname, search]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px]" aria-hidden>
      <div
        className="h-full rounded-r-full bg-gradient-to-r from-navy via-navy to-brand-red shadow-[0_0_8px_rgba(236,28,44,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
