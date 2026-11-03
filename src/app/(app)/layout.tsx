import Link from "next/link";
import { getProfile, hasRole } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { signOut } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: "Tableau de bord", show: true },
    { href: "/dossiers", label: "Dossiers", show: true },
    { href: "/dossiers/nouveau", label: "Ouvrir un dossier", show: hasRole(profile, "GBR", "CHF", "ADM") },
    { href: "/controle", label: "File de contrôle", show: hasRole(profile, "CTL") },
    { href: "/heures", label: "Heures et paie", show: hasRole(profile, "TRT", "GBR", "CHF", "ADM") },
    { href: "/admin/agents", label: "Agents", show: hasRole(profile, "ADM", "CHF") },
    { href: "/profil", label: "Mon profil", show: true },
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="p-4">
          <p className="text-xs font-semibold tracking-widest text-slate-500">BALCANIS</p>
          <p className="text-sm font-semibold">Gestion des dossiers</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {links.filter((l) => l.show).map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-slate-200 p-4 text-xs text-slate-600 md:mt-6 md:block">
          <p className="font-medium text-slate-900">{profile.full_name || profile.email}</p>
          <p className="font-mono">{profile.agent_code ?? "sans code"}</p>
          <p className="mt-1">{profile.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Aucun rôle : contactez l'administrateur"}</p>
          <form action={signOut} className="mt-3">
            <button className="text-slate-700 underline">Se déconnecter</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
