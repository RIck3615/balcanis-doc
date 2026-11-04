import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditFilters = { du?: string; au?: string; agent?: string; action?: string; dossier?: string };

// Requête du journal d'audit avec filtres (lecture réservée par RLS au chef et à l'administrateur)
export async function queryAudit(supabase: SupabaseClient, f: AuditFilters, limit: number, offset = 0) {
  let q = supabase
    .from("audit_log")
    .select("id, created_at, actor_code, actor_roles, dossier_id, action, object_type, object_id, reason", { count: "exact" })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (f.du && /^\d{4}-\d{2}-\d{2}$/.test(f.du)) q = q.gte("created_at", `${f.du}T00:00:00Z`);
  if (f.au && /^\d{4}-\d{2}-\d{2}$/.test(f.au)) q = q.lte("created_at", `${f.au}T23:59:59Z`);
  if (f.agent) q = q.ilike("actor_code", `%${f.agent.replace(/[%_,()]/g, "")}%`);
  if (f.action) q = q.ilike("action", `%${f.action.replace(/[%_,()]/g, "")}%`);
  if (f.dossier) {
    const { data: d } = await supabase.from("dossiers").select("id").ilike("number", `%${f.dossier.replace(/[%_,()]/g, "")}%`).limit(50);
    const ids = (d ?? []).map((x) => x.id as string);
    q = q.in("dossier_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  return q;
}
