import Link from "next/link";
import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageTitle, StatTile, buttonClass } from "@/components/ui";
import { REQUEST_KINDS, REQUEST_STATUS, daysUntil, dueLabel, formatDate } from "@/lib/labels";
import type { AuthorityRequest } from "@/lib/types";

type Row = AuthorityRequest & { dossiers: { number: string; collector_id: string | null; processor_id: string | null } | null };

export default async function SuiviPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const profile = await getProfile();
  const { vue = "ouvertes" } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("authority_requests")
    .select("*, dossiers(number, collector_id, processor_id)")
    .order("due_on", { ascending: true })
    .limit(500);
  q = vue === "fermees" ? q.in("status", ["repondue", "annulee"]) : q.in("status", ["a_faire", "prete"]);
  const { data } = await q;
  let rows = (data ?? []) as Row[];
  const manager = hasRole(profile, "GBR", "CHF", "ADM");
  const mineOnly = vue === "miennes" || !manager;
  const isMine = (r: Row) =>
    (r.assignee_role === "COL" && r.dossiers?.collector_id === profile.id) || (r.assignee_role === "TRT" && r.dossiers?.processor_id === profile.id);
  if (mineOnly) rows = rows.filter(isMine);
  const openRows = rows.filter((r) => r.status === "a_faire" || r.status === "prete");
  const late = openRows.filter((r) => daysUntil(r.due_on) < 0).length;
  const week = openRows.filter((r) => daysUntil(r.due_on) >= 0 && daysUntil(r.due_on) <= 7).length;
  const ready = openRows.filter((r) => r.status === "prete").length;

  const tabs = [
    ...(manager ? [{ key: "ouvertes", label: "Toutes les demandes ouvertes" }] : []),
    { key: "miennes", label: "À préparer par moi" },
    { key: "fermees", label: "Répondues ou annulées" },
  ];
  const current = manager ? vue : vue === "fermees" ? "fermees" : "miennes";

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Après la soumission" sub="Demandes de l'autorité (IRCC, MIFI) reçues après le dépôt des dossiers, de la plus urgente à la moins urgente.">
        Suivi des demandes de l&apos;autorité
      </PageTitle>

      {vue !== "fermees" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Demandes ouvertes" value={openRows.length} />
          <StatTile label="En retard" value={late} tone="red" />
          <StatTile label="Échéance sous 7 jours" value={week} tone="amber" />
          <StatTile label="Prêtes à envoyer" value={ready} tone="emerald" />
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-surface p-1">
          {tabs.map((t) => (
            <Link key={t.key} href={`/suivi?vue=${t.key}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${current === t.key ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty>Aucune demande dans cette vue.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Échéance</th>
                  <th className="px-3 py-2.5">Dossier</th>
                  <th className="px-3 py-2.5">Demande</th>
                  <th className="px-3 py-2.5">Préparée par</th>
                  <th className="px-3 py-2.5">État</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const due = dueLabel(r.due_on);
                  const isOpen = r.status === "a_faire" || r.status === "prete";
                  return (
                    <tr key={r.id} className="transition hover:bg-navy-light/40">
                      <td className="whitespace-nowrap px-5 py-3">
                        {isOpen ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${due.tone}`}>{due.text}</span> : null}
                        <span className="ml-2 text-xs text-slate-500">{formatDate(r.due_on)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[13px] text-navy">{r.dossiers?.number}</td>
                      <td className="px-3 py-3">
                        <span className="block text-xs text-slate-500">{REQUEST_KINDS[r.kind]}</span>
                        <span className="font-medium text-slate-900">{r.title}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {r.assignee_role === "COL" ? "Collecte" : "Traitement"}{isMine(r) ? " (moi)" : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-700">{REQUEST_STATUS[r.status]}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/dossiers/${r.dossier_id}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${buttonClass.secondary}`}>Ouvrir</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
