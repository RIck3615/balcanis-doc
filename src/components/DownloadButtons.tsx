"use client";

import { useState } from "react";
import { zip } from "fflate";
import { downloadDocumentAction, prepareDossierDownloadAction } from "@/app/actions";
import { buttonClass } from "./ui";

const icon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
  </svg>
);

// Une pièce : enregistrée sous son nom de nomenclature (téléchargement journalisé)
export function DownloadDocumentButton({ documentId }: { documentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        disabled={pending}
        title="Télécharger"
        aria-label="Télécharger la pièce"
        className="rounded-md p-1.5 text-navy ring-1 ring-inset ring-slate-200 transition hover:bg-navy-light disabled:opacity-50"
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await downloadDocumentAction(documentId);
          setPending(false);
          if (res.url) window.location.href = res.url;
          else setError(res.error ?? "Erreur");
        }}
      >
        {icon}
      </button>
      {error && <span className="ml-2 text-xs text-brand-red-dark">{error}</span>}
    </span>
  );
}

function saveBlob(data: Uint8Array, name: string) {
  const blob = new Blob([data as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Dossier complet en ZIP, avec l'arborescence 00_ADMIN, 01_IDENTITE, ...
export function DownloadDossierButton({ dossierId, hasOldVersions }: { dossierId: string; hasOldVersions: boolean }) {
  const [allVersions, setAllVersions] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setProgress("Préparation…");
    const res = await prepareDossierDownloadAction(dossierId, allVersions);
    if (!res.files || !res.number) {
      setProgress(null);
      setError(res.error ?? "Erreur");
      return;
    }
    const entries: Record<string, Uint8Array> = {};
    let done = 0;
    try {
      for (const f of res.files) {
        setProgress(`Téléchargement ${done + 1} / ${res.files.length}`);
        const r = await fetch(f.url);
        if (!r.ok) throw new Error(`Pièce inaccessible : ${f.path.split("/").pop()}`);
        entries[f.path] = new Uint8Array(await r.arrayBuffer());
        done++;
      }
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Téléchargement interrompu");
      return;
    }
    setProgress("Création du fichier ZIP…");
    // niveau 0 : les PDF et images sont déjà compressés, inutile de ralentir
    zip(entries, { level: 0 }, (err, data) => {
      setProgress(null);
      if (err) return setError("Création du ZIP impossible");
      saveBlob(data, `${res.number}${allVersions ? "_toutes-versions" : ""}.zip`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={progress !== null}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${buttonClass.secondary}`}
      >
        {icon}
        {progress ?? "Télécharger le dossier (ZIP)"}
      </button>
      {hasOldVersions && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={allVersions} onChange={(e) => setAllVersions(e.target.checked)} className="accent-navy" />
          Inclure les versions précédentes
        </label>
      )}
      {error && <span className="text-xs text-brand-red-dark">{error}</span>}
    </div>
  );
}
