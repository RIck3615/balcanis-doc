import { getProfile } from "@/lib/auth";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, buttonClass, inputClass } from "@/components/ui";
import { setAvailabilityAction, setEmailPrefAction, updateMyPaymentAction } from "@/app/actions";
import { ROLE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AgentPayment } from "@/lib/types";
import { AvatarUpload } from "@/components/AvatarUpload";
import { signAvatars } from "@/lib/avatars";

export default async function ProfilPage() {
  const p = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("agent_payments").select("*").eq("agent_id", p.id).maybeSingle();
  const pay = data as AgentPayment | null;
  const urls = await signAvatars(supabase, [p.avatar_path]);
  return (
    <div className="max-w-2xl space-y-4">
      <PageTitle eyebrow="Compte">Mon profil</PageTitle>
      {p.roles.includes("COL") && (
        <Card title="Disponibilité">
          <p className="mb-3 text-sm text-slate-600">
            Les nouveaux dossiers sont attribués automatiquement aux agents de collecte disponibles, en commençant par le moins chargé.
            Marquez-vous indisponible pendant une absence.
          </p>
          <ActionForm action={setAvailabilityAction} submitLabel={p.available ? "Me marquer indisponible" : "Me marquer disponible"} variant={p.available ? "secondary" : "success"} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="available" value={p.available ? "false" : "true"} />
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${p.available ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {p.available ? "Vous êtes disponible" : "Vous êtes indisponible"}
            </span>
          </ActionForm>
        </Card>
      )}
      <Card title="Photo de profil">
        <AvatarUpload userId={p.id} name={p.full_name || p.email} src={p.avatar_path ? urls[p.avatar_path] ?? null : null} self />
      </Card>
      <Card title="Identité">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Nom</dt><dd>{p.full_name || "Non renseigné"}</dd></div>
          <div><dt className="text-xs text-slate-500">Courriel</dt><dd>{p.email}</dd></div>
          <div><dt className="text-xs text-slate-500">Code agent</dt><dd className="font-mono">{p.agent_code ?? "Pas encore attribué"}</dd></div>
          <div><dt className="text-xs text-slate-500">Rôles</dt><dd>{p.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Aucun"}</dd></div>
          <div><dt className="text-xs text-slate-500">Bureau</dt><dd>{p.office_code ?? "À distance"}</dd></div>
          <div><dt className="text-xs text-slate-500">Programmes certifiés</dt><dd>{p.certified_programs.join(", ") || "Aucun"}</dd></div>
        </dl>
      </Card>
      <Card title="Notifications par courriel">
        <p className="mb-3 text-sm text-slate-600">
          Les notifications que vous n&apos;avez pas lues dans la plateforme sont envoyées à <span className="font-medium text-slate-900">{p.email}</span>.
          Si vous les voyez à l&apos;écran, aucun courriel ne part.
        </p>
        <ActionForm action={setEmailPrefAction} submitLabel="Enregistrer" className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { v: "tous", t: "Au fil de l'eau", d: "Quelques minutes après chaque notification non lue" },
              { v: "quotidien", t: "Résumé quotidien", d: "Un seul courriel chaque matin" },
              { v: "aucun", t: "Aucun courriel", d: "Seulement dans la plateforme" },
            ].map((o) => (
              <label key={o.v} className="flex cursor-pointer gap-2 rounded-xl border border-slate-200 p-3 text-sm transition has-[:checked]:border-navy has-[:checked]:bg-navy-light/50">
                <input type="radio" name="pref" value={o.v} defaultChecked={(p.email_pref ?? "tous") === o.v} className="mt-0.5 accent-navy" />
                <span><span className="block font-medium text-slate-900">{o.t}</span><span className="text-xs text-slate-500">{o.d}</span></span>
              </label>
            ))}
          </div>
        </ActionForm>
      </Card>
      <Card title="Sécurité">
        <div className="flex flex-wrap gap-3">
          <Link href="/mot-de-passe" className={`inline-block rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>
            Changer mon mot de passe
          </Link>
          <Link href="/securite/2fa" className={`inline-block rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>
            Double authentification
          </Link>
        </div>
      </Card>
      <Card title="Paiement">
        <p className="mb-3 text-sm text-slate-600">
          Vous choisissez comment et à quelle fréquence vous êtes payé. Tout changement est confirmé par l&apos;administrateur avant le paiement suivant.
          {pay?.pending && <strong className="ml-1 text-amber-800">Changement en attente de confirmation.</strong>}
        </p>
        <ActionForm action={updateMyPaymentAction} submitLabel="Enregistrer">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Moyen de paiement">
              <select name="method" required defaultValue={pay?.method ?? ""} className={inputClass}>
                <option value="" disabled>Choisir…</option>
                <option>Virement bancaire</option>
                <option>Mobile money</option>
                <option>Transfert d&apos;argent</option>
                <option>Autre</option>
              </select>
            </Field>
            <Field label="Fréquence">
              <select name="frequency" required defaultValue={pay?.frequency ?? ""} className={inputClass}>
                <option value="" disabled>Choisir…</option>
                <option>Chaque semaine</option>
                <option>Toutes les deux semaines</option>
                <option>Chaque mois</option>
              </select>
            </Field>
          </div>
          <Field label="Coordonnées" hint="Numéro de compte, numéro mobile money, etc.">
            <textarea name="details" required rows={2} defaultValue={pay?.details ?? ""} className={inputClass} />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
