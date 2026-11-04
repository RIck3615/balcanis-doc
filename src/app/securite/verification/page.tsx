"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, authButton, authInput } from "@/components/AuthCard";

// Deuxième étape de connexion : code à 6 chiffres de l'application d'authentification
export default function VerificationPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) {
      router.replace("/securite/2fa");
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, "") });
    setPending(false);
    if (error) return setError("Code incorrect ou expiré.");
    router.replace("/");
    router.refresh();
  }

  async function cancel() {
    await createClient().auth.signOut();
    router.replace("/connexion");
  }

  return (
    <AuthCard title="Vérification en deux étapes" sub="Saisissez le code à 6 chiffres affiché par votre application d'authentification.">
      <form onSubmit={onSubmit} className="space-y-4">
        <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} required value={code}
          onChange={(e) => setCode(e.target.value)} placeholder="123 456" className={`${authInput} text-center font-mono text-lg tracking-widest`} />
        {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
        <button disabled={pending} className={authButton}>{pending ? "Vérification…" : "Valider"}</button>
        <button type="button" onClick={cancel} className="w-full text-sm text-slate-500 hover:text-navy">Se déconnecter</button>
        <p className="text-xs text-slate-500">Téléphone perdu ? Demandez à l&apos;administrateur de réinitialiser votre double authentification.</p>
      </form>
    </AuthCard>
  );
}
