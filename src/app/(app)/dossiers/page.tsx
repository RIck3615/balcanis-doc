import { createClient } from "@/lib/supabase/server";
import type { DossierWithClient } from "@/lib/types";
import { DossierTable } from "@/components/DossierTable";
import { Card, PageTitle, inputClass } from "@/components/ui";
import { STATUS_LABELS, pad2 } from "@/lib/labels";

export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; programme?: string }>;
}) {
  const { q, statut, programme } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("dossiers")
    .select("*, clients(client_code, first_name, last_name)")
    .order("opened_at", { ascending: false })
    .limit(500);
  if (statut) query = query.eq("status", Number(statut));
  if (programme) query = query.eq("program_code", programme);
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    query = query.ilike("number", `%${term}%`);
  }
  const { data, error } = await query;
  const { data: programs } = await supabase.from("programs").select("code, name").order("code");

  return (
    <div className="space-y-4">
      <PageTitle>Dossiers</PageTitle>
      <form className="flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q} placeholder="N° de dossier" className={`${inputClass} max-w-xs`} />
        <select name="statut" defaultValue={statut ?? ""} className={`${inputClass} max-w-xs`}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([code, label]) => (
            <option key={code} value={code}>{pad2(Number(code))} {label}</option>
          ))}
        </select>
        <select name="programme" defaultValue={programme ?? ""} className={`${inputClass} max-w-xs`}>
          <option value="">Tous les programmes</option>
          {(programs ?? []).map((p) => (
            <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
          ))}
        </select>
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">Filtrer</button>
      </form>
      <Card>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : <DossierTable dossiers={(data ?? []) as DossierWithClient[]} />}
      </Card>
    </div>
  );
}
