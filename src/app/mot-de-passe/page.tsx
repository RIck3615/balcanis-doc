"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordChangedAction } from "@/app/actions";

export default function MotDePassePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("Au moins 10 caractères.");
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError("Mélangez des lettres et des chiffres.");
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setPending(false);
      return setError(error.message.includes("different") ? "Choisissez un mot de passe différent du mot de passe temporaire." : error.message);
    }
    await passwordChangedAction();
    router.replace("/");
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/logo.png" alt="BalCAN Immigration Services" width={130} height={132} priority />
        </div>
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_8px_30px_rgba(33,51,125,0.08)]">
          <div>
            <h1 className="text-lg font-semibold text-navy">Choisissez votre mot de passe</h1>
            <p className="text-sm text-slate-500">Il remplace le mot de passe reçu de l&apos;administrateur. Au moins 10 caractères, avec des lettres et des chiffres.</p>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Nouveau mot de passe</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Confirmer</span>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
          </label>
          {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
          <button disabled={pending} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-dark disabled:opacity-50">
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </main>
  );
}
