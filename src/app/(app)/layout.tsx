import Image from "next/image";
import { redirect } from "next/navigation";
import { getProfile, hasRole } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { signOut } from "@/app/actions";
import { Nav, type NavItem } from "@/components/Nav";
import { NotificationBell } from "@/components/NotificationBell";
import { IdleLogout } from "@/components/IdleLogout";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  // compte créé par l'administrateur : choisir son mot de passe avant tout
  if (profile.must_change_password) redirect("/mot-de-passe");
  const supabase = await createClient();
  // double authentification : code demandé si elle est activée, activation imposée si le cabinet l'exige
  const settings = await getSettings();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/securite/verification");
  if (settings.mfa_obligatoire && aal?.nextLevel !== "aal2") redirect("/securite/2fa?obligatoire=1");
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .is("read_at", null);
  const items: (NavItem & { show: boolean })[] = [
    { href: "/", label: "Tableau de bord", icon: "home", show: true },
    { href: "/dossiers", label: "Dossiers", icon: "folder", show: true },
    { href: "/dossiers/nouveau", label: "Ouvrir un dossier", icon: "plus", show: hasRole(profile, "GBR", "CHF", "ADM") },
    { href: "/controle", label: "File de contrôle", icon: "check", show: hasRole(profile, "CTL") },
    { href: "/heures", label: "Heures et paie", icon: "clock", show: hasRole(profile, "TRT", "GBR", "CHF", "ADM") },
    { href: "/admin/agents", label: "Agents", icon: "users", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/bureaux", label: "Bureaux", icon: "building", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/formulaires", label: "Formulaires", icon: "file", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/securite", label: "Sécurité", icon: "shield", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/journal", label: "Journal d'audit", icon: "list", show: hasRole(profile, "ADM", "CHF") },
    { href: "/profil", label: "Mon profil", icon: "user", show: true },
  ];
  const initials = (profile.full_name || profile.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen bg-surface md:flex">
      <IdleLogout minutes={settings.inactivite_minutes} />
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <Image src="/logo-mark.png" alt="" width={40} height={40} priority />
          <div className="flex-1 leading-tight">
            <p className="text-lg font-bold tracking-tight text-navy">
              Bal<span className="text-brand-red">CAN</span>
            </p>
            <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">Gestion des dossiers</p>
          </div>
          <NotificationBell userId={profile.id} unread={unread ?? 0} />
        </div>
        <Nav items={items.filter((i) => i.show)} />
        <div className="mt-auto hidden p-3 md:block">
          <div className="rounded-2xl bg-surface p-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name || profile.email}</p>
                <p className="font-mono text-xs text-slate-500">{profile.agent_code ?? "Sans code agent"}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {profile.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Aucun rôle pour l'instant"}
            </p>
            <form action={signOut} className="mt-3">
              <button className="w-full rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-navy ring-1 ring-inset ring-slate-200 transition hover:bg-navy-light">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
