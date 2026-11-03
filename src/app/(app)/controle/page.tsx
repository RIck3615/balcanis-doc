import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DossierWithClient } from "@/lib/types";
import { DossierTable } from "@/components/DossierTable";
import { Card, PageTitle } from "@/components/ui";

export default async function ControlePage() {
  const profile = await requireRole("CTL");
  const supabase = await createClient();
  const { data } = await supabase
    .from("dossiers")
    .select("*, clients(client_code, first_name, last_name)")
    .in("status", [40, 50])
    .order("status_changed_at", { ascending: true });
  const rows = (data ?? []) as DossierWithClient[];
  const queue = rows.filter((d) => d.status === 40 && d.processor_id !== profile.id);
  const mine = rows.filter((d) => d.status === 50 && d.controller_id === profile.id);

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Contrôle" sub="Les dossiers que vous avez traités n'apparaissent jamais ici.">File de contrôle</PageTitle>
      <Card title={`Mes contrôles en cours (${mine.length})`}>
        <DossierTable dossiers={mine} empty="Aucun contrôle en cours." />
      </Card>
      <Card title={`Prêts au contrôle, du plus ancien au plus récent (${queue.length})`}>
        <DossierTable dossiers={queue} empty="La file est vide." />
        <p className="mt-2 text-xs text-slate-500">Ouvrez un dossier puis cliquez sur « → 50 En contrôle » pour le prendre en charge.</p>
      </Card>
    </div>
  );
}
