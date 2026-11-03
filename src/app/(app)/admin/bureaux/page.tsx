import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { Flag } from "@/components/AgentBits";
import { Card, Field, PageTitle, StatTile, inputClass } from "@/components/ui";
import { createOfficeAction, updateOfficeAction } from "@/app/actions";
import { formatDate } from "@/lib/labels";

type Office = { code: string; name: string; country_iso: string; active: boolean; created_at: string };
type Stats = { code: string; agents: number; collectors: number; collectors_available: number; open_dossiers: number; clients: number };

export default async function BureauxPage() {
  await requireRole("ADM", "CHF");
  const supabase = await createClient();
  const [{ data: offices }, { data: stats }] = await Promise.all([
    supabase.from("offices").select("*").order("active", { ascending: false }).order("code"),
    supabase.rpc("office_stats"),
  ]);
  const list = (offices ?? []) as Office[];
  const statOf = (code: string) => ((stats ?? []) as Stats[]).find((s) => s.code === code);
  const openCount = list.filter((o) => o.active).length;
  const countries = new Set(list.filter((o) => o.active).map((o) => o.country_iso)).size;

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Administration" sub="Chaque bureau a un code de 3 lettres qui apparaît dans les numéros de dossiers (ex. BC-KIN-2026-00042-PE). Le code ne peut plus changer une fois créé.">
        Bureaux
      </PageTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Bureaux ouverts" value={openCount} />
        <StatTile label="Pays" value={countries} />
        <StatTile label="Dossiers en cours" value={((stats ?? []) as Stats[]).reduce((n, s) => n + Number(s.open_dossiers), 0)} tone="red" />
        <StatTile label="Agents rattachés" value={((stats ?? []) as Stats[]).reduce((n, s) => n + Number(s.agents), 0)} tone="emerald" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {list.map((o) => {
            const s = statOf(o.code);
            return (
              <Card key={o.code} className={o.active ? "" : "opacity-80"}>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <span className={`flex h-14 w-14 items-center justify-center rounded-2xl font-mono text-lg font-bold ${o.active ? "bg-navy text-white" : "bg-slate-200 text-slate-500"}`}>
                      {o.code}
                    </span>
                    <div>
                      <p className="text-lg font-semibold text-navy">{o.name}</p>
                      <p className="text-sm text-slate-500">
                        Pays {o.country_iso} · créé le {formatDate(o.created_at)}
                      </p>
                      <div className="mt-1">{o.active ? <Flag tone="emerald">Ouvert</Flag> : <Flag tone="slate">Fermé</Flag>}</div>
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-4 rounded-xl bg-surface p-3 text-center">
                    <div>
                      <dd className="text-2xl font-semibold tabular-nums text-navy">{s?.open_dossiers ?? 0}</dd>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">Dossiers en cours</dt>
                    </div>
                    <div>
                      <dd className="text-2xl font-semibold tabular-nums text-navy">{s?.clients ?? 0}</dd>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">Clients</dt>
                    </div>
                    <div>
                      <dd className="text-2xl font-semibold tabular-nums text-navy">
                        {s?.collectors_available ?? 0}<span className="text-base text-slate-400"> / {s?.collectors ?? 0}</span>
                      </dd>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">Collecte dispo.</dt>
                    </div>
                  </dl>
                </div>

                {o.active && (s?.collectors_available ?? 0) === 0 && (
                  <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Aucun agent de collecte disponible : les nouveaux dossiers de ce bureau ne pourront pas être attribués.{" "}
                    <Link href="/admin/agents/nouveau" className="font-medium underline">Créer un agent</Link>
                  </p>
                )}

                <details className="mt-4 border-t border-slate-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-navy hover:text-brand-red">Modifier</summary>
                  <ActionForm action={updateOfficeAction} submitLabel="Enregistrer" variant="secondary" className="mt-3 space-y-3">
                    <input type="hidden" name="code" value={o.code} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nom"><input name="name" defaultValue={o.name} required className={inputClass} /></Field>
                      <Field label="Code pays"><input name="country" defaultValue={o.country_iso} required maxLength={2} className={`${inputClass} uppercase`} /></Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={o.active} className="accent-navy" />
                      Bureau ouvert (décocher : plus de nouveaux clients ni dossiers ; l&apos;historique reste)
                    </label>
                  </ActionForm>
                </details>
              </Card>
            );
          })}
        </div>

        <div>
          <Card title="Nouveau bureau" className="lg:sticky lg:top-8">
            <ActionForm action={createOfficeAction} submitLabel="Créer le bureau">
              <Field label="Code (3 lettres)" hint="Souvent le code de la ville ou de l'aéroport : BZV, LBV, LFW…">
                <input name="code" required maxLength={3} pattern="[A-Za-z]{3}" className={`${inputClass} font-mono uppercase`} />
              </Field>
              <Field label="Nom"><input name="name" required placeholder="Brazzaville" className={inputClass} /></Field>
              <Field label="Code pays (2 lettres)" hint="CG Congo, CD RDC, GA Gabon, TG Togo, CA Canada…">
                <input name="country" required maxLength={2} pattern="[A-Za-z]{2}" className={`${inputClass} uppercase`} />
              </Field>
            </ActionForm>
            <p className="mt-4 text-xs text-slate-500">
              Ensuite, rattachez au bureau au moins un gestionnaire et un agent de collecte depuis la page Agents.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
