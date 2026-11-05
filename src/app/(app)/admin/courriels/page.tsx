import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, PageTitle, StatTile, inputClass } from "@/components/ui";
import { sendTestEmailAction, updateEmailSettingsAction } from "@/app/actions";
import { formatDateTime } from "@/lib/labels";

type Status = { key_configured: boolean; pg_net_enabled: boolean; sent_7d: number; failed_7d: number; pending: number };
type LogRow = {
  id: number; created_at: string; agent_code: string | null; full_name: string; to_email: string;
  kind: string; subject: string; status: string; attempts: number; last_error: string | null; sent_at: string | null;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  en_attente: { label: "En attente", tone: "bg-slate-100 text-slate-700" },
  transmis: { label: "Transmis", tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" },
  envoye: { label: "Envoyé", tone: "bg-emerald-50 text-emerald-700" },
  echec: { label: "Échec", tone: "bg-brand-red-light text-brand-red-dark ring-1 ring-brand-red/30" },
};
const KINDS: Record<string, string> = { notifications: "Notifications", resume: "Résumé du jour", test: "Test" };

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-brand-red-light text-brand-red-dark"}`}>
        {ok ? "✓" : "!"}
      </span>
      <span className="text-slate-700">{children}</span>
    </li>
  );
}

export default async function CourrielsPage() {
  await requireRole("ADM", "CHF");
  const settings = await getSettings();
  const supabase = await createClient();
  const [{ data: st }, { data: log }] = await Promise.all([
    supabase.rpc("email_status").maybeSingle(),
    supabase.rpc("email_log", { p_limit: 100 }),
  ]);
  const status = (st ?? { key_configured: false, pg_net_enabled: false, sent_7d: 0, failed_7d: 0, pending: 0 }) as Status;
  const rows = (log ?? []) as LogRow[];
  const ready = status.key_configured && status.pg_net_enabled && !!settings.url_application;

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Administration" sub="Un agent qui n'est pas connecté reçoit par courriel les notifications qu'il n'a pas lues. Les courriels ne contiennent ni nom de client ni pièce : seulement le numéro de dossier et un lien vers la plateforme.">
        Notifications par courriel
      </PageTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Envoi" value={settings.courriel_actif && ready ? "Actif" : "Arrêté"} tone={settings.courriel_actif && ready ? "emerald" : "amber"} />
        <StatTile label="Envoyés (7 jours)" value={status.sent_7d} tone="emerald" />
        <StatTile label="Échecs (7 jours)" value={status.failed_7d} tone="red" />
        <StatTile label="En cours" value={status.pending} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Mise en service">
          <ul className="space-y-2">
            <Check ok={status.pg_net_enabled}>Extension <span className="font-mono">pg_net</span> activée dans Supabase (Database &gt; Extensions)</Check>
            <Check ok={status.key_configured}>Clé d&apos;envoi Resend rangée dans le coffre Supabase sous le nom <span className="font-mono">resend_api_key</span></Check>
            <Check ok={!!settings.url_application && !settings.url_application.includes("localhost")}>Adresse publique de la plateforme renseignée ci-contre</Check>
            <Check ok={settings.courriel_actif}>Envoi activé</Check>
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            La clé n&apos;est jamais saisie dans la plateforme : elle se range directement dans Supabase (voir le fichier README, section Courriels).
            L&apos;adresse d&apos;expédition doit appartenir à un domaine vérifié chez Resend.
          </p>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ActionForm action={sendTestEmailAction} submitLabel="M'envoyer un courriel de test" variant="secondary" size="sm" className="space-y-2">
              <span />
            </ActionForm>
          </div>
        </Card>

        <Card title="Paramètres">
          <ActionForm action={updateEmailSettingsAction} submitLabel="Enregistrer">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
              <input type="checkbox" name="courriel_actif" defaultChecked={settings.courriel_actif} className="mt-1 accent-navy" />
              <span>
                <span className="block font-medium text-slate-900">Envoyer les notifications par courriel</span>
                <span className="text-xs text-slate-500">Chaque agent peut aussi choisir, dans son profil, un résumé quotidien ou aucun courriel.</span>
              </span>
            </label>
            <Field label="Adresse d'expédition">
              <input name="courriel_expediteur" required defaultValue={settings.courriel_expediteur} className={inputClass} placeholder="BalCanis <notifications@balcanis.ca>" />
            </Field>
            <Field label="Adresse de la plateforme (liens dans les courriels)">
              <input name="url_application" type="url" required defaultValue={settings.url_application} className={inputClass} placeholder="https://dossiers.balcanis.ca" />
            </Field>
            <Field label="Délai avant l'envoi d'une notification non lue (minutes)">
              <input name="courriel_delai_minutes" type="number" min={0} max={240} defaultValue={settings.courriel_delai_minutes} className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>

      <Card title="Derniers courriels">
        {rows.length === 0 ? (
          <Empty>Aucun courriel envoyé pour le moment.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Destinataire</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Objet</th>
                  <th className="px-5 py-2.5">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = STATUS[r.status] ?? STATUS.en_attente;
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateTime(r.created_at)}</td>
                      <td className="px-3 py-3">
                        <span className="block text-slate-900">{r.full_name || r.to_email}</span>
                        <span className="font-mono text-xs text-slate-500">{r.agent_code ?? r.to_email}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{KINDS[r.kind] ?? r.kind}</td>
                      <td className="px-3 py-3 text-slate-900">{r.subject}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>
                        {r.attempts > 1 && <span className="ml-2 text-xs text-slate-500">{r.attempts} essais</span>}
                        {r.last_error && <p className="mt-1 max-w-xs text-xs text-brand-red-dark">{r.last_error}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
