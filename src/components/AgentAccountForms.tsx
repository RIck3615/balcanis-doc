"use client";

import { useActionState, useState } from "react";
import { createAgentAction, resetAgentPasswordAction, type ActionResult } from "@/app/actions";
import { ROLE_LABELS } from "@/lib/labels";
import type { AppRole } from "@/lib/types";
import { Field, buttonClass, inputClass } from "./ui";

const ALL_ROLES: AppRole[] = ["TRT", "CTL", "COL", "GBR", "CHF", "ADM"];

// Identifiants à transmettre à l'agent : affichés une seule fois
function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Plateforme BalCAN\nCourriel : ${email}\nMot de passe temporaire : ${password}\nVous devrez choisir votre propre mot de passe à la première connexion.`;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
      <p className="font-semibold text-emerald-800">Compte créé : identifiants à transmettre à l&apos;agent</p>
      <p className="mt-2">Courriel : <span className="font-mono">{email}</span></p>
      <p>Mot de passe temporaire : <span className="rounded bg-white px-2 py-0.5 font-mono text-base font-semibold tracking-wide text-navy">{password}</span></p>
      <p className="mt-2 text-xs text-emerald-800">
        Ce mot de passe ne sera plus affiché. Transmettez-le par un canal privé ; l&apos;agent devra le changer à sa première connexion.
      </p>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        className={`mt-3 rounded-lg px-3 py-1.5 text-xs font-medium ${buttonClass.secondary}`}
      >
        {copied ? "Copié" : "Copier le message"}
      </button>
    </div>
  );
}

export function CreateAgentForm({ offices }: { offices: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createAgentAction, null);

  if (state?.password && state.email) {
    return (
      <div className="space-y-3">
        <Credentials email={state.email} password={state.password} />
        <div className="flex flex-wrap gap-3">
          {state.userId && (
            <a href={`/admin/agents/${state.userId}`} className={`rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.primary}`}>
              Voir la fiche de l&apos;agent
            </a>
          )}
          <button onClick={() => window.location.reload()} className={`rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>
            Créer un autre agent
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom complet"><input name="full_name" required className={inputClass} /></Field>
        <Field label="Courriel (identifiant de connexion)"><input name="email" type="email" required className={inputClass} /></Field>
        <Field label="Bureau" hint="Obligatoire pour la collecte et les gestionnaires ; vide pour un agent à distance.">
          <select name="office" defaultValue="" className={inputClass}>
            <option value="">Aucun (agent à distance)</option>
            {offices.map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}</option>)}
          </select>
        </Field>
        <Field label="Taux horaire (CAD, agents de traitement)">
          <input name="hourly_rate" inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Programmes certifiés" hint="Codes séparés par des virgules (ex. PE, EE-CEC), ou * pour tous.">
          <input name="certified" className={inputClass} />
        </Field>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1.5 font-medium text-slate-700">Rôles</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ALL_ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-navy/40 has-[:checked]:border-navy has-[:checked]:bg-navy-light/50">
              <input type="checkbox" name="roles" value={r} className="accent-navy" /> {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${buttonClass.primary}`}>
          {pending ? "Création…" : "Créer l'agent"}
        </button>
        {state?.error && <p className="rounded-lg bg-brand-red-light px-3 py-1.5 text-sm text-brand-red-dark">{state.error}</p>}
      </div>
    </form>
  );
}

export function ResetPasswordForm({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(resetAgentPasswordAction, null);
  if (state?.password && state.email) return <Credentials email={state.email} password={state.password} />;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Générer un nouveau mot de passe temporaire pour ${email} ? L'ancien ne fonctionnera plus.`)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="user" value={userId} />
      <input type="hidden" name="email" value={email} />
      <button disabled={pending} className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${buttonClass.secondary}`}>
        {pending ? "…" : "Réinitialiser le mot de passe"}
      </button>
      {state?.error && <p className="text-xs text-brand-red-dark">{state.error}</p>}
    </form>
  );
}
