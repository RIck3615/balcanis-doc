"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, authButton, authInput } from "@/components/AuthCard";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

function DoubleAuth() {
  const router = useRouter();
  const required = useSearchParams().get("obligatoire") === "1";
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified"));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    setPending(true);
    // retirer les inscriptions abandonnées
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of (all?.all ?? []) as Factor[]) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `BalCAN ${new Date().toISOString().slice(0, 10)}` });
    setPending(false);
    if (error || !data) return setError(error?.message ?? "Activation impossible");
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\s/g, "") });
    setPending(false);
    if (error) return setError("Code incorrect ou expiré. Réessayez avec le code affiché maintenant.");
    setEnroll(null);
    setCode("");
    await load();
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Désactiver la double authentification sur cet appareil ?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return setError(error.message);
    await supabase.auth.refreshSession();
    await load();
    router.refresh();
  }

  return (
    <AuthCard
      title="Double authentification"
      sub={
        required
          ? "Le cabinet exige la double authentification. Activez-la pour accéder à la plateforme."
          : "En plus du mot de passe, un code à 6 chiffres généré par votre téléphone est demandé à chaque connexion."
      }
    >
      {factors === null ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : enroll ? (
        <form onSubmit={confirm} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Installez une application d&apos;authentification (Google Authenticator, Microsoft Authenticator, Authy…).</li>
            <li>Scannez ce code avec l&apos;application.</li>
            <li>Saisissez le code à 6 chiffres qu&apos;elle affiche.</li>
          </ol>
          <div className="flex justify-center rounded-xl bg-white p-3 ring-1 ring-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Code QR de la double authentification" width={180} height={180} />
          </div>
          <p className="text-center text-xs text-slate-500">
            Impossible de scanner ? Clé à saisir : <span className="select-all font-mono text-slate-800">{enroll.secret}</span>
          </p>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code}
            onChange={(e) => setCode(e.target.value)} placeholder="123 456" className={`${authInput} text-center font-mono text-lg tracking-widest`} />
          {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
          <button disabled={pending} className={authButton}>{pending ? "Vérification…" : "Activer"}</button>
        </form>
      ) : factors.length > 0 ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">La double authentification est active sur votre compte.</p>
          <ul className="space-y-2 text-sm">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <span>{f.friendly_name ?? "Application d'authentification"}</span>
                {!required && <button onClick={() => remove(f.id)} className="text-xs font-medium text-brand-red-dark">Désactiver</button>}
              </li>
            ))}
          </ul>
          {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
          <button onClick={() => { router.replace("/"); router.refresh(); }} className={authButton}>Continuer</button>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
          <button onClick={start} disabled={pending} className={authButton}>{pending ? "…" : "Activer la double authentification"}</button>
          {!required && (
            <button onClick={() => router.back()} className="w-full text-sm text-slate-500 hover:text-navy">Plus tard</button>
          )}
        </div>
      )}
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DoubleAuth />
    </Suspense>
  );
}
