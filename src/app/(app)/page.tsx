import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DossierWithClient } from "@/lib/types";
import { DossierTable } from "@/components/DossierTable";
import { Card, PageTitle, StatusBadge } from "@/components/ui";
import { daysSince } from "@/lib/labels";

export default async function Dashboard() {
  const profile = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("dossiers")
    .select("*, clients(client_code, first_name, last_name)")
    .order("status_changed_at", { ascending: true })
    .limit(1000);
  const dossiers = (data ?? []) as DossierWithClient[];
  const open = dossiers.filter((d) => d.status < 90);
  const me = profile.id;

  const sections: { title: string; rows: DossierWithClient[]; empty: string }[] = [];
  if (hasRole(profile, "COL"))
    sections.push({
      title: "Collecte : mes dossiers à compléter",
      rows: open.filter((d) => d.collector_id === me && [10, 35].includes(d.status)),
      empty: "Aucune collecte en cours.",
    });
  if (hasRole(profile, "GBR"))
    sections.push({
      title: "À assigner à un agent de traitement",
      rows: open.filter((d) => d.status === 15),
      empty: "Aucun dossier en attente d'assignation.",
    });
  if (hasRole(profile, "TRT"))
    sections.push({
      title: "Traitement : mes dossiers",
      rows: open.filter((d) => d.processor_id === me && [20, 30, 55, 75].includes(d.status)),
      empty: "Aucun dossier à traiter.",
    });
  if (hasRole(profile, "CTL"))
    sections.push({
      title: "Contrôle : file d'attente et mes contrôles",
      rows: open.filter((d) => (d.status === 40 && d.processor_id !== me) || (d.status === 50 && d.controller_id === me)),
      empty: "Aucun dossier à contrôler.",
    });
  if (hasRole(profile, "CHF"))
    sections.push({
      title: "Validation finale et soumission",
      rows: open.filter((d) => [60, 70].includes(d.status)),
      empty: "Aucun dossier en attente de validation.",
    });

  const counts = new Map<number, number>();
  for (const d of open) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
  const blocked = open.filter((d) => d.status < 80 && daysSince(d.status_changed_at) >= 7);

  return (
    <div className="space-y-6">
      <PageTitle sub={`${open.length} dossier(s) en cours dans votre périmètre`}>
        Bonjour {profile.full_name || profile.email}
      </PageTitle>

      {profile.roles.length === 0 && (
        <Card>
          <p className="text-sm">Votre compte n&apos;a pas encore de rôle. L&apos;administrateur doit vous en attribuer un.</p>
        </Card>
      )}

      {counts.size > 0 && (
        <Card title="Dossiers par statut">
          <div className="flex flex-wrap gap-3">
            {[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => (
              <div key={s} className="flex items-center gap-2">
                <StatusBadge status={s} />
                <span className="text-sm font-semibold tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sections.map((s) => (
        <Card key={s.title} title={`${s.title} (${s.rows.length})`}>
          <DossierTable dossiers={s.rows} empty={s.empty} />
        </Card>
      ))}

      {hasRole(profile, "GBR", "CHF", "ADM") && (
        <Card title={`Dossiers bloqués depuis 7 jours ou plus (${blocked.length})`}>
          <DossierTable dossiers={blocked} empty="Aucun dossier bloqué." />
        </Card>
      )}
    </div>
  );
}
