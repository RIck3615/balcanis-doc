import { createClient } from "@/lib/supabase/server";
import { queryAudit } from "@/lib/audit-query";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("session_ok");
  const { data: roles } = await supabase.from("profiles").select("roles").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").single();
  if (!allowed || !roles?.roles?.some((r: string) => r === "ADM" || r === "CHF")) return new Response("Accès refusé", { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { data } = await queryAudit(supabase, sp, 10000);
  const rows = (data ?? []).map((r) => [r.created_at, r.actor_code, (r.actor_roles ?? []).join(","), r.action, r.object_type, r.object_id, r.dossier_id, r.reason]);
  return csvResponse(`journal-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(["Date (UTC)", "Agent", "Rôles", "Action", "Objet", "Identifiant", "Dossier (id)", "Motif"], rows));
}
