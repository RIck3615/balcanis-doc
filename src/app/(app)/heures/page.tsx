import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageTitle, inputClass } from "@/components/ui";

type Row = {
  agent_id: string;
  agent_code: string | null;
  full_name: string;
  dossier_id: string;
  number: string;
  month: string;
  billable_hours: number | null;
  validated_hours: number | null;
  unpaid_hours: number | null;
  hourly_rate: number | null;
};

export default async function HeuresPage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const profile = await requireRole("TRT", "GBR", "CHF", "ADM");
  const { mois } = await searchParams;
  const month = mois && /^\d{4}-\d{2}$/.test(mois) ? mois : new Date().toISOString().slice(0, 7);
  const supabase = await createClient();
  let query = supabase.from("time_summary").select("*").eq("month", `${month}-01T00:00:00+00:00`).order("agent_code");
  if (!hasRole(profile, "GBR", "CHF", "ADM")) query = query.eq("agent_id", profile.id);
  const { data, error } = await query;
  const rows = (data ?? []) as Row[];

  const byAgent = new Map<string, { code: string; name: string; rate: number | null; billable: number; validated: number; unpaid: number; rows: Row[] }>();
  for (const r of rows) {
    const a = byAgent.get(r.agent_id) ?? { code: r.agent_code ?? "", name: r.full_name, rate: r.hourly_rate, billable: 0, validated: 0, unpaid: 0, rows: [] };
    a.billable += Number(r.billable_hours ?? 0);
    a.validated += Number(r.validated_hours ?? 0);
    a.unpaid += Number(r.unpaid_hours ?? 0);
    a.rows.push(r);
    byAgent.set(r.agent_id, a);
  }
  const money = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n);
  const hours = (n: number) => n.toFixed(2).replace(".", ",");

  return (
    <div className="space-y-4">
      <PageTitle sub="Seules les heures validées (après acceptation au contrôle) sont payées. Le temps de correction (statut 55) est mesuré mais non payé.">
        Heures et paie
      </PageTitle>
      <form className="flex items-end gap-2">
        <input type="month" name="mois" defaultValue={month} className={`${inputClass} max-w-xs`} />
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">Afficher</button>
      </form>
      {error && <p className="text-sm text-red-700">{error.message}</p>}
      {byAgent.size === 0 && <p className="text-sm text-slate-500">Aucune heure pour ce mois.</p>}
      {[...byAgent.entries()].map(([agentId, a]) => (
        <Card key={agentId} title={`${a.code} · ${a.name}`}>
          <p className="mb-2 text-sm">
            Heures payables : <strong>{hours(a.billable)}</strong> · validées : <strong>{hours(a.validated)}</strong> · non payées : {hours(a.unpaid)}
            {a.rate != null && <> · montant validé : <strong>{money(a.validated * a.rate)}</strong> (taux {money(a.rate)}/h)</>}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-1">Dossier</th><th className="py-1 text-right">Payables</th><th className="py-1 text-right">Validées</th><th className="py-1 text-right">Non payées</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.dossier_id} className="border-b border-slate-100">
                  <td className="py-1 font-mono">{r.number}</td>
                  <td className="py-1 text-right tabular-nums">{hours(Number(r.billable_hours ?? 0))}</td>
                  <td className="py-1 text-right tabular-nums">{hours(Number(r.validated_hours ?? 0))}</td>
                  <td className="py-1 text-right tabular-nums">{hours(Number(r.unpaid_hours ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
