"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument } from "@/lib/upload";
import { buttonClass } from "./ui";

// Téléversement d'un formulaire officiel rempli, pour une personne du dossier
export function FormUploadButton({ dossierId, person, type, hasVersion }: { dossierId: string; person: string; type: string; hasVersion: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    const res = await uploadDocument({ dossierId, person, type, file });
    setPending(false);
    if (input.current) input.current.value = "";
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <input ref={input} type="file" accept=".pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${hasVersion ? buttonClass.secondary : buttonClass.primary}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20V9m0 0-4 4m4-4 4 4M5 5h14" />
        </svg>
        {pending ? "Envoi…" : hasVersion ? "Nouvelle version" : "Téléverser"}
      </button>
      {error && <span className="max-w-56 text-right text-xs text-brand-red-dark">{error}</span>}
    </span>
  );
}
