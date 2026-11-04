import Link from "next/link";
import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageTitle, StatTile } from "@/components/ui";
import { STATUS_LABELS, expiryLabel, formatDate, personLabel } from "@/lib/labels";
import type { ExpiringDocument } from "@/lib/types";

const WINDOWS = [
  { key: "30", label: "30 jours" },
  { key: "60", label: "60 jours" },
  { key: "90", label: "90 jours" },
  { key: "180", label: "6 mois" },
];

// Pièces à renouveler : passeports, tests de langue, certificats de police…
// qui expirent bientôt (ou sont déjà expirées) dans les dossiers en cours.
export default async function ExpirationsPage({ searchParams }: { searchParams: Promise<{ jours?: string; vue?: string }> }) {
  const profile = await getProfile();
  const { jours = "90", vue } = await searchParams;
  const days = WINDOWS.some((w) => w.key === jours) ? Number(jours) : 90;
  const supabase = await createClient();
  const { data } = await supabase.rpc("document_expirations", { p_days: days });
  let rows = (data ?? []) as ExpiringDocument[];

  const manager = hasRole(profile, "GBR", "CHF", "ADM");
  const mineOnly = !manager || vue === "miennes";
  if (mineOnly) rows = rows.filter((r) => r.collector_id === profile.id || r.processor_id === profile.id);

  const expired = rows.filter((r) => r.days_left < 0).length;
  const in30 = rows.filter((r) => r.days_left >= 0 && r.days_left <= 30).length;
  const dossiers = new Set(rows.map((r) => r.dossier_id)).size;

  const link = (j: string, v?: string) => `/expirations?jours=${j}${v ? `&vue=${v}` : ""}`;

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Alertes d'expiration" sub="Pièces des dossiers en cours qui arrivent à échéance. Des rappels partent automatiquement 90, 60, 30, 14 et 7 jours avant, le jour même, puis chaque semaine tant que la pièce n'est pas remplacée.">
        Pièces à renouveler
      </PageTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={`Pièces sous ${days} jours`} value={rows.length} />
        <StatTile label="Déjà expirées" value={expired} tone="red" />
        <StatTile label="Sous 30 jours" value={in30} tone="amber" />
        <StatTile label="Dossiers concernés" value={dossiers} />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface p-1">
            {WINDOWS.map((w) => (
              <Link key={w.key} href={link(w.key, vue)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${String(days) === w.key ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}>
                {w.label}
              </Link>
            ))}
          </div>
          {manager && (
            <div className="flex gap-1 rounded-xl bg-surface p-1">
              <Link href={link(String(days))} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${!mineOnly ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}>Toutes</Link>
              <Link href={link(String(days), "miennes")} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${mineOnly ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}>Mes dossiers</Link>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <Empty>Aucune pièce n&apos;expire dans les {days} prochains jours.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Échéance</th>
                  <th className="px-3 py-2.5">Dossier</th>
                  <th className="px-3 py-2.5">Pièce</th>
                  <th className="px-3 py-2.5">Personne</th>
                  <th className="px-3 py-2.5">Expire le</th>
                  <th className="px-5 py-2.5">Statut du dossier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const e = expiryLabel(r.days_left);
                  return (
                    <tr key={r.document_id} className="transition hover:bg-navy-light/40">
                      <td className="whitespace-nowrap px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.tone}`}>{e.text}</span></td>
                      <td className="px-3 py-3"><Link href={`/dossiers/${r.dossier_id}`} className="font-mono text-[13px] text-navy hover:text-brand-red">{r.dossier_number}</Link></td>
                      <td className="px-3 py-3 text-slate-900">{r.type_label}</td>
                      <td className="px-3 py-3 text-slate-600"><span className="font-mono text-xs text-slate-500">{r.person_code}</span> {r.person_name || personLabel(r.person_code)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(r.expires_on)}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{STATUS_LABELS[r.dossier_status] ?? r.dossier_status}</td>
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
