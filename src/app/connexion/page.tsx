"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ConnexionPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError("Courriel ou mot de passe incorrect.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold tracking-widest text-slate-500">BALCANIS</p>
          <h1 className="text-lg font-semibold">Connexion à la plateforme des dossiers</h1>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Courriel</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5" autoComplete="email" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Mot de passe</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5" autoComplete="current-password" />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button disabled={pending} className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Connexion…" : "Se connecter"}
        </button>
        <p className="text-xs text-slate-500">Les comptes sont créés par l&apos;administrateur du cabinet.</p>
      </form>
    </main>
  );
}
