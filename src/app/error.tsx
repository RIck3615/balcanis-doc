"use client";

import { AuthCard } from "@/components/AuthCard";

// Erreur inattendue : message neutre, sans détail technique affiché à l'utilisateur
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthCard title="Une erreur est survenue" sub="L'action n'a pas pu aboutir. Réessayez ; si le problème continue, communiquez cette référence à l'administrateur.">
      {error.digest && <p className="rounded-lg bg-surface px-3 py-2 font-mono text-xs text-slate-600">Référence : {error.digest}</p>}
      <button onClick={reset} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-dark">Réessayer</button>
    </AuthCard>
  );
}
