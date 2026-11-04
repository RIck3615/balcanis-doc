import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { queryAudit, type AuditFilters } from "@/lib/audit-query";
import { Card, Empty, PageTitle, buttonClass, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/labels";

const PAGE = 100;

export default async function JournalPage({ searchParams }: { searchParams: Promise<AuditFilters & { page?: string }> }) {
  await requireRole("ADM", "CHF");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, count, error } = await queryAudit(supabase, sp, PAGE, (page - 1) * PAGE);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.dossier_id).filter(Boolean))] as string[];
  const { data: dossiers } = ids.length ? await supabase.from("dossiers").select("id, number").in("id", ids) : { data: [] };
  const numberOf = (id: string | null) => (dossiers ?? []).find((d) => d.id === id)?.number;
  const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Administration" sub="Toutes les actions de la plateforme, dans l'ordre. Ce journal ne peut être ni modifié ni effacé, même par l'administrateur.">
          Journal d&apos;audit
        </PageTitle>
        <a href={`/admin/journal/export?${params}`} className={`mb-6 rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>
          Exporter en CSV
        </a>
      </div>
      <Card>
        <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_1fr_1fr_1fr_auto]">
          <input type="date" name="du" defaultValue={sp.du} aria-label="Du" className={inputClass} />
          <input type="date" name="au" defaultValue={sp.au} aria-label="Au" className={inputClass} />
          <input name="agent" defaultValue={sp.agent} placeholder="Code agent (ex. TRT-0001)" className={inputClass} />
          <input name="action" defaultValue={sp.action} placeholder="Action (ex. téléchargée, statut)" className={inputClass} />
          <input name="dossier" defaultValue={sp.dossier} placeholder="N° de dossier" className={inputClass} />
          <button className={`rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.primary}`}>Filtrer</button>
        </form>
        {error && <p className="text-sm text-brand-red-dark">{error.message}</p>}
        {rows.length === 0 ? (
          <Empty>Aucune entrée pour ces critères.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Agent</th>
                  <th className="px-3 py-2.5">Action</th>
                  <th className="px-3 py-2.5">Dossier</th>
                  <th className="px-5 py-2.5">Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs tabular-nums text-slate-500">{formatDateTime(r.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-navy">{r.actor_code ?? "système"}</td>
                    <td className="px-3 py-2.5">{r.action}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {r.dossier_id && numberOf(r.dossier_id) ? (
                        <Link href={`/dossiers/${r.dossier_id}`} className="font-mono text-xs text-navy hover:text-brand-red">{numberOf(r.dossier_id)}</Link>
                      ) : (
                        <span className="text-xs text-slate-400">{r.object_type}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-600">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>{total} entrée(s) · page {page} / {Math.max(1, Math.ceil(total / PAGE))}</span>
          <span className="flex gap-2">
            {page > 1 && <a className={`rounded-lg px-3 py-1.5 text-xs ${buttonClass.secondary}`} href={`?${params}&page=${page - 1}`}>Précédent</a>}
            {page * PAGE < total && <a className={`rounded-lg px-3 py-1.5 text-xs ${buttonClass.secondary}`} href={`?${params}&page=${page + 1}`}>Suivant</a>}
          </span>
        </div>
      </Card>
    </div>
  );
}
