"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM8.5 12l2.5 2.5 4.5-5" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  users: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.9M15.5 4.1a3 3 0 0 1 0 5.8" />,
  building: <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21M14 10h4.5a1.5 1.5 0 0 1 1.5 1.5V21M3 21h18M8 8h2M8 12h2M8 16h2M17 14h0M17 17h0" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM9.5 11.5V10a2.5 2.5 0 0 1 5 0v1.5M9 11.5h6v4H9z" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  inbox: <path d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-8h11L20 13v6H4z" />,
  hourglass: <path d="M6 3h12M6 21h12M7 3v3.5a5 5 0 0 0 2.2 4.1L12 12l2.8 1.4A5 5 0 0 1 17 17.5V21M17 3v3.5a5 5 0 0 1-2.2 4.1L12 12l-2.8 1.4A5 5 0 0 0 7 17.5V21" />,
  user: <path d="M20 20v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; section?: string };

// Menu de navigation. En mode compact, seules les icônes restent visibles ;
// le nom apparaît dans une bulle au survol (et reste lu par les lecteurs d'écran).
export function Nav({ items, compact = false, onNavigate }: { items: NavItem[]; compact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // l'entrée active est celle dont le chemin correspond le plus précisément à la page
  const matches = items.filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/")));
  const activeHref = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  // bulle du mode compact en position fixe : elle n'est pas coupée quand le menu défile
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (label: string) => (e: React.MouseEvent | React.FocusEvent) => {
    if (!compact) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  return (
    <nav className="flex flex-col gap-1 px-3" onMouseLeave={() => setTip(null)}>
      {tip && (
        <span
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-navy-dark px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{ top: tip.top, left: tip.left }}
          aria-hidden
        >
          {tip.label}
        </span>
      )}
      {items.map((item, i) => {
        const active = item.href === activeHref;
        const newSection = item.section && item.section !== items[i - 1]?.section;
        return (
          <div key={item.href}>
            {newSection &&
              (compact ? (
                <div className="mx-2 my-2 border-t border-slate-200" aria-hidden />
              ) : (
                <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{item.section}</p>
              ))}
            <Link
              href={item.href}
              onClick={() => { setTip(null); onNavigate?.(); }}
              onMouseEnter={showTip(item.label)}
              onFocus={showTip(item.label)}
              onBlur={() => setTip(null)}
              aria-label={compact ? item.label : undefined}
              className={`group relative flex items-center gap-3 whitespace-nowrap rounded-xl py-2.5 text-sm font-medium transition ${
                compact ? "justify-center px-0" : "px-3"
              } ${active ? "bg-navy text-white shadow-sm" : "text-slate-600 hover:bg-navy-light hover:text-navy"}`}
            >
              {active && <span className="absolute -left-3 top-2 h-7 w-1 rounded-r-full bg-brand-red" aria-hidden />}
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {ICONS[item.icon]}
              </svg>
              {!compact && item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
