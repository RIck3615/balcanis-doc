import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { ResetPasswordForm } from "@/components/AgentAccountForms";
import { Avatar, Flag, ROLE_ORDER, RoleChip } from "@/components/AgentBits";
import { DossierTable } from "@/components/DossierTable";
import { Card, Field, inputClass } from "@/components/ui";
import { adminSetProfileAction, approvePaymentAction, setAvailabilityAction } from "@/app/actions";
import { ROLE_LABELS, formatDateTime } from "@/lib/labels";
import type { AgentPayment, DossierWithClient, Profile } from "@/lib/types";

const ROLE_HELP: Record<string, string> = {
  TRT: "Traite les dossiers, payé à l'heure",
  CTL: "Contrôle les dossiers des autres",
  COL: "Collecte au bureau",
  GBR: "Ouvre et assigne les dossiers du bureau",
  CHF: "Valide et soumet",
  ADM: "Gère les comptes et la paie",
};

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADM", "CHF");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: profile }, { data: offices }, { data: payment }, { data: dossiers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("offices").select("code, name").order("code"),
    supabase.from("agent_payments").select("*").eq("agent_id", id).maybeSingle(),
    supabase
      .from("dossiers")
      .select("*, clients(client_code, first_name, last_name)")
      .or(`collector_id.eq.${id},processor_id.eq.${id},controller_id.eq.${id}`)
      .lt("status", 90)
      .order("status_changed_at"),
  ]);
  if (!profile) notFound();
  const p = profile as Profile;
  const pay = payment as AgentPayment | null;
  const isMe = p.id === me.id;

  return (
    <div className="space-y-5">
      <Link href="/admin/agents" className="inline-block text-sm font-medium text-navy hover:text-brand-red">‹ Retour aux agents</Link>

      {/* Fiche */}
      <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.05)]">
        <Avatar name={p.full_name || p.email} active={p.active} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">{p.full_name || "Sans nom"}</h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{p.agent_code ?? "Sans code"}</span> · {p.email} · {p.office_code ? `Bureau ${p.office_code}` : "À distance"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ROLE_ORDER.filter((r) => p.roles.includes(r)).map((r) => <RoleChip key={r} role={r} />)}
            {!p.active && <Flag tone="slate">Compte inactif</Flag>}
            {p.must_change_password && <Flag tone="amber">Mot de passe temporaire</Flag>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums text-navy">{(dossiers ?? []).length}</p>
          <p className="text-xs uppercase tracking-wide text-slate-500">dossiers en cours</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Rôles et accès */}
        <Card title="Rôles et paramètres" className="lg:col-span-2">
          <ActionForm action={adminSetProfileAction} submitLabel="Enregistrer les modifications">
            <input type="hidden" name="user" value={p.id} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Rôles</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLE_ORDER.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-navy/40 has-[:checked]:border-navy has-[:checked]:bg-navy-light/50">
                    <input type="checkbox" name="roles" value={r} defaultChecked={p.roles.includes(r)} className="mt-0.5 accent-navy" />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{ROLE_LABELS[r]}</span>
                      <span className="block text-xs text-slate-500">{ROLE_HELP[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom complet"><input name="full_name" defaultValue={p.full_name} className={inputClass} /></Field>
              <Field label="Bureau" hint="Obligatoire pour la collecte et les gestionnaires.">
                <select name="office" defaultValue={p.office_code ?? ""} className={inputClass}>
                  <option value="">Aucun (agent à distance)</option>
                  {(offices ?? []).map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}</option>)}
                </select>
              </Field>
              <Field label="Programmes certifiés" hint="Codes séparés par des virgules (ex. PE, EE-CEC), ou * pour tous.">
                <input name="certified" defaultValue={p.certified_programs.join(", ")} className={inputClass} />
              </Field>
              <Field label="Taux horaire (CAD)">
                <input name="hourly_rate" defaultValue={p.hourly_rate ?? ""} inputMode="decimal" className={inputClass} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={p.active} disabled={isMe} className="accent-navy" />
              Compte actif {isMe ? "(vous ne pouvez pas désactiver votre propre compte)" : "(décocher bloque l'accès sans supprimer l'historique)"}
              {isMe && <input type="hidden" name="active" value="on" />}
            </label>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          {p.roles.includes("COL") && (
            <Card title="Disponibilité">
              <p className="mb-3 text-sm text-slate-600">
                {p.available
                  ? "Reçoit les nouveaux dossiers à collecter (le moins chargé en premier)."
                  : "Ne reçoit plus de nouveaux dossiers à collecter."}
              </p>
              <ActionForm
                action={setAvailabilityAction}
                submitLabel={p.available ? "Marquer indisponible" : "Marquer disponible"}
                variant={p.available ? "secondary" : "success"}
              >
                <input type="hidden" name="user" value={p.id} />
                <input type="hidden" name="available" value={p.available ? "false" : "true"} />
              </ActionForm>
            </Card>
          )}

          <Card title="Accès">
            <p className="mb-3 text-sm text-slate-600">
              {p.must_change_password
                ? "L'agent n'a pas encore choisi son mot de passe."
                : "L'agent utilise son propre mot de passe."}
            </p>
            {isMe ? (
              <Link href="/mot-de-passe" className="text-sm font-medium text-navy underline">Changer mon mot de passe</Link>
            ) : (
              <ResetPasswordForm userId={p.id} email={p.email} />
            )}
          </Card>

          <Card title="Paiement">
            {pay ? (
              <div className="space-y-2 text-sm">
                <p><span className="text-slate-500">Moyen :</span> {pay.method}</p>
                <p><span className="text-slate-500">Fréquence :</span> {pay.frequency}</p>
                <p><span className="text-slate-500">Coordonnées :</span> <span className="font-mono">{pay.details}</span></p>
                <p className="text-xs text-slate-500">Mis à jour le {formatDateTime(pay.updated_at)}</p>
                {pay.pending ? (
                  <ActionForm action={approvePaymentAction} submitLabel="Confirmer ces coordonnées" variant="success" className="space-y-2 pt-2">
                    <input type="hidden" name="user" value={p.id} />
                    <Flag tone="red">Changement à confirmer avant le prochain paiement</Flag>
                  </ActionForm>
                ) : (
                  <Flag tone="emerald">Confirmées</Flag>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {p.roles.includes("TRT") ? "L'agent n'a pas encore indiqué comment être payé (dans Mon profil)." : "Pas de coordonnées (non payé à l'heure)."}
              </p>
            )}
          </Card>
        </div>
      </div>

      <Card title={`Dossiers en cours (${(dossiers ?? []).length})`}>
        <DossierTable dossiers={(dossiers ?? []) as DossierWithClient[]} empty="Aucun dossier en cours pour cet agent." />
      </Card>
    </div>
  );
}
