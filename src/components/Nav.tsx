"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM8.5 12l2.5 2.5 4.5-5" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  users: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.9M15.5 4.1a3 3 0 0 1 0 5.8" />,
  user: <path d="M20 20v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // l'entrée active est celle dont le chemin correspond le plus précisément à la page
  const matches = items.filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/")));
  const activeHref = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === activeHref;
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group relative flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active ? "bg-navy text-white shadow-sm" : "text-slate-600 hover:bg-navy-light hover:text-navy"
            }`}
          >
            {active && <span className="absolute -left-3 top-2 hidden h-7 w-1 rounded-r-full bg-brand-red md:block" aria-hidden />}
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[item.icon]}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
