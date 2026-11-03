import { getProfile } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, inputClass } from "@/components/ui";
import { updateMyPaymentAction } from "@/app/actions";
import { ROLE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AgentPayment } from "@/lib/types";

export default async function ProfilPage() {
  const p = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("agent_payments").select("*").eq("agent_id", p.id).maybeSingle();
  const pay = data as AgentPayment | null;
  return (
    <div className="max-w-2xl space-y-4">
      <PageTitle>Mon profil</PageTitle>
      <Card title="Identité">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Nom</dt><dd>{p.full_name || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Courriel</dt><dd>{p.email}</dd></div>
          <div><dt className="text-xs text-slate-500">Code agent</dt><dd className="font-mono">{p.agent_code ?? "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Rôles</dt><dd>{p.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Bureau</dt><dd>{p.office_code ?? "À distance"}</dd></div>
          <div><dt className="text-xs text-slate-500">Programmes certifiés</dt><dd>{p.certified_programs.join(", ") || "—"}</dd></div>
        </dl>
      </Card>
      <Card title="Paiement">
        <p className="mb-3 text-sm text-slate-600">
          Vous choisissez comment et à quelle fréquence vous êtes payé. Tout changement est confirmé par l&apos;administrateur avant le paiement suivant.
          {pay?.pending && <strong className="ml-1 text-amber-800">Changement en attente de confirmation.</strong>}
        </p>
        <ActionForm action={updateMyPaymentAction} submitLabel="Enregistrer">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Moyen de paiement">
              <select name="method" required defaultValue={pay?.method ?? ""} className={inputClass}>
                <option value="" disabled>Choisir…</option>
                <option>Virement bancaire</option>
                <option>Mobile money</option>
                <option>Transfert d&apos;argent</option>
                <option>Autre</option>
              </select>
            </Field>
            <Field label="Fréquence">
              <select name="frequency" required defaultValue={pay?.frequency ?? ""} className={inputClass}>
                <option value="" disabled>Choisir…</option>
                <option>Chaque semaine</option>
                <option>Toutes les deux semaines</option>
                <option>Chaque mois</option>
              </select>
            </Field>
          </div>
          <Field label="Coordonnées" hint="Numéro de compte, numéro mobile money, etc.">
            <textarea name="details" required rows={2} defaultValue={pay?.details ?? ""} className={inputClass} />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
