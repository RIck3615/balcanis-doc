import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, inputClass } from "@/components/ui";
import { createDossierAction } from "@/app/actions";
import type { Client, Program } from "@/lib/types";

type Load = { id: string; agent_code: string | null; full_name: string; available: boolean; open_count: number };

export default async function NouveauDossierPage() {
  const profile = await requireRole("GBR", "CHF", "ADM");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const office = profile.office_code ?? "KIN";
  const [{ data: programs }, { data: loads }, { data: clients }, { data: offices }] = await Promise.all([
    supabase.from("programs").select("*").order("family").order("code"),
    supabase.rpc("collector_loads", { p_office: office }),
    supabase.from("clients").select("*").order("last_name").limit(1000),
    supabase.from("offices").select("code, name").eq("active", true).order("code"),
  ]);
  const openPrograms = ((programs ?? []) as Program[]).filter(
    (p) => (!p.opened_on || p.opened_on <= today) && (!p.closed_on || p.closed_on > today),
  );
  const families = [...new Set(openPrograms.map((p) => p.family))];
  const collectors = (loads ?? []) as Load[];
  const next = collectors.find((c) => c.available);
  const canPickOffice = hasRole(profile, "CHF", "ADM");

  return (
    <div className="max-w-4xl space-y-5">
      <PageTitle eyebrow="Nouveau dossier" sub="Le numéro du dossier, son arborescence et ses sous-dossiers sont générés automatiquement.">
        Ouvrir un dossier
      </PageTitle>
      <ActionForm action={createDossierAction} submitLabel="Ouvrir le dossier" className="space-y-5">
        <Card title="Client">
          <div className="space-y-4">
            <Field label="Client existant" hint="Laissez « Nouveau client » pour le créer avec les champs ci-dessous.">
              <select name="client_id" className={inputClass} defaultValue="">
                <option value="">Nouveau client</option>
                {((clients ?? []) as Client[]).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_code} · {c.last_name} {c.first_name}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prénom"><input name="first_name" className={inputClass} /></Field>
              <Field label="Nom"><input name="last_name" className={inputClass} /></Field>
              <Field label="Date de naissance"><input type="date" name="birth_date" className={inputClass} /></Field>
              <Field label="Pays (code ISO, ex. CD)"><input name="country" maxLength={2} className={inputClass} /></Field>
              <Field label="Courriel"><input type="email" name="email" className={inputClass} /></Field>
              <Field label="Téléphone"><input name="phone" className={inputClass} /></Field>
            </div>
          </div>
        </Card>

        <Card title="Dossier">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Programme">
              <select name="program" required className={inputClass} defaultValue="">
                <option value="" disabled>Choisir un programme</option>
                {families.map((f) => (
                  <optgroup key={f} label={f}>
                    {openPrograms.filter((p) => p.family === f).map((p) => (
                      <option key={p.code} value={p.code}>{p.code} · {p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {canPickOffice ? (
              <Field label="Bureau">
                <select name="office" className={inputClass} defaultValue={office}>
                  {(offices ?? []).map((o) => (
                    <option key={o.code} value={o.code}>{o.code} · {o.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="office" value={office} />
            )}
            <Field
              label="Agent de collecte"
              hint="Par défaut, le dossier va à l'agent disponible qui a le moins de collectes en cours."
            >
              <select name="collector" className={inputClass} defaultValue="">
                <option value="">
                  Automatique{next ? ` (actuellement ${next.agent_code ?? next.full_name})` : " (aucun agent disponible)"}
                </option>
                {collectors.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.available}>
                    {c.agent_code} · {c.full_name} · {c.open_count} en cours{c.available ? "" : " · indisponible"}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {collectors.length > 0 && (
            <div className="mt-5 rounded-xl bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Charge des agents de collecte · bureau {office}</p>
              <ul className="space-y-2">
                {collectors.map((c) => {
                  const max = Math.max(1, ...collectors.map((x) => Number(x.open_count)));
                  return (
                    <li key={c.id} className="flex items-center gap-3 text-sm">
                      <span className="w-40 truncate">
                        <span className="font-mono text-xs text-slate-500">{c.agent_code}</span> {c.full_name}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-white">
                        <span className="block h-full rounded-full bg-navy" style={{ width: `${(Number(c.open_count) / max) * 100}%` }} />
                      </span>
                      <span className="w-24 text-right tabular-nums text-slate-600">{c.open_count} en cours</span>
                      {!c.available && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">indisponible</span>}
                      {c.id === next?.id && <span className="rounded-full bg-brand-red-light px-2 py-0.5 text-xs font-medium text-brand-red-dark">prochain</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </ActionForm>
    </div>
  );
}
