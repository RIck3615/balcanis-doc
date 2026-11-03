import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, inputClass } from "@/components/ui";
import { addProgramFormAction, removeProgramFormAction, saveFormTypeAction } from "@/app/actions";
import type { DocumentType, Program } from "@/lib/types";

type ProgramForm = { id: number; program_code: string; type_code: string; person_scope: "P" | "ALL"; sort: number };

export default async function FormulairesPage({ searchParams }: { searchParams: Promise<{ programme?: string }> }) {
  await requireRole("ADM", "CHF");
  const supabase = await createClient();
  const [{ data: programs }, { data: types }, { data: links }] = await Promise.all([
    supabase.from("programs").select("*").order("family").order("code"),
    supabase.from("document_types").select("*").not("form_number", "is", null).eq("active", true).order("form_number"),
    supabase.from("program_forms").select("*").order("sort"),
  ]);
  const progs = (programs ?? []) as Program[];
  const forms = (types ?? []) as DocumentType[];
  const all = (links ?? []) as ProgramForm[];
  const { programme } = await searchParams;
  const current = progs.find((p) => p.code === programme) ?? progs[0];
  const assigned = all.filter((l) => l.program_code === current?.code);
  const formOf = (code: string) => forms.find((f) => f.code === code);
  const available = forms.filter((f) => !assigned.some((a) => a.type_code === f.code));
  const families = [...new Set(progs.map((p) => p.family))];

  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow="Administration"
        sub="Les formulaires officiels que l'agent de traitement doit remplir et téléverser pour chaque programme. Un dossier ne peut pas partir au contrôle tant qu'un formulaire manque. Vérifiez cette liste avec les guides en vigueur d'IRCC et du MIFI."
      >
        Formulaires par programme
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <nav className="-mx-2 max-h-[70vh] space-y-3 overflow-y-auto">
            {families.map((f) => (
              <div key={f}>
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{f}</p>
                {progs.filter((p) => p.family === f).map((p) => {
                  const n = all.filter((l) => l.program_code === p.code).length;
                  const on = p.code === current?.code;
                  return (
                    <a
                      key={p.code}
                      href={`/admin/formulaires?programme=${p.code}`}
                      className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${on ? "bg-navy text-white" : "text-slate-700 hover:bg-navy-light"}`}
                    >
                      <span className="font-mono text-xs">{p.code}</span>
                      <span className={`text-xs tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{n}</span>
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
        </Card>

        <div className="space-y-6">
          {current && (
            <Card title={`${current.code} · ${current.name}`}>
              {assigned.length === 0 ? (
                <p className="mb-4 rounded-xl bg-surface px-4 py-6 text-center text-sm text-slate-500">Aucun formulaire exigé pour ce programme.</p>
              ) : (
                <ul className="-mx-5 mb-5 divide-y divide-slate-100">
                  {assigned.map((a) => {
                    const f = formOf(a.type_code);
                    return (
                      <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <span className="w-24 font-mono text-xs font-semibold text-navy">{f?.form_number}</span>
                        <span className="min-w-0 flex-1 text-sm">
                          {f?.label}
                          {f?.official_url && (
                            <a href={f.official_url} target="_blank" rel="noreferrer" className="ml-2 text-xs font-medium text-navy underline">lien</a>
                          )}
                        </span>
                        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-slate-600">
                          {a.person_scope === "ALL" ? "Chaque personne du dossier" : "Demandeur principal"}
                        </span>
                        <form action={removeProgramFormAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="rounded-md px-2 py-1 text-xs font-medium text-brand-red-dark hover:bg-brand-red-light">Retirer</button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
              {available.length > 0 && (
                <ActionForm action={addProgramFormAction} submitLabel="Ajouter au programme" variant="secondary" className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                  <input type="hidden" name="program" value={current.code} />
                  <Field label="Formulaire">
                    <select name="type" required className={inputClass} defaultValue="">
                      <option value="" disabled>Choisir…</option>
                      {available.map((f) => <option key={f.code} value={f.code}>{f.form_number} · {f.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Pour">
                    <select name="scope" className={inputClass} defaultValue="P">
                      <option value="P">Demandeur principal</option>
                      <option value="ALL">Chaque personne</option>
                    </select>
                  </Field>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Catalogue des formulaires">
            <ul className="-mx-5 mb-5 divide-y divide-slate-100">
              {forms.map((f) => (
                <li key={f.code}>
                  <details className="group px-5 py-2.5">
                    <summary className="flex cursor-pointer items-center gap-3 text-sm">
                      <span className="w-24 font-mono text-xs font-semibold text-navy">{f.form_number}</span>
                      <span className="flex-1">{f.label}</span>
                      {!f.official_url && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">lien à ajouter</span>}
                      <span className="text-xs text-slate-400 group-open:hidden">modifier</span>
                    </summary>
                    <ActionForm action={saveFormTypeAction} submitLabel="Enregistrer" variant="secondary" className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                      <Field label="Numéro"><input name="number" defaultValue={f.form_number ?? ""} readOnly className={`${inputClass} bg-slate-50 font-mono`} /></Field>
                      <Field label="Titre"><input name="label" defaultValue={f.label} required className={inputClass} /></Field>
                      </div>
                      <div>
                        <Field label="Lien vers la page officielle (canada.ca, quebec.ca)">
                          <input name="url" type="url" defaultValue={f.official_url ?? ""} placeholder="https://www.canada.ca/..." className={inputClass} />
                        </Field>
                      </div>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm font-medium text-navy">Ajouter un formulaire au catalogue</p>
              <ActionForm action={saveFormTypeAction} submitLabel="Ajouter au catalogue" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Field label="Numéro"><input name="number" required placeholder="IMM 5708" className={`${inputClass} font-mono`} /></Field>
                <Field label="Titre"><input name="label" required className={inputClass} /></Field>
                </div>
                <div>
                  <Field label="Lien vers la page officielle (facultatif)">
                    <input name="url" type="url" placeholder="https://www.canada.ca/..." className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
