import Link from "next/link";
import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DossierWithClient } from "@/lib/types";
import { DossierTable } from "@/components/DossierTable";
import { Card, PageTitle, buttonClass, inputClass } from "@/components/ui";
import { STATUS_LABELS, pad2 } from "@/lib/labels";

export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; programme?: string }>;
}) {
  const { q, statut, programme } = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  let query = supabase
    .from("dossiers")
    .select("*, clients(client_code, first_name, last_name)")
    .order("opened_at", { ascending: false })
    .limit(500);
  if (statut) query = query.eq("status", Number(statut));
  if (programme) query = query.eq("program_code", programme);
  if (q) query = query.ilike("number", `%${q.replace(/[%,()]/g, " ").trim()}%`);
  const { data, error } = await query;
  const { data: programs } = await supabase.from("programs").select("code, name").order("code");
  const rows = (data ?? []) as DossierWithClient[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Dossiers" sub={`${rows.length} dossier(s) affiché(s)`}>Tous les dossiers</PageTitle>
        {hasRole(profile, "GBR", "CHF", "ADM") && (
          <Link href="/dossiers/nouveau" className={`mb-6 rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.primary}`}>
            Ouvrir un dossier
          </Link>
        )}
      </div>
      <Card>
        <form className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input name="q" defaultValue={q} placeholder="Rechercher un numéro de dossier" className={inputClass} />
          <select name="statut" defaultValue={statut ?? ""} className={inputClass}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{pad2(Number(code))} · {label}</option>
            ))}
          </select>
          <select name="programme" defaultValue={programme ?? ""} className={inputClass}>
            <option value="">Tous les programmes</option>
            {(programs ?? []).map((p) => (
              <option key={p.code} value={p.code}>{p.code} · {p.name}</option>
            ))}
          </select>
          <button className={`rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>Filtrer</button>
        </form>
        {error ? <p className="text-sm text-brand-red-dark">{error.message}</p> : <DossierTable dossiers={rows} />}
      </Card>
    </div>
  );
}
