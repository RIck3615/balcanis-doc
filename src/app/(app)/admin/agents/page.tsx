import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, inputClass } from "@/components/ui";
import { adminSetProfileAction, approvePaymentAction, setAvailabilityAction } from "@/app/actions";
import { ROLE_LABELS } from "@/lib/labels";
import { CreateAgentForm, ResetPasswordForm } from "@/components/AgentAccountForms";
import type { AgentPayment, AppRole, Profile } from "@/lib/types";

const ALL_ROLES: AppRole[] = ["TRT", "CTL", "COL", "GBR", "CHF", "ADM"];

export default async function AgentsPage() {
  await requireRole("ADM", "CHF");
  const supabase = await createClient();
  const [{ data: profiles }, { data: offices }, { data: payments }] = await Promise.all([
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name"),
    supabase.from("offices").select("code, name").order("code"),
    supabase.from("agent_payments").select("*"), // visible seulement par l'administrateur
  ]);
  const list = (profiles ?? []) as Profile[];
  const payOf = (id: string) => ((payments ?? []) as AgentPayment[]).find((x) => x.agent_id === id);

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Administration" sub="Créez les comptes des agents, attribuez leurs rôles et gérez leur accès. Le code agent (ex. TRT-0003) est généré à partir du premier rôle coché.">
        Agents
      </PageTitle>
      <Card title="Nouvel agent">
        <CreateAgentForm offices={offices ?? []} />
      </Card>
      {list.map((p) => (
        <Card
          key={p.id}
          title={`${p.agent_code ?? "Sans code"} · ${p.full_name || p.email}${p.active ? "" : " (inactif)"}`}
          actions={
            p.roles.includes("COL") ? (
              <ActionForm action={setAvailabilityAction} submitLabel={p.available ? "Marquer indisponible" : "Marquer disponible"} variant="secondary" className="flex items-center gap-2">
                <input type="hidden" name="user" value={p.id} />
                <input type="hidden" name="available" value={p.available ? "false" : "true"} />
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.available ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {p.available ? "Disponible" : "Indisponible"}
                </span>
              </ActionForm>
            ) : undefined
          }
        >
          <ActionForm action={adminSetProfileAction} submitLabel="Enregistrer" variant="secondary">
            <input type="hidden" name="user" value={p.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom complet"><input name="full_name" defaultValue={p.full_name} className={inputClass} /></Field>
              <Field label="Courriel"><input value={p.email} disabled className={`${inputClass} bg-slate-50`} /></Field>
              <Field label="Bureau (pour COL et GBR)">
                <select name="office" defaultValue={p.office_code ?? ""} className={inputClass}>
                  <option value="">Aucun (agent à distance)</option>
                  {(offices ?? []).map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}</option>)}
                </select>
              </Field>
              <Field label="Taux horaire (CAD, agents de traitement)">
                <input name="hourly_rate" defaultValue={p.hourly_rate ?? ""} inputMode="decimal" className={inputClass} />
              </Field>
              <Field label="Programmes certifiés" hint="Codes séparés par des virgules (ex. PE, EE-CEC), ou * pour tous.">
                <input name="certified" defaultValue={p.certified_programs.join(", ")} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="active" defaultChecked={p.active} /> Compte actif
              </label>
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">Rôles</legend>
              <div className="flex flex-wrap gap-4">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1">
                    <input type="checkbox" name="roles" value={r} defaultChecked={p.roles.includes(r)} /> {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            {p.must_change_password && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Mot de passe temporaire, pas encore changé</span>
            )}
            <ResetPasswordForm userId={p.id} email={p.email} />
          </div>
          {payOf(p.id) && (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
              <p>
                Paiement : {payOf(p.id)!.method} · {payOf(p.id)!.frequency} · {payOf(p.id)!.details}
                {payOf(p.id)!.pending && <strong className="ml-2 text-amber-800">changement à confirmer</strong>}
              </p>
              {payOf(p.id)!.pending && (
                <ActionForm action={approvePaymentAction} submitLabel="Confirmer ces coordonnées" variant="secondary" className="mt-2">
                  <input type="hidden" name="user" value={p.id} />
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
