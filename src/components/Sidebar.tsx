"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Nav, type NavItem } from "./Nav";
import { NotificationBell } from "./NotificationBell";
import { Avatar } from "./AgentBits";
import { signOut } from "@/app/actions";

type Props = {
  items: NavItem[];
  initialCompact: boolean;
  user: { id: string; name: string; code: string | null; roles: string; avatar: string | null };
  unread: number;
};

const COOKIE = "bc_menu";

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// Menu latéral repliable :
// - ordinateur : bouton « Réduire le menu » (ou Ctrl + B) qui garde seulement les icônes ;
//   le choix est retenu d'une visite à l'autre ;
// - téléphone : le menu est caché derrière un bouton ☰ et s'ouvre par-dessus la page.
export function Sidebar({ items, initialCompact, user, unread }: Props) {
  const [compact, setCompact] = useState(initialCompact);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  function toggle() {
    setCompact((c) => {
      const next = !c;
      document.cookie = `${COOKIE}=${next ? "compact" : "full"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // le tiroir mobile se referme quand on change de page
  useEffect(() => setMobileOpen(false), [pathname]);

  const brand = (showText: boolean) => (
    <div className="flex items-center gap-3">
      <Image src="/logo-mark.png" alt="BalCAN" width={40} height={40} priority className="shrink-0" />
      {showText && (
        <div className="leading-tight">
          <p className="text-lg font-bold tracking-tight text-navy">
            Bal<span className="text-brand-red">CAN</span>
          </p>
          <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">Gestion des dossiers</p>
        </div>
      )}
    </div>
  );

  const userCard = (small: boolean) =>
    small ? (
      <div className="flex flex-col items-center gap-2 p-3">
        <span title={`${user.name} · ${user.code ?? ""}`}>
          <Avatar name={user.name} src={user.avatar} />
        </span>
        <form action={signOut}>
          <button aria-label="Se déconnecter" title="Se déconnecter" className="rounded-lg p-2 text-slate-500 transition hover:bg-navy-light hover:text-navy">
            <Icon d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </button>
        </form>
      </div>
    ) : (
      <div className="p-3">
        <div className="rounded-2xl bg-surface p-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.avatar} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="font-mono text-xs text-slate-500">{user.code ?? "Sans code agent"}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-600">{user.roles}</p>
          <form action={signOut} className="mt-3">
            <button className="w-full rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-navy ring-1 ring-inset ring-slate-200 transition hover:bg-navy-light">
              Se déconnecter
            </button>
          </form>
        </div>
      </div>
    );

  return (
    <>
      {/* Barre du haut sur téléphone */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <button onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu" aria-expanded={mobileOpen}
          className="rounded-lg p-2 text-navy transition hover:bg-navy-light">
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
        {brand(true)}
        <NotificationBell userId={user.id} unread={unread} />
      </header>

      {/* Tiroir mobile */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobileOpen ? "" : "pointer-events-none"}`} aria-hidden={!mobileOpen}>
        <div onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-navy-dark/40 transition-opacity duration-300 ${mobileOpen ? "opacity-100" : "opacity-0"}`} />
        <aside className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-2xl transition-transform duration-300 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-5 py-5">
            {brand(true)}
            <button onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" className="rounded-lg p-2 text-slate-500 hover:bg-navy-light hover:text-navy">
              <Icon d="M6 6l12 12M18 6 6 18" />
            </button>
          </div>
          <Nav items={items} onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto">{userCard(false)}</div>
        </aside>
      </div>

      {/* Menu latéral sur ordinateur */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-300 ease-out md:flex ${compact ? "w-[84px]" : "w-64"}`}
      >
        <div className={`flex items-center py-5 ${compact ? "flex-col gap-3 px-3" : "justify-between gap-2 px-5"}`}>
          {brand(!compact)}
          <NotificationBell userId={user.id} unread={unread} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
          <Nav items={items} compact={compact} />
        </div>
        <div className="border-t border-slate-100">
          {userCard(compact)}
          <button
            onClick={toggle}
            aria-label={compact ? "Agrandir le menu" : "Réduire le menu"}
            title={`${compact ? "Agrandir" : "Réduire"} le menu (Ctrl + B)`}
            className={`flex w-full items-center gap-2 border-t border-slate-100 py-3 text-xs font-medium text-slate-500 transition hover:bg-navy-light hover:text-navy ${compact ? "justify-center" : "px-5"}`}
          >
            <Icon d={compact ? "M13 6l6 6-6 6M5 6l6 6-6 6" : "M11 6l-6 6 6 6M19 6l-6 6 6 6"} className="h-4 w-4" />
            {!compact && "Réduire le menu"}
          </button>
        </div>
      </aside>
    </>
  );
}
