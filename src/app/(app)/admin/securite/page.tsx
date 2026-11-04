import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Avatar, Flag, ROLE_ORDER, RoleChip } from "@/components/AgentBits";
import { Card, Field, PageTitle, StatTile, inputClass } from "@/components/ui";
import { forceSignOutAction, resetMfaAction, updateSettingsAction } from "@/app/actions";
import { formatDateTime } from "@/lib/labels";
import type { AppRole } from "@/lib/types";

type Row = {
  id: string; email: string; full_name: string; agent_code: string | null; roles: AppRole[]; active: boolean;
  last_sign_in_at: string | null; mfa_enabled: boolean; must_change_password: boolean; banned: boolean; open_sessions: number;
};

export default async function SecuritePage() {
  const me = await requireRole("ADM", "CHF");
  const settings = await getSettings();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("security_overview");
  const rows = (data ?? []) as Row[];
  const active = rows.filter((r) => r.active);
  const withMfa = active.filter((r) => r.mfa_enabled).length;
  const dormant = active.filter((r) => !r.last_sign_in_at || Date.now() - new Date(r.last_sign_in_at).getTime() > 30 * 864e5).length;

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Administration" sub="Accès au compte, double authentification et règles de sécurité de la plateforme. Chaque modification est inscrite au journal d'audit.">
        Sécurité
      </PageTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Comptes actifs" value={active.length} />
        <StatTile label="Avec double authentification" value={`${withMfa} / ${active.length}`} tone={withMfa === active.length ? "emerald" : "amber"} />
        <StatTile label="Sans connexion depuis 30 jours" value={dormant} tone="amber" />
        <StatTile label="Mots de passe temporaires" value={active.filter((r) => r.must_change_password).length} tone="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Règles de sécurité" className="lg:col-span-1">
          <ActionForm action={updateSettingsAction} submitLabel="Enregistrer les règles">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-navy has-[:checked]:bg-navy-light/40">
              <input type="checkbox" name="mfa_obligatoire" defaultChecked={settings.mfa_obligatoire} className="mt-1 accent-navy" />
              <span>
                <span className="block text-sm font-medium text-slate-900">Double authentification obligatoire</span>
                <span className="block text-xs text-slate-500">
                  Tout le personnel doit saisir un code de son téléphone. Sans elle, la base refuse l&apos;accès aux dossiers.
                  Activez d&apos;abord la vôtre dans Mon profil.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-navy has-[:checked]:bg-navy-light/40">
              <input type="checkbox" name="telechargement_traitement" defaultChecked={settings.telechargement_traitement} className="mt-1 accent-navy" />
              <span>
                <span className="block text-sm font-medium text-slate-900">Téléchargement par les agents de traitement</span>
                <span className="block text-xs text-slate-500">Décoché : ils consultent les pièces dans la plateforme sans pouvoir les enregistrer ni télécharger le ZIP.</span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inactivité (min)" hint="Déconnexion automatique">
                <input name="inactivite_minutes" type="number" min={5} max={480} defaultValue={settings.inactivite_minutes} className={inputClass} />
              </Field>
              <Field label="Fichier max (Mo)" hint="PDF, JPG, PNG">
                <input name="taille_max_fichier_mo" type="number" min={1} max={50} defaultValue={settings.taille_max_fichier_mo} className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="Accès des comptes" className="lg:col-span-2">
          {error && <p className="mb-3 text-sm text-brand-red-dark">{error.message}</p>}
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Compte</th>
                  <th className="px-3 py-2.5">Dernière connexion</th>
                  <th className="px-3 py-2.5">Protection</th>
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.full_name || r.email} active={r.active} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{r.full_name || r.email}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span className="font-mono text-xs text-slate-500">{r.agent_code ?? "Sans code"}</span>
                            {ROLE_ORDER.filter((x) => r.roles.includes(x)).map((x) => <RoleChip key={x} role={x} short />)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {r.last_sign_in_at ? formatDateTime(r.last_sign_in_at) : "Jamais connecté"}
                      {r.open_sessions > 0 && <span className="block text-slate-400">{r.open_sessions} session(s) ouverte(s)</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.mfa_enabled ? <Flag tone="emerald">2FA active</Flag> : <Flag tone="amber">Sans 2FA</Flag>}
                        {r.must_change_password && <Flag tone="amber">Mot de passe temporaire</Flag>}
                        {!r.active && <Flag tone="slate">Désactivé</Flag>}
                        {r.banned && <Flag tone="red">Connexion bloquée</Flag>}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col items-end gap-1.5">
                        {r.open_sessions > 0 && r.id !== me.id && (
                          <ActionForm action={forceSignOutAction} submitLabel="Déconnecter partout" variant="secondary" size="sm" className="flex items-center gap-2"
                            confirmMessage={`Fermer toutes les sessions de ${r.full_name || r.email} ?`}>
                            <input type="hidden" name="user" value={r.id} />
                          </ActionForm>
                        )}
                        {r.mfa_enabled && r.id !== me.id && (
                          <ActionForm action={resetMfaAction} submitLabel="Réinitialiser la 2FA" variant="secondary" size="sm" className="flex items-center gap-2"
                            confirmMessage="L'agent devra réactiver sa double authentification (téléphone perdu ou changé). Continuer ?">
                            <input type="hidden" name="user" value={r.id} />
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Pour désactiver un compte (départ, suspension), décochez « Compte actif » dans sa fiche agent : la connexion est bloquée, ses sessions
            sont fermées et il perd l&apos;accès à tous les dossiers, sans effacer l&apos;historique.
          </p>
        </Card>
      </div>
    </div>
  );
}
