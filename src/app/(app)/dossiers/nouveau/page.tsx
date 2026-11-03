import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, inputClass } from "@/components/ui";
import { createDossierAction } from "@/app/actions";
import type { Client, Program, StaffEntry } from "@/lib/types";

export default async function NouveauDossierPage() {
  const profile = await requireRole("GBR", "CHF", "ADM");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: programs }, { data: staff }, { data: clients }, { data: offices }] = await Promise.all([
    supabase.from("programs").select("*").order("family").order("code"),
    supabase.from("staff_directory").select("*").contains("roles", ["COL"]).eq("active", true).order("full_name"),
    supabase.from("clients").select("*").order("last_name").limit(1000),
    supabase.from("offices").select("code, name").eq("active", true).order("code"),
  ]);
  const openPrograms = ((programs ?? []) as Program[]).filter(
    (p) => (!p.opened_on || p.opened_on <= today) && (!p.closed_on || p.closed_on > today),
  );
  const families = [...new Set(openPrograms.map((p) => p.family))];
  const canPickOffice = hasRole(profile, "CHF", "ADM");

  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle sub="Le numéro du dossier et son arborescence sont générés automatiquement.">Ouvrir un dossier</PageTitle>
      <ActionForm action={createDossierAction} submitLabel="Ouvrir le dossier" className="space-y-4">
        <Card title="1. Client">
          <div className="space-y-3">
            <Field label="Client existant" hint="Laissez « Nouveau client » pour en créer un avec les champs ci-dessous.">
              <select name="client_id" className={inputClass} defaultValue="">
                <option value="">— Nouveau client —</option>
                {((clients ?? []) as Client[]).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_code} · {c.last_name} {c.first_name}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Prénom"><input name="first_name" className={inputClass} /></Field>
              <Field label="Nom"><input name="last_name" className={inputClass} /></Field>
              <Field label="Date de naissance"><input type="date" name="birth_date" className={inputClass} /></Field>
              <Field label="Pays (code ISO, ex. CD)"><input name="country" maxLength={2} className={inputClass} /></Field>
              <Field label="Courriel"><input type="email" name="email" className={inputClass} /></Field>
              <Field label="Téléphone"><input name="phone" className={inputClass} /></Field>
            </div>
          </div>
        </Card>
        <Card title="2. Dossier">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Programme">
              <select name="program" required className={inputClass} defaultValue="">
                <option value="" disabled>Choisir…</option>
                {families.map((f) => (
                  <optgroup key={f} label={f}>
                    {openPrograms.filter((p) => p.family === f).map((p) => (
                      <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Agent de collecte">
              <select name="collector" required className={inputClass} defaultValue="">
                <option value="" disabled>Choisir…</option>
                {((staff ?? []) as StaffEntry[]).map((s) => (
                  <option key={s.id} value={s.id}>{s.agent_code} · {s.full_name}</option>
                ))}
              </select>
            </Field>
            {canPickOffice ? (
              <Field label="Bureau">
                <select name="office" className={inputClass} defaultValue={profile.office_code ?? ""}>
                  {(offices ?? []).map((o) => (
                    <option key={o.code} value={o.code}>{o.code} — {o.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="office" value={profile.office_code ?? ""} />
            )}
          </div>
        </Card>
      </ActionForm>
    </div>
  );
}
