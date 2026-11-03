"use client";

import { useState } from "react";
import { openDocumentAction } from "@/app/actions";

// Ouvre la pièce dans un nouvel onglet avec un lien valable 60 secondes (consultation journalisée)
export function OpenDocumentButton({ documentId, label = "Ouvrir" }: { documentId: string; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <span>
      <button
        type="button"
        disabled={pending}
        className="rounded-md px-2 py-1 text-sm font-medium text-navy ring-1 ring-inset ring-slate-200 transition hover:bg-navy-light disabled:opacity-50"
        onClick={async () => {
          setPending(true);
          setError(null);
          const tab = window.open("", "_blank");
          const res = await openDocumentAction(documentId);
          setPending(false);
          if (res.url && tab) tab.location.href = res.url;
          else {
            tab?.close();
            setError(res.error ?? "Erreur");
          }
        }}
      >
        {label}
      </button>
      {error && <span className="ml-2 text-xs text-brand-red-dark">{error}</span>}
    </span>
  );
}
