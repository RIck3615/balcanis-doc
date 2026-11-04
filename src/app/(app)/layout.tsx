import { redirect } from "next/navigation";
import { getProfile, hasRole } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import type { NavItem } from "@/components/Nav";
import { Sidebar } from "@/components/Sidebar";
import { cookies } from "next/headers";
import { IdleLogout } from "@/components/IdleLogout";
import { NavigationProgress } from "@/components/NavigationProgress";
import { Suspense } from "react";
import { getSettings } from "@/lib/settings";
import { signAvatars } from "@/lib/avatars";
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
  const avatarUrls = await signAvatars(supabase, [profile.avatar_path]);
  const compact = (await cookies()).get("bc_menu")?.value === "compact";
  const items: (NavItem & { show: boolean })[] = [
    { href: "/", label: "Tableau de bord", icon: "home", show: true },
    { href: "/dossiers", label: "Dossiers", icon: "folder", show: true },
    { href: "/dossiers/nouveau", label: "Ouvrir un dossier", icon: "plus", show: hasRole(profile, "GBR", "CHF", "ADM") },
    { href: "/controle", label: "File de contrôle", icon: "check", show: hasRole(profile, "CTL") },
    { href: "/suivi", label: "Suivi IRCC", icon: "inbox", show: hasRole(profile, "GBR", "CHF", "ADM", "TRT", "COL") },
    { href: "/expirations", label: "Pièces à renouveler", icon: "hourglass", show: hasRole(profile, "COL", "TRT", "GBR", "CHF", "ADM") },
    { href: "/heures", label: "Heures et paie", icon: "clock", show: hasRole(profile, "TRT", "GBR", "CHF", "ADM") },
    { href: "/profil", label: "Mon profil", icon: "user", show: true },
    { href: "/admin/agents", label: "Agents", icon: "users", section: "Administration", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/bureaux", label: "Bureaux", icon: "building", section: "Administration", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/formulaires", label: "Formulaires", icon: "file", section: "Administration", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/securite", label: "Sécurité", icon: "shield", section: "Administration", show: hasRole(profile, "ADM", "CHF") },
    { href: "/admin/journal", label: "Journal d'audit", icon: "list", section: "Administration", show: hasRole(profile, "ADM", "CHF") },
  ];

  return (
    <div className="min-h-screen bg-surface md:flex">
      <IdleLogout minutes={settings.inactivite_minutes} />
      <Suspense>
        <NavigationProgress />
      </Suspense>
      <Sidebar
        items={items.filter((i) => i.show).map((i) => ({ href: i.href, label: i.label, icon: i.icon, section: i.section }))}
        initialCompact={compact}
        unread={unread ?? 0}
        user={{
          id: profile.id,
          name: profile.full_name || profile.email,
          code: profile.agent_code,
          roles: profile.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Aucun rôle pour l'instant",
          avatar: profile.avatar_path ? avatarUrls[profile.avatar_path] ?? null : null,
        }}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
