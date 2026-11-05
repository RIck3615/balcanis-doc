"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InlineViewer, type ViewerDoc } from "./DocumentViewer";
import { clearDocumentCheckAction, saveDocumentCheckAction, submitControlAction } from "@/app/actions";
import { RETURN_REASONS } from "@/lib/labels";

export type CheckPoint = { key: string; label: string; expected: string | null };
export type SavedCheck = { result: "conforme" | "non_conforme"; points: Record<string, "exact" | "inexact">; comment: string | null };
export type ControlDoc = ViewerDoc & { points: CheckPoint[]; check: SavedCheck | null; previous: { comment: string | null; round: number } | null };
export type ControlItem = { id: number; label: string };

type Answer = "conforme" | "non_conforme" | "sans_objet";
type Step = "pieces" | "liste" | "decision";

const seg = "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ring-1 ring-inset";

// Espace de contrôle : la pièce à gauche, ce qu'il faut vérifier à droite
export function ControlWorkspace({
  dossierId, number, round, docs, items, canDownload, watermark,
}: {
  dossierId: string; number: string; round: number; docs: ControlDoc[]; items: ControlItem[];
  canDownload: boolean; watermark: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(docs.find((d) => !d.check)?.id ?? docs[0]?.id ?? "");
  const [step, setStep] = useState<Step>("pieces");
  const [checks, setChecks] = useState<Record<string, SavedCheck | null>>(() => Object.fromEntries(docs.map((d) => [d.id, d.check])));
  const [drafts, setDrafts] = useState<Record<string, { points: Record<string, "exact" | "inexact">; comment: string }>>({});
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [commentTouched, setCommentTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // la liste de contrôle en cours est gardée sur cet appareil (reprise après une pause)
  const storeKey = `bc_ctl_${dossierId}_${round}`;
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (raw) {
        const v = JSON.parse(raw) as { answers?: Record<number, Answer>; remarks?: Record<number, string> };
        if (v.answers) setAnswers(v.answers);
        if (v.remarks) setRemarks(v.remarks);
      }
    } catch { /* stockage indisponible */ }
  }, [storeKey]);
  useEffect(() => {
    try { window.localStorage.setItem(storeKey, JSON.stringify({ answers, remarks })); } catch { /* ignoré */ }
  }, [storeKey, answers, remarks]);

  const doc = docs.find((d) => d.id === selected) ?? docs[0];
  const done = docs.filter((d) => checks[d.id]).length;
  const badDocs = docs.filter((d) => checks[d.id]?.result === "non_conforme");
  const answered = items.filter((i) => answers[i.id]).length;
  const badItems = items.filter((i) => answers[i.id] === "non_conforme");
  const willReturn = badDocs.length > 0 || badItems.length > 0;
  const ready = done === docs.length && answered === items.length;

  // commentaire de renvoi proposé à partir des points inexacts
  const suggested = useMemo(() => {
    const lines = [
      ...badDocs.map((d) => `${d.label} (${d.person}) : ${checks[d.id]?.comment ?? ""}`),
      ...badItems.map((i) => `${i.label}${remarks[i.id] ? ` : ${remarks[i.id]}` : ""}`),
    ];
    return lines.join("\n");
  }, [badDocs, badItems, checks, remarks]);
  useEffect(() => { if (!commentTouched) setComment(suggested); }, [suggested, commentTouched]);
  const [reasonsTouched, setReasonsTouched] = useState(false);
  useEffect(() => {
    if (!reasonsTouched && badDocs.length > 0 && reasons.length === 0) setReasons(["erreur_saisie"]);
  }, [badDocs.length, reasons.length, reasonsTouched]);

  if (!doc) return <p className="text-sm text-slate-500">Aucune pièce dans ce dossier.</p>;

  const draft = drafts[doc.id] ?? { points: checks[doc.id]?.points ?? {}, comment: checks[doc.id]?.comment ?? "" };
  const setDraft = (next: Partial<typeof draft>) => setDrafts((all) => ({ ...all, [doc.id]: { ...draft, ...next } }));
  const allAnswered = doc.points.every((p) => draft.points[p.key]);
  const anyInexact = doc.points.some((p) => draft.points[p.key] === "inexact");
  const saved = checks[doc.id];
  const dirty = !!drafts[doc.id];

  const nextUnchecked = (after: string) => {
    const i = docs.findIndex((d) => d.id === after);
    return [...docs.slice(i + 1), ...docs.slice(0, i)].find((d) => !checks[d.id] && d.id !== after)?.id;
  };

  function save() {
    setError(null);
    start(async () => {
      const res = await saveDocumentCheckAction(dossierId, doc.id, draft.points, draft.comment);
      if (res.error || !res.result) return setError(res.error ?? "Erreur");
      setChecks((c) => ({ ...c, [doc.id]: { result: res.result!, points: draft.points, comment: draft.comment || null } }));
      setDrafts((all) => { const n = { ...all }; delete n[doc.id]; return n; });
      const next = nextUnchecked(doc.id);
      if (next) setSelected(next);
      else setStep(answered === items.length ? "decision" : "liste");
    });
  }

  function reset() {
    setError(null);
    start(async () => {
      const res = await clearDocumentCheckAction(dossierId, doc.id);
      if (res.error) return setError(res.error);
      setChecks((c) => ({ ...c, [doc.id]: null }));
      setDrafts((all) => { const n = { ...all }; delete n[doc.id]; return n; });
    });
  }

  function submit() {
    setError(null);
    const msg = willReturn
      ? "Renvoyer le dossier à l'agent de traitement (statut 55) ?"
      : "Accepter le dossier et l'envoyer au chef du cabinet pour la validation finale ?";
    if (!window.confirm(msg)) return;
    start(async () => {
      const res = await submitControlAction({
        dossierId,
        answers: items.map((i) => ({ item_id: i.id, answer: answers[i.id], comment: remarks[i.id] })),
        comment,
        reasons: willReturn ? reasons : [],
      });
      if (res.error) return setError(res.error);
      try { window.localStorage.removeItem(storeKey); } catch { /* ignoré */ }
      router.push(`/dossiers/${dossierId}`);
      router.refresh();
    });
  }

  const dot = (d: ControlDoc) => {
    const c = checks[d.id];
    return c ? (c.result === "conforme" ? "bg-emerald-500" : "bg-brand-red") : "bg-slate-300";
  };

  const tabs: { key: Step; label: string; info: string }[] = [
    { key: "pieces", label: "1. Pièces", info: `${done}/${docs.length}` },
    { key: "liste", label: "2. Liste", info: `${answered}/${items.length}` },
    { key: "decision", label: "3. Décision", info: "" },
  ];

  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
      {/* la pièce */}
      <div className="h-[62vh] min-h-0 min-w-0 lg:h-full">
        <InlineViewer docs={docs} id={doc.id} onChange={(id) => { setSelected(id); setStep("pieces"); }} canDownload={canDownload} watermark={watermark} />
      </div>

      {/* ce qu'il faut vérifier */}
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]">
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-red">Contrôle · tour {round}</p>
              <Link href={`/dossiers/${dossierId}`} className="font-mono text-sm font-semibold text-navy hover:text-brand-red">{number}</Link>
            </div>
            <div className="text-right text-xs text-slate-500">
              <span className="font-semibold text-emerald-700">{done - badDocs.length} exacte(s)</span>
              {badDocs.length > 0 && <span className="ml-2 font-semibold text-brand-red-dark">{badDocs.length} non conforme(s)</span>}
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${((done + answered) / Math.max(1, docs.length + items.length)) * 100}%` }} />
          </div>
          <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => setStep(t.key)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${step === t.key ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}>
                {t.label} {t.info && <span className="font-normal text-slate-400">{t.info}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {step === "pieces" && (
            <div className="space-y-4">
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl bg-surface p-1.5">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setSelected(d.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${d.id === doc.id ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:bg-white/60"}`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dot(d)}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{d.label}</span>
                      <span className="font-mono text-slate-400">{d.person}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-navy">{doc.label}</h2>
                    <p className="font-mono text-[11px] text-slate-500">{doc.file_name}</p>
                  </div>
                  {saved && (
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${saved.result === "conforme" ? "bg-emerald-50 text-emerald-700" : "bg-brand-red-light text-brand-red-dark"}`}>
                      {saved.result === "conforme" ? "Conforme" : "Non conforme"}
                    </span>
                  )}
                </div>
                {doc.previous && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                    Signalée au tour {doc.previous.round} : {doc.previous.comment ?? "non conforme"}. Vérifiez la correction.
                  </p>
                )}
              </div>

              <ol className="space-y-2">
                {doc.points.map((p) => {
                  const v = draft.points[p.key];
                  return (
                    <li key={p.key} className={`rounded-xl border p-3 transition ${v === "inexact" ? "border-brand-red/40 bg-brand-red-light/40" : v === "exact" ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}>
                      <p className="text-sm text-slate-800">{p.label}</p>
                      {p.expected && <p className="mt-0.5 font-mono text-[13px] font-semibold text-navy">{p.expected}</p>}
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => setDraft({ points: { ...draft.points, [p.key]: "exact" } })}
                          className={`${seg} ${v === "exact" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50"}`}>
                          Exact
                        </button>
                        <button type="button" onClick={() => setDraft({ points: { ...draft.points, [p.key]: "inexact" } })}
                          className={`${seg} ${v === "inexact" ? "bg-brand-red text-white ring-brand-red" : "bg-white text-brand-red-dark ring-brand-red/30 hover:bg-brand-red-light"}`}>
                          Inexact
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {anyInexact && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-800">Ce qui est inexact <span className="text-brand-red">*</span></span>
                  <textarea rows={3} value={draft.comment} onChange={(e) => setDraft({ comment: e.target.value })}
                    placeholder="Ex. prénom « Mari » au lieu de « Marie » ; page 2 manquante"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15" />
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!allAnswered && (
                  <button type="button" onClick={() => setDraft({ points: Object.fromEntries(doc.points.map((p) => [p.key, draft.points[p.key] ?? "exact"])) })}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-50">
                    Le reste est exact
                  </button>
                )}
                <button type="button" onClick={save} disabled={pending || !allAnswered || (anyInexact && !draft.comment.trim()) || (!!saved && !dirty)}
                  className="flex-1 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-dark disabled:opacity-40">
                  {pending ? "Enregistrement…" : saved && !dirty ? "Pièce vérifiée" : "Enregistrer et passer à la suivante"}
                </button>
                {saved && (
                  <button type="button" onClick={reset} disabled={pending} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-brand-red-dark">
                    Annuler la vérification
                  </button>
                )}
              </div>
            </div>
          )}

          {step === "liste" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Points d&apos;ensemble du dossier. Un seul point non conforme renvoie le dossier.</p>
              {items.map((i) => {
                const v = answers[i.id];
                return (
                  <div key={i.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm text-slate-800">{i.label}</p>
                    <div className="mt-2 flex gap-1.5">
                      {([["conforme", "Conforme", "bg-emerald-600 ring-emerald-600"], ["non_conforme", "Non conforme", "bg-brand-red ring-brand-red"], ["sans_objet", "Sans objet", "bg-slate-600 ring-slate-600"]] as const).map(([val, label, on]) => (
                        <button key={val} type="button" onClick={() => setAnswers((a) => ({ ...a, [i.id]: val }))}
                          className={`${seg} ${v === val ? `${on} text-white` : "bg-white text-slate-600 ring-slate-200 hover:bg-surface"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {v === "non_conforme" && (
                      <input value={remarks[i.id] ?? ""} onChange={(e) => setRemarks((r) => ({ ...r, [i.id]: e.target.value }))}
                        placeholder="Précisez" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15" />
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={() => setStep("decision")} className="w-full rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark">
                Passer à la décision
              </button>
            </div>
          )}

          {step === "decision" && (
            <div className="space-y-4">
              <div className={`rounded-xl p-4 ${!ready ? "bg-surface" : willReturn ? "bg-brand-red-light/70" : "bg-emerald-50"}`}>
                <p className={`text-sm font-semibold ${!ready ? "text-slate-700" : willReturn ? "text-brand-red-dark" : "text-emerald-800"}`}>
                  {!ready ? "Contrôle incomplet" : willReturn ? "Le dossier sera renvoyé à l'agent de traitement" : "Le dossier sera accepté et envoyé au chef du cabinet"}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  <li>Pièces vérifiées : {done} sur {docs.length}{badDocs.length > 0 && `, dont ${badDocs.length} non conforme(s)`}</li>
                  <li>Liste de contrôle : {answered} réponse(s) sur {items.length}{badItems.length > 0 && `, dont ${badItems.length} non conforme(s)`}</li>
                </ul>
                {!ready && (
                  <button type="button" onClick={() => setStep(done < docs.length ? "pieces" : "liste")} className="mt-2 text-xs font-semibold text-navy underline">
                    Terminer {done < docs.length ? "les pièces" : "la liste"}
                  </button>
                )}
              </div>

              {willReturn && (
                <fieldset className="text-sm">
                  <legend className="mb-1.5 font-medium text-slate-800">Motif(s) du renvoi</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(RETURN_REASONS).map(([code, label]) => {
                      const on = reasons.includes(code);
                      return (
                        <button key={code} type="button" onClick={() => { setReasonsTouched(true); setReasons((r) => (on ? r.filter((x) => x !== code) : [...r, code])); }}
                          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${on ? "bg-navy text-white ring-navy" : "bg-white text-slate-600 ring-slate-200 hover:bg-surface"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-800">
                  Commentaire {willReturn ? <span className="text-brand-red">* (lu par l&apos;agent de traitement)</span> : "(facultatif)"}
                </span>
                <textarea rows={6} value={comment} onChange={(e) => { setComment(e.target.value); setCommentTouched(true); }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15" />
              </label>

              <button type="button" onClick={submit} disabled={pending || !ready || (willReturn && (!comment.trim() || reasons.length === 0))}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-40 ${willReturn ? "bg-brand-red hover:bg-brand-red-dark" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {pending ? "Enregistrement…" : willReturn ? "Renvoyer le dossier" : "Accepter le dossier"}
              </button>
            </div>
          )}

          {error && <p className="mt-3 rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
