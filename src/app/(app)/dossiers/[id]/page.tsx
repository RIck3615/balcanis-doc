import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getSettings } from "@/lib/settings";
import { signAvatars } from "@/lib/avatars";
import { Avatar } from "@/components/AgentBits";
import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { actorCan, isDedicatedTransition } from "@/lib/permissions";
import {
  RETURN_REASONS, STATUS_LABELS, daysUntil, expiryLabel, formatDate, formatDateTime, formatDuration, pad2, personLabel,
} from "@/lib/labels";
import type {
  AuditEntry, AuthorityRequest, ChecklistItem, Client, DossierForm, DocumentCategory, DocumentRow, DocumentType, Dossier, Member,
  Review, StaffEntry, StatusTransition, TimeSession,
} from "@/lib/types";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, StatusBadge, inputClass } from "@/components/ui";
import { DocumentUpload } from "@/components/DocumentUpload";
import { OpenDocumentButton } from "@/components/OpenDocumentButton";
import { DownloadDocumentButton, DownloadDossierButton } from "@/components/DownloadButtons";
import { FormUploadButton } from "@/components/FormUploadButton";
import { RequestsPanel } from "@/components/RequestsPanel";
import { Timer } from "@/components/Timer";
import {
  addMemberAction, assignAction, correctSessionAction, submitDossierAction, submitReviewAction,
  setDocumentExpiryAction, transitionAction, validateHoursAction,
} from "@/app/actions";

export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: dossierData } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
  if (!dossierData) notFound();
  const d = dossierData as Dossier;

  const [
    { data: client }, { data: members }, { data: documents }, { data: types }, { data: categories },
    { data: missing }, { data: staff }, { data: transitions }, { data: reviews }, { data: checklist },
    { data: sessions }, { data: activeSession }, { data: audit }, { data: program }, { data: statuses },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", d.client_id).maybeSingle(),
    supabase.from("dossier_members").select("*").eq("dossier_id", id).order("person_code"),
    supabase.from("documents").select("*").eq("dossier_id", id).order("category_code").order("type_code").order("version", { ascending: false }),
    supabase.from("document_types").select("*").eq("active", true).order("label"),
    supabase.from("document_categories").select("*").order("code"),
    supabase.rpc("missing_documents", { p_dossier: id }),
    supabase.from("staff_directory").select("*").eq("active", true).order("full_name"),
    supabase.from("status_transitions").select("*").eq("from_status", d.status),
    supabase.from("reviews").select("*").eq("dossier_id", id).order("created_at", { ascending: false }),
    supabase.from("checklist_items").select("*").eq("active", true).or(`program_code.is.null,program_code.eq.${d.program_code}`).order("sort"),
    supabase.from("time_sessions").select("*").eq("dossier_id", id).order("started_at", { ascending: false }),
    supabase.from("time_sessions").select("dossier_id, started_at, dossiers(number)").eq("agent_id", profile.id).is("ended_at", null).maybeSingle(),
    supabase.from("audit_log").select("id, created_at, actor_code, action, object_type, reason").eq("dossier_id", id).order("id", { ascending: false }).limit(300),
    supabase.from("programs").select("name").eq("code", d.program_code).maybeSingle(),
    supabase.from("dossier_statuses").select("code, timer_open, billable").eq("code", d.status).single(),
  ]);
  const { data: formsData } = await supabase.rpc("dossier_forms", { p_dossier: id });
  const { data: canDownload } = await supabase.rpc("can_download");
  const { data: requestsData } = await supabase.from("authority_requests").select("*").eq("dossier_id", id).order("due_on");
  const requests = (requestsData ?? []) as AuthorityRequest[];
  const settings = await getSettings();
  const forms = (formsData ?? []) as DossierForm[];
  const formsMissing = forms.filter((f) => !f.document_id).length;

  const staffList = (staff ?? []) as StaffEntry[];
  const people = [d.collector_id, d.processor_id, d.controller_id].map((uid) => staffList.find((x) => x.id === uid));
  const avatarUrls = await signAvatars(supabase, people.map((x) => x?.avatar_path));
  const nameOf = (uid: string | null) => {
    if (!uid) return "Non assigné";
    const s = staffList.find((x) => x.id === uid);
    return s ? `${s.agent_code ?? ""} · ${s.full_name}` : "Inconnu";
  };
  const memberList = (members ?? []) as Member[];
  const docList = (documents ?? []) as DocumentRow[];
  const categoryList = (categories ?? []) as DocumentCategory[];
  const typeList = (types ?? []) as DocumentType[];
  const typeLabel = (code: string) => typeList.find((t) => t.code === code)?.label ?? code;
  const items = (checklist ?? []) as ChecklistItem[];
  const sessionList = (sessions ?? []) as TimeSession[];

  const closed = d.status === 90 || d.status === 99;
  const expiringSoon = closed ? [] : docList
    .filter((x) => x.is_current && x.expires_on && daysUntil(x.expires_on) <= 90)
    .sort((a, b) => a.expires_on!.localeCompare(b.expires_on!));
  const isProcessor = hasRole(profile, "TRT") && d.processor_id === profile.id;
  const isController = hasRole(profile, "CTL") && d.controller_id === profile.id && d.processor_id !== profile.id;
  const isManager = actorCan(profile, d, ["GBR", "CHF", "ADM"]);
  const canUpload = !closed && (d.status !== 80 || hasRole(profile, "CHF")) && actorCan(profile, d, ["COL", "TRT", "GBR", "CHF", "ADM"]);
  const canAddMember = d.status < 40 && actorCan(profile, d, ["COL", "TRT", "GBR", "CHF", "ADM"]);
  const simpleTransitions = ((transitions ?? []) as StatusTransition[]).filter(
    (t) => !isDedicatedTransition(t.from_status, t.to_status) && actorCan(profile, d, t.roles),
  );

  const active = activeSession
    ? {
        dossier_id: activeSession.dossier_id as string,
        started_at: activeSession.started_at as string,
        number: (activeSession.dossiers as unknown as { number: string } | null)?.number ?? "",
      }
    : null;

  const totalMs = (filter: (s: TimeSession) => boolean) =>
    sessionList.filter((s) => s.ended_at && filter(s)).reduce((acc, s) => acc + (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()), 0);

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <section className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-sm">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[28px] border-white/5" aria-hidden />
        <div className="absolute -bottom-24 right-24 h-48 w-48 rounded-full border-[24px] border-brand-red/25" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              {d.program_code} · {program?.name}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">{d.number}</p>
            <p className="mt-2 text-sm text-white/80">
              {client ? (
                <>
                  <span className="font-semibold text-white">{(client as Client).last_name}</span> {(client as Client).first_name}
                  <span className="ml-2 font-mono text-xs text-white/60">{(client as Client).client_code}</span>
                </>
              ) : (
                "Client inconnu"
              )}
              <span className="mx-2 text-white/40">|</span>Bureau {d.office_code}
              <span className="mx-2 text-white/40">|</span>Ouvert le {formatDate(d.opened_at)}
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full bg-white p-0.5 inline-block"><StatusBadge status={d.status} /></span>
            <p className="mt-2 text-xs text-white/70">depuis le {formatDateTime(d.status_changed_at)}</p>
            {d.return_count > 0 && (
              <p className="mt-1 inline-block rounded-full bg-brand-red px-2.5 py-0.5 text-xs font-medium">{d.return_count} renvoi(s)</p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Personnes assignées */}
          <Card title="Intervenants">
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              {([["Agent de collecte", 0], ["Agent de traitement", 1], ["Contrôleur", 2]] as const).map(([label, i]) => {
                const who = people[i];
                return (
                  <div key={label} className="flex items-center gap-2.5">
                    {who ? <Avatar name={who.full_name} size="sm" src={who.avatar_path ? avatarUrls[who.avatar_path] : null} /> : <span className="h-7 w-7 shrink-0 rounded-full border border-dashed border-slate-300" />}
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="truncate">{who ? `${who.agent_code ?? ""} · ${who.full_name}` : "Non assigné"}</dd>
                    </div>
                  </div>
                );
              })}
              {d.submission_number && (
                <div><dt className="text-xs text-slate-500">N° de demande</dt><dd className="font-mono">{d.submission_number} ({formatDate(d.submitted_at)})</dd></div>
              )}
              {d.decision && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Décision</dt><dd>{d.decision}</dd></div>}
            </dl>
          </Card>

          {/* Suivi après la soumission */}
          {[80, 85, 90].includes(d.status) && (
            <RequestsPanel
              dossier={d}
              requests={requests}
              canManage={actorCan(profile, d, ["GBR", "CHF"])}
              isChief={hasRole(profile, "CHF")}
              myAssigneeRoles={[
                ...(d.collector_id === profile.id ? (["COL"] as const) : []),
                ...(d.processor_id === profile.id ? (["TRT"] as const) : []),
              ]}
              nameOf={(role) => nameOf(role === "COL" ? d.collector_id : d.processor_id)}
            />
          )}

          {/* Formulaires officiels du programme */}
          {d.status >= 20 && d.status !== 99 && forms.length > 0 && (
            <Card
              title={`Formulaires du programme ${d.program_code}`}
              actions={
                formsMissing > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">{formsMissing} à téléverser</span>
                ) : (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Complets</span>
                )
              }
            >
              {isProcessor && [30, 55, 75].includes(d.status) && (
                <p className="mb-3 text-sm text-slate-600">
                  Remplissez chaque formulaire officiel, enregistrez-le en PDF, puis téléversez-le ici. Le nom du fichier est attribué automatiquement.
                  Le dossier ne peut pas partir au contrôle tant qu&apos;un formulaire manque.
                </p>
              )}
              <ul className="-mx-5 divide-y divide-slate-100">
                {forms.map((f) => (
                  <li key={f.person_code + f.type_code} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${f.document_id ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {f.document_id ? "✓" : "!"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <span className="font-mono text-xs font-semibold text-navy">{f.form_number}</span>{" "}
                        <span className="font-medium text-slate-900">{f.label}</span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        {f.person_code} · {personLabel(f.person_code)}
                        {f.document_id ? ` · v${String(f.version).padStart(2, "0")} du ${formatDateTime(f.uploaded_at)}` : " · pas encore téléversé"}
                        {f.official_url && (
                          <>
                            {" · "}
                            <a href={f.official_url} target="_blank" rel="noreferrer" className="font-medium text-navy underline hover:text-brand-red">
                              formulaire officiel
                            </a>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {f.document_id && <OpenDocumentButton documentId={f.document_id} />}
                      {isProcessor && [30, 55, 75].includes(d.status) && (
                        <FormUploadButton dossierId={id} person={f.person_code} type={f.type_code} hasVersion={!!f.document_id} maxMb={settings.taille_max_fichier_mo} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Auto-vérification par l'agent de traitement */}
          {isProcessor && [30, 55, 75].includes(d.status) && (
            <Card title="Auto-vérification avant le contrôle">
              <ChecklistForm dossierId={id} level="auto" items={items.filter((i) => i.level === "auto")} submitLabel="Envoyer au contrôle" />
            </Card>
          )}

          {/* Contrôle */}
          {isController && d.status === 50 && (
            <Card title="Liste de contrôle">
              <p className="mb-3 text-sm text-slate-600">Un seul point non conforme renvoie le dossier à l&apos;agent de traitement (statut 55).</p>
              <ChecklistForm dossierId={id} level="controle" items={items.filter((i) => i.level === "controle")} submitLabel="Enregistrer le contrôle" withReasons />
            </Card>
          )}

          {/* Pièces manquantes */}
          {!closed && d.status < 40 && (
            <Card title={`Pièces obligatoires manquantes (${(missing ?? []).length})`}>
              {(missing ?? []).length === 0 ? (
                <Empty>Toutes les pièces obligatoires sont présentes.</Empty>
              ) : (
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {(missing as { person_code: string; type_code: string; type_label: string }[]).map((m) => (
                    <li key={m.person_code + m.type_code} className="flex gap-2">
                      <span className="font-mono text-xs text-slate-500">{m.person_code}</span>{m.type_label}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {expiringSoon.length > 0 && (
            <div className="rounded-2xl border border-brand-red/25 bg-brand-red-light/60 p-4">
              <p className="text-sm font-semibold text-brand-red-dark">
                {expiringSoon.length === 1 ? "Une pièce expire" : `${expiringSoon.length} pièces expirent`} dans les 90 jours ou sont déjà expirées
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {expiringSoon.map((doc) => {
                  const e = expiryLabel(daysUntil(doc.expires_on!));
                  return (
                    <li key={doc.id} className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.tone}`}>{e.text}</span>
                      <span className="text-slate-900">{typeLabel(doc.type_code)}</span>
                      <span className="font-mono text-xs text-slate-500">{doc.person_code}</span>
                      <span className="text-xs text-slate-500">· {formatDate(doc.expires_on)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-600">Demandez au client la pièce renouvelée et déposez-la : la nouvelle version remplace l&apos;ancienne.</p>
            </div>
          )}

          {/* Pièces, rangées par sous-dossier */}
          <Card
            title="Pièces du dossier"
            actions={docList.length > 0 && canDownload ? <DownloadDossierButton dossierId={id} hasOldVersions={docList.some((x) => !x.is_current)} /> : undefined}
          >
            {docList.length === 0 && <Empty>Aucune pièce déposée.</Empty>}
            <div className="space-y-3">
              {categoryList.map((c) => {
                const inCat = docList.filter((doc) => doc.category_code === c.code);
                if (inCat.length === 0) return null;
                const current = inCat.filter((doc) => doc.is_current);
                const older = inCat.filter((doc) => !doc.is_current);
                return (
                  <div key={c.code}>
                    <p className="flex items-center gap-2 font-mono text-xs font-semibold text-navy">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-red" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></svg>
                      {c.folder}
                    </p>
                    <ul className="mt-1 divide-y divide-slate-100">
                      {current.map((doc) => (
                        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                          <span>
                            <span className="font-mono text-xs">{doc.file_name}</span>
                            <span className="ml-2 text-slate-500">{typeLabel(doc.type_code)} · {doc.person_code}</span>
                            {doc.expires_on && (() => {
                              const e = expiryLabel(daysUntil(doc.expires_on));
                              return (
                                <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                                  expire le {formatDate(doc.expires_on)}
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.tone}`}>{e.text}</span>
                                </span>
                              );
                            })()}
                          </span>
                          <span className="flex items-center gap-2">
                            {canUpload && (
                              <details className="relative">
                                <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-surface hover:text-navy">
                                  {doc.expires_on ? "Corriger la date" : "Ajouter une date"}
                                </summary>
                                <div className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                                  <ActionForm action={setDocumentExpiryAction} submitLabel="Enregistrer" size="sm" className="space-y-2">
                                    <input type="hidden" name="document" value={doc.id} />
                                    <input type="hidden" name="dossier" value={id} />
                                    <label className="block text-xs font-medium text-slate-700">
                                      Date d&apos;expiration
                                      <input type="date" name="expires_on" defaultValue={doc.expires_on ?? ""} className={`${inputClass} mt-1`} />
                                    </label>
                                  </ActionForm>
                                </div>
                              </details>
                            )}
                            <OpenDocumentButton documentId={doc.id} />
                            {canDownload && <DownloadDocumentButton documentId={doc.id} />}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {older.length > 0 && (
                      <details className="mt-1 text-xs text-slate-500">
                        <summary className="cursor-pointer">{older.length} version(s) précédente(s)</summary>
                        <ul className="mt-1 space-y-1">
                          {older.map((doc) => (
                            <li key={doc.id} className="flex items-center gap-2">
                              <span className="font-mono">{doc.file_name}</span>
                              <span className="flex items-center gap-2">
                            <OpenDocumentButton documentId={doc.id} />
                            {canDownload && <DownloadDocumentButton documentId={doc.id} />}
                          </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {canUpload && (
            <Card title="Déposer une pièce">
              <DocumentUpload dossierId={id} members={memberList} categories={categoryList} types={typeList} maxMb={settings.taille_max_fichier_mo} />
            </Card>
          )}

          {/* Historique des contrôles */}
          {(reviews ?? []).length > 0 && (
            <Card title="Vérifications et contrôles">
              <ul className="space-y-2 text-sm">
                {((reviews ?? []) as Review[]).map((r) => (
                  <li key={r.id} className="rounded-md border border-slate-100 p-2">
                    <p>
                      <span className="font-medium">{r.level === "auto" ? "Auto-vérification" : "Contrôle"}</span>{" "}
                      <span className={r.result === "renvoye" ? "text-amber-800" : "text-emerald-700"}>
                        {r.result === "renvoye" ? `renvoyé ${r.return_code ?? ""}` : "accepté"}
                      </span>{" "}
                      <span className="text-xs text-slate-500">· {nameOf(r.reviewer_id)} · {formatDateTime(r.created_at)}</span>
                    </p>
                    {r.reason_codes.length > 0 && <p className="text-xs">Motifs : {r.reason_codes.map((c) => RETURN_REASONS[c] ?? c).join(", ")}</p>}
                    {r.comment && <p className="text-xs text-slate-700">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Journal */}
          <Card title="Journal du dossier">
            <ol className="max-h-96 space-y-2 overflow-y-auto border-l-2 border-navy-light pl-4 text-xs">
              {((audit ?? []) as AuditEntry[]).map((a) => (
                <li key={a.id} className="relative flex flex-wrap gap-x-2">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-navy" aria-hidden />
                  <span className="shrink-0 text-slate-500 tabular-nums">{formatDateTime(a.created_at)}</span>
                  <span className="shrink-0 font-mono font-medium text-navy">{a.actor_code ?? "système"}</span>
                  <span>{a.action.replace("pièce telechargement", "pièce téléchargée").replace("pièce consultation", "pièce consultée")}{a.reason ? <span className="text-slate-500"> : {a.reason}</span> : null}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Colonne de droite : actions */}
        <div className="space-y-5">
          {simpleTransitions.length > 0 && (
            <Card title="Actions">
              <div className="space-y-4">
                {simpleTransitions.map((t) => (
                  <ActionForm
                    key={t.to_status}
                    action={transitionAction}
                    submitLabel={t.to_status === 99 ? "Annuler le dossier" : `Passer à « ${STATUS_LABELS[t.to_status]} »`}
                    variant={t.to_status === 99 ? "danger" : "primary"}
                    confirmMessage={t.to_status === 99 ? "Annuler définitivement ce dossier ?" : undefined}
                  >
                    <input type="hidden" name="dossier" value={id} />
                    <input type="hidden" name="to" value={t.to_status} />
                    {t.reason_required && (
                      <Field label={t.to_status === 90 ? "Décision reçue" : "Motif (obligatoire)"}>
                        <textarea name="reason" required rows={2} className={inputClass} />
                      </Field>
                    )}
                  </ActionForm>
                ))}
              </div>
            </Card>
          )}

          {hasRole(profile, "CHF") && d.status === 70 && (
            <Card title="Soumission aux autorités">
              <ActionForm action={submitDossierAction} submitLabel="Marquer comme soumis" confirmMessage="Confirmer la soumission ?">
                <input type="hidden" name="dossier" value={id} />
                <Field label="Numéro de demande (accusé de réception)">
                  <input name="submission_number" required className={inputClass} />
                </Field>
              </ActionForm>
              <p className="mt-2 text-xs text-slate-500">Déposez aussi le paquet soumis et l&apos;accusé de réception dans 12_SOUMISSION.</p>
            </Card>
          )}

          {isProcessor && !closed && (
            <Card title="Chronomètre">
              <Timer dossierId={id} canRun={!!statuses?.timer_open} billable={!!statuses?.billable} active={active} />
            </Card>
          )}

          {isManager && !closed && d.status !== 80 && (
            <Card title="Assignation">
              <div className="space-y-4">
                {d.status >= 15 && (
                  <AssignForm dossier={d} role="TRT" label="Agent de traitement"
                    agents={staffList.filter((s) => s.roles.includes("TRT") && (s.certified_programs.includes(d.program_code) || s.certified_programs.includes("*")) && s.id !== d.controller_id)}
                    reasonRequired={d.processor_id !== null} />
                )}
                <AssignForm dossier={d} role="COL" label="Agent de collecte"
                  agents={staffList.filter((s) => s.roles.includes("COL"))} reasonRequired={d.collector_id !== null} />
                {d.status >= 40 && (
                  <AssignForm dossier={d} role="CTL" label="Contrôleur"
                    agents={staffList.filter((s) => s.roles.includes("CTL") && s.id !== d.processor_id)} reasonRequired />
                )}
              </div>
            </Card>
          )}

          <Card title="Personnes du dossier">
            <ul className="space-y-1 text-sm">
              {memberList.map((m) => (
                <li key={m.id}>
                  <span className="font-mono text-xs text-slate-500">{m.person_code}</span> {m.last_name} {m.first_name}
                  <span className="text-xs text-slate-500"> · {personLabel(m.person_code)}{m.accompanying ? "" : " (n'accompagne pas)"}</span>
                </li>
              ))}
            </ul>
            {canAddMember && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">Ajouter une personne</summary>
                <ActionForm action={addMemberAction} submitLabel="Ajouter" className="mt-2 space-y-2">
                  <input type="hidden" name="dossier" value={id} />
                  <Field label="Code" hint="C = conjoint, E1, E2… = enfants, G = garant">
                    <input name="person_code" required pattern="C|G|E[1-9][0-9]?" className={inputClass} />
                  </Field>
                  <Field label="Prénom"><input name="first_name" required className={inputClass} /></Field>
                  <Field label="Nom"><input name="last_name" required className={inputClass} /></Field>
                  <Field label="Date de naissance"><input type="date" name="birth_date" className={inputClass} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="accompanying" defaultChecked /> Accompagne le demandeur</label>
                </ActionForm>
              </details>
            )}
          </Card>

          {sessionList.length > 0 && (
            <Card title="Temps passé">
              <p className="text-sm">
                Payé : <strong>{formatDuration(totalMs((s) => s.billable))}</strong>
                {" · "}validé : {formatDuration(totalMs((s) => s.billable && s.validated))}
                {" · "}non payé : {formatDuration(totalMs((s) => !s.billable))}
              </p>
              <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">
                {sessionList.map((s) => (
                  <li key={s.id}>
                    {formatDateTime(s.started_at)} · {s.ended_at ? formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) : "en cours"}
                    {" · "}statut {pad2(s.status_at_start)}{s.billable ? "" : " (non payé)"}
                    {s.corrected ? " · corrigée" : ""}{s.validated ? " · validée" : ""}
                    {s.end_reason === "inactivite" ? " · arrêt pour inactivité" : ""}
                  </li>
                ))}
              </ul>
              {isManager && d.status >= 60 && d.status !== 99 && (
                <div className="mt-3">
                  <ActionForm action={validateHoursAction} submitLabel="Valider les heures" variant="secondary">
                    <input type="hidden" name="dossier" value={id} />
                  </ActionForm>
                </div>
              )}
              {actorCan(profile, d, ["GBR", "ADM"]) && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm underline">Corriger une session</summary>
                  <ActionForm action={correctSessionAction} submitLabel="Corriger" className="mt-2 space-y-2">
                    <input type="hidden" name="dossier" value={id} />
                    <Field label="Session">
                      <select name="session" required className={inputClass}>
                        {sessionList.filter((s) => s.ended_at).map((s) => (
                          <option key={s.id} value={s.id}>{formatDateTime(s.started_at)} → {formatDateTime(s.ended_at)}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Début (heure UTC)"><input type="datetime-local" name="started" required className={inputClass} /></Field>
                    <Field label="Fin (heure UTC)"><input type="datetime-local" name="ended" required className={inputClass} /></Field>
                    <Field label="Motif"><input name="reason" required className={inputClass} /></Field>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecklistForm({
  dossierId, level, items, submitLabel, withReasons,
}: { dossierId: string; level: "auto" | "controle"; items: ChecklistItem[]; submitLabel: string; withReasons?: boolean }) {
  return (
    <ActionForm action={submitReviewAction} submitLabel={submitLabel}>
      <input type="hidden" name="dossier" value={dossierId} />
      <input type="hidden" name="level" value={level} />
      <ol className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="text-sm">
            <p className="font-medium">{i.label}</p>
            <div className="mt-1 flex flex-wrap gap-4">
              {[["conforme", "Conforme"], ["non_conforme", "Non conforme"], ["sans_objet", "Sans objet"]].map(([v, l]) => (
                <label key={v} className="flex items-center gap-1">
                  <input type="radio" name={`item_${i.id}`} value={v} required /> {l}
                </label>
              ))}
            </div>
            {level === "controle" && <input name={`comment_${i.id}`} placeholder="Remarque (facultatif)" className={`${inputClass} mt-1`} />}
          </li>
        ))}
      </ol>
      {withReasons && (
        <fieldset className="text-sm">
          <legend className="font-medium">En cas de renvoi : motif(s)</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {Object.entries(RETURN_REASONS).map(([code, label]) => (
              <label key={code} className="flex items-center gap-1"><input type="checkbox" name="reason_codes" value={code} /> {label}</label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label={withReasons ? "Commentaire (obligatoire en cas de renvoi)" : "Commentaire (facultatif)"}>
        <textarea name="comment" rows={2} className={inputClass} />
      </Field>
    </ActionForm>
  );
}

function AssignForm({
  dossier, role, label, agents, reasonRequired,
}: { dossier: Dossier; role: "TRT" | "COL" | "CTL"; label: string; agents: StaffEntry[]; reasonRequired: boolean }) {
  return (
    <ActionForm action={assignAction} submitLabel={reasonRequired ? "Réassigner" : "Assigner"} variant="secondary" className="space-y-2">
      <input type="hidden" name="dossier" value={dossier.id} />
      <input type="hidden" name="role" value={role} />
      <Field label={label} hint={role === "TRT" ? `Seuls les agents certifiés ${dossier.program_code} sont proposés.` : undefined}>
        <select name="agent" required className={inputClass} defaultValue="">
          <option value="" disabled>Choisir…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.agent_code} · {a.full_name}</option>)}
        </select>
      </Field>
      {reasonRequired && <Field label="Motif"><input name="reason" required className={inputClass} /></Field>}
    </ActionForm>
  );
}

