import { createClient } from "@/lib/supabase/server";
import { csvResponse, toCsv } from "@/lib/csv";

// Relevé mensuel pour la paie : une ligne par agent et par dossier
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Accès refusé", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("roles").eq("id", user.id).single();
  const manager = me?.roles?.some((r: string) => ["GBR", "CHF", "ADM"].includes(r));
  const mois = new URL(request.url).searchParams.get("mois") ?? "";
  const month = /^\d{4}-\d{2}$/.test(mois) ? mois : new Date().toISOString().slice(0, 7);
  let q = supabase.from("time_summary").select("*").eq("month", `${month}-01T00:00:00+00:00`).order("agent_code");
  if (!manager) q = q.eq("agent_id", user.id);
  const { data } = await q;
  const n = (v: unknown) => Number(v ?? 0).toFixed(2).replace(".", ",");
  const rows = (data ?? []).map((r) => [
    month, r.agent_code, r.full_name, r.number, n(r.billable_hours), n(r.validated_hours), n(r.unpaid_hours),
    r.hourly_rate != null ? n(r.hourly_rate) : "", r.hourly_rate != null ? n(Number(r.validated_hours ?? 0) * Number(r.hourly_rate)) : "",
  ]);
  return csvResponse(`heures-${month}.csv`,
    toCsv(["Mois", "Code agent", "Agent", "Dossier", "Heures payables", "Heures validées", "Heures non payées", "Taux (CAD/h)", "Montant validé (CAD)"], rows));
}
