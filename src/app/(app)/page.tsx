import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AuthorityRequest, DossierWithClient, ExpiringDocument } from "@/lib/types";
import Link from "next/link";
import { REQUEST_STATUS, dueLabel, expiryLabel, formatDate } from "@/lib/labels";
import { DossierTable } from "@/components/DossierTable";
import { Card, PageTitle, StatTile, StatusBadge } from "@/components/ui";
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
  const { data: reqData } = await supabase
    .from("authority_requests")
    .select("*, dossiers(number, collector_id, processor_id)")
    .in("status", ["a_faire", "prete"])
    .order("due_on")
    .limit(200);
  type Req = AuthorityRequest & { dossiers: { number: string; collector_id: string | null; processor_id: string | null } | null };
  const reqs = ((reqData ?? []) as Req[]).filter((r) =>
    hasRole(profile, "CHF", "GBR", "ADM") ||
    (r.status === "a_faire" &&
      ((r.assignee_role === "COL" && r.dossiers?.collector_id === profile.id) || (r.assignee_role === "TRT" && r.dossiers?.processor_id === profile.id))),
  );
  const { data: expData } = await supabase.rpc("document_expirations", { p_days: 30 });
  const expiring = ((expData ?? []) as ExpiringDocument[]).filter(
    (x) => hasRole(profile, "CHF", "GBR", "ADM") || x.collector_id === profile.id || x.processor_id === profile.id,
  );
  const open = dossiers.filter((d) => d.status < 90);
  const me = profile.id;

  const sections: { title: string; rows: DossierWithClient[]; empty: string }[] = [];
  if (hasRole(profile, "COL"))
    sections.push({
      title: "Mes collectes en cours",
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
      title: "Mes dossiers à traiter",
      rows: open.filter((d) => d.processor_id === me && [20, 30, 55, 75].includes(d.status)),
      empty: "Aucun dossier à traiter.",
    });
  if (hasRole(profile, "CTL"))
    sections.push({
      title: "À contrôler",
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
  const todo = sections.reduce((n, s) => n + s.rows.length, 0);
  const returned = open.filter((d) => d.status === 55 || d.status === 75).length;
  const submitted = dossiers.filter((d) => d.status === 80).length;
  const firstName = (profile.full_name || profile.email).split(" ")[0];

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Tableau de bord" sub="Les dossiers de votre périmètre, du plus ancien au plus récent dans leur statut.">
        Bonjour {firstName}
      </PageTitle>

      {profile.roles.length === 0 && (
        <Card>
          <p className="text-sm">Votre compte n&apos;a pas encore de rôle. L&apos;administrateur doit vous en attribuer un.</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Dossiers en cours" value={open.length} />
        <StatTile label="À faire pour moi" value={todo} tone="red" />
        <StatTile label="Bloqués 7 jours et plus" value={blocked.length} tone="amber" />
        <StatTile label={returned > 0 ? "En correction" : "Soumis"} value={returned > 0 ? returned : submitted} tone="emerald" />
      </div>

      {counts.size > 0 && (
        <Card title="Répartition par statut">
          <div className="flex flex-wrap gap-2">
            {[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => (
              <div key={s} className="flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3">
                <StatusBadge status={s} />
                <span className="text-sm font-semibold tabular-nums text-navy">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {reqs.length > 0 && (
        <Card title={`Demandes de l'autorité à suivre (${reqs.length})`} actions={<Link href="/suivi" className="text-sm font-medium text-navy hover:text-brand-red">Tout voir</Link>}>
          <ul className="-mx-5 divide-y divide-slate-100">
            {reqs.slice(0, 6).map((r) => {
              const due = dueLabel(r.due_on);
              return (
                <li key={r.id}>
                  <Link href={`/dossiers/${r.dossier_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-navy-light/40">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${due.tone}`}>{due.text}</span>
                    <span className="font-mono text-[13px] text-navy">{r.dossiers?.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{r.title}</span>
                    <span className="text-xs text-slate-500">{REQUEST_STATUS[r.status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {expiring.length > 0 && (
        <Card title={`Pièces qui expirent sous 30 jours (${expiring.length})`} actions={<Link href="/expirations" className="text-sm font-medium text-navy hover:text-brand-red">Tout voir</Link>}>
          <ul className="-mx-5 divide-y divide-slate-100">
            {expiring.slice(0, 6).map((x) => {
              const e = expiryLabel(x.days_left);
              return (
                <li key={x.document_id}>
                  <Link href={`/dossiers/${x.dossier_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-navy-light/40">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.tone}`}>{e.text}</span>
                    <span className="font-mono text-[13px] text-navy">{x.dossier_number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{x.type_label} · {x.person_code} {x.person_name}</span>
                    <span className="text-xs text-slate-500">{formatDate(x.expires_on)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {sections.map((s) => (
        <Card key={s.title} title={`${s.title} (${s.rows.length})`}>
          <DossierTable dossiers={s.rows} empty={s.empty} />
        </Card>
      ))}

      {hasRole(profile, "GBR", "CHF", "ADM") && (
        <Card title={`Bloqués depuis 7 jours ou plus (${blocked.length})`}>
          <DossierTable dossiers={blocked} empty="Aucun dossier bloqué." />
        </Card>
      )}
    </div>
  );
}
