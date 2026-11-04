import { ActionForm } from "./ActionForm";
import { Card, Empty, Field, inputClass } from "./ui";
import { addRequestAction, cancelRequestAction, markRequestAnsweredAction, markRequestReadyAction } from "@/app/actions";
import { REQUEST_KINDS, REQUEST_STATUS, dueLabel, formatDate, formatDateTime } from "@/lib/labels";
import type { AuthorityRequest, Dossier } from "@/lib/types";

type Props = {
  dossier: Dossier;
  requests: AuthorityRequest[];
  canManage: boolean; // gestionnaire du bureau, chef
  isChief: boolean; // seul le chef envoie la réponse à l'autorité
  myAssigneeRoles: ("COL" | "TRT")[]; // rôles dans lesquels l'utilisateur est chargé de ce dossier
  nameOf: (role: "COL" | "TRT") => string;
};

const STATUS_TONE: Record<string, string> = {
  a_faire: "bg-amber-50 text-amber-800 ring-amber-200",
  prete: "bg-sky-50 text-sky-800 ring-sky-200",
  repondue: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  annulee: "bg-slate-100 text-slate-500 ring-slate-200",
};

// Suivi après la soumission : demandes de l'autorité (IRCC, MIFI) et leurs échéances
export function RequestsPanel({ dossier, requests, canManage, isChief, myAssigneeRoles, nameOf }: Props) {
  const open = requests.filter((r) => r.status === "a_faire" || r.status === "prete");
  const closed = requests.filter((r) => !open.includes(r));
  const editable = dossier.status === 80 || dossier.status === 85;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card
      title="Suivi après la soumission"
      actions={
        open.length > 0 ? (
          <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-800">{open.length} demande(s) ouverte(s)</span>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Demandes de l&apos;autorité reçues après le dépôt (biométrie, examen médical, pièces supplémentaires…). La décision ne peut être enregistrée
        qu&apos;une fois toutes les demandes répondues.
        {dossier.submission_number && (
          <span className="ml-1">N° de demande : <span className="font-mono text-slate-800">{dossier.submission_number}</span>.</span>
        )}
      </p>

      {requests.length === 0 && <Empty>Aucune demande de l&apos;autorité pour l&apos;instant.</Empty>}

      <ul className="space-y-3">
        {[...open, ...closed].map((r) => {
          const due = dueLabel(r.due_on);
          const mine = myAssigneeRoles.includes(r.assignee_role);
          return (
            <li key={r.id} className={`rounded-xl border p-4 ${r.status === "a_faire" && due.text.startsWith("En retard") ? "border-brand-red/40 bg-brand-red-light/30" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{REQUEST_KINDS[r.kind] ?? r.kind}</p>
                  <p className="font-medium text-slate-900">{r.title}</p>
                  {r.details && <p className="mt-0.5 text-sm text-slate-600">{r.details}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    Reçue le {formatDate(r.received_on)} · à préparer par {r.assignee_role === "COL" ? "l'agent de collecte" : "l'agent de traitement"} ({nameOf(r.assignee_role)})
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[r.status]}`}>{REQUEST_STATUS[r.status]}</span>
                  {(r.status === "a_faire" || r.status === "prete") && (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${due.tone}`}>
                      {due.text} · {formatDate(r.due_on)}
                    </span>
                  )}
                </div>
              </div>

              {r.ready_note && <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm text-slate-700">Préparé : {r.ready_note}</p>}
              {r.status === "repondue" && <p className="mt-2 text-xs text-emerald-700">Réponse envoyée le {formatDate(r.sent_on)}</p>}
              {r.status === "annulee" && <p className="mt-2 text-xs text-slate-500">Annulée : {r.cancel_reason}</p>}

              {editable && (r.status === "a_faire" || r.status === "prete") && (
                <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-100 pt-3">
                  {r.status === "a_faire" && (mine || canManage) && (
                    <ActionForm action={markRequestReadyAction} submitLabel="Marquer comme prête" variant="secondary" size="sm" className="flex flex-1 flex-wrap items-end gap-2">
                      <input type="hidden" name="request" value={r.id} />
                      <input type="hidden" name="dossier" value={dossier.id} />
                      <input name="note" required placeholder="Ce qui a été préparé (ex. relevés déposés dans 06_FINANCES)" className={`${inputClass} min-w-56 flex-1`} />
                    </ActionForm>
                  )}
                  {isChief && (
                    <ActionForm action={markRequestAnsweredAction} submitLabel="Réponse envoyée" variant="success" size="sm" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="request" value={r.id} />
                      <input type="hidden" name="dossier" value={dossier.id} />
                      <input type="date" name="sent_on" required defaultValue={today} max={today} aria-label="Date d'envoi" className={`${inputClass} w-40`} />
                    </ActionForm>
                  )}
                  {canManage && (
                    <details className="w-full text-sm">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-brand-red">Annuler la demande</summary>
                      <ActionForm action={cancelRequestAction} submitLabel="Annuler" variant="danger" size="sm" className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="request" value={r.id} />
                        <input type="hidden" name="dossier" value={dossier.id} />
                        <input name="reason" required placeholder="Motif (ex. demande retirée par IRCC)" className={`${inputClass} min-w-56 flex-1`} />
                      </ActionForm>
                    </details>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Enregistrée le {formatDateTime(r.created_at)}</p>
            </li>
          );
        })}
      </ul>

      {canManage && editable && (
        <details className="mt-5 rounded-xl border border-dashed border-slate-300 p-4" open={requests.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-navy">Enregistrer une demande de l&apos;autorité</summary>
          <ActionForm action={addRequestAction} submitLabel="Enregistrer la demande" className="mt-4 space-y-3">
            <input type="hidden" name="dossier" value={dossier.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select name="kind" required className={inputClass} defaultValue="pieces">
                  {Object.entries(REQUEST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="À préparer par">
                <select name="assignee_role" required className={inputClass} defaultValue="TRT">
                  <option value="TRT" disabled={!dossier.processor_id}>Agent de traitement ({nameOf("TRT")})</option>
                  <option value="COL" disabled={!dossier.collector_id}>Agent de collecte ({nameOf("COL")})</option>
                </select>
              </Field>
            </div>
            <Field label="Ce que demande l'autorité">
              <input name="title" required placeholder="Ex. Relevés bancaires des 6 derniers mois" className={inputClass} />
            </Field>
            <Field label="Détails (facultatif)" hint="Référence de la lettre, instructions particulières. Déposez la lettre elle-même dans 13_CORRESPONDANCE.">
              <textarea name="details" rows={2} className={inputClass} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reçue le"><input type="date" name="received_on" defaultValue={today} max={today} className={inputClass} /></Field>
              <Field label="Date limite de réponse"><input type="date" name="due_on" required min={today} className={inputClass} /></Field>
            </div>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
