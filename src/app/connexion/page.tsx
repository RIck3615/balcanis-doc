"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ConnexionPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("raison") === "inactivite")
      setNotice("Vous avez été déconnecté après une période d'inactivité.");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError("Courriel ou mot de passe incorrect.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15";

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border-[40px] border-white/5" aria-hidden />
        <div className="absolute -bottom-32 -left-20 h-[28rem] w-[28rem] rounded-full border-[48px] border-brand-red/20" aria-hidden />
        <p className="relative text-sm font-semibold uppercase tracking-[0.2em] text-white/70">BalCAN Immigration Services</p>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">Chaque dossier, suivi de la collecte à la soumission.</h1>
          <p className="mt-4 text-white/75">
            Pièces classées selon une nomenclature commune, contrôle par une seconde personne et historique complet de chaque action.
          </p>
        </div>
        <div className="relative flex gap-8 text-sm text-white/70">
          <span>Collecte</span>
          <span>Traitement</span>
          <span>Contrôle</span>
          <span>Soumission</span>
        </div>
      </section>

      <section className="flex items-center justify-center bg-surface p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <Image src="/logo.png" alt="BalCAN Immigration Services" width={180} height={183} priority />
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_8px_30px_rgba(33,51,125,0.08)]">
            <div>
              <h2 className="text-lg font-semibold text-navy">Connexion</h2>
              <p className="text-sm text-slate-500">Plateforme réservée au personnel du cabinet.</p>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Courriel</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Mot de passe</span>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="current-password" />
            </label>
            {notice && !error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
            {error && <p className="rounded-lg bg-brand-red-light px-3 py-2 text-sm text-brand-red-dark">{error}</p>}
            <button disabled={pending} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-dark disabled:opacity-50">
              {pending ? "Connexion…" : "Se connecter"}
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">Les comptes sont créés par l&apos;administrateur du cabinet.</p>
        </form>
      </section>
    </main>
  );
}
