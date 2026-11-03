"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DocumentCategory, DocumentType, Member } from "@/lib/types";
import { personLabel } from "@/lib/labels";

type Props = {
  dossierId: string;
  members: Member[];
  categories: DocumentCategory[];
  types: DocumentType[];
};

// Dépôt d'une pièce : la base génère le nom selon la nomenclature, puis le fichier
// est envoyé à ce chemin. L'agent ne tape jamais de nom de fichier.
export function DocumentUpload({ dossierId, members, categories, types }: Props) {
  const router = useRouter();
  const [person, setPerson] = useState(members[0]?.person_code ?? "P");
  const [type, setType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [issued, setIssued] = useState("");
  const [expires, setExpires] = useState("");
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !type) return;
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    const { data, error } = await supabase.rpc("register_document", {
      p_dossier: dossierId,
      p_person_code: person,
      p_type: type,
      p_extension: ext,
      p_mime: file.type || null,
      p_size: file.size,
      p_issued_on: issued || null,
      p_expires_on: expires || null,
    });
    if (error || !data?.[0]) {
      setPending(false);
      setMessage({ error: error?.message ?? "Enregistrement impossible" });
      return;
    }
    const doc = data[0] as { id: string; file_name: string; storage_path: string };
    const upload = await supabase.storage.from("dossiers").upload(doc.storage_path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upload.error) {
      await supabase.rpc("discard_document", { p_document: doc.id });
      setPending(false);
      setMessage({ error: `Dépôt du fichier échoué : ${upload.error.message}. Réessayez.` });
      return;
    }
    setPending(false);
    setMessage({ ok: `Pièce enregistrée sous ${doc.file_name}` });
    setFile(null);
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15";
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Personne</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={input}>
            {members.map((m) => (
              <option key={m.person_code} value={m.person_code}>
                {m.person_code} · {personLabel(m.person_code)} · {m.last_name} {m.first_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Type de pièce</span>
          <select required value={type} onChange={(e) => setType(e.target.value)} className={input}>
            <option value="" disabled>Choisir…</option>
            {categories.map((c) => (
              <optgroup key={c.code} label={c.folder}>
                {types.filter((t) => t.category_code === c.code).map((t) => (
                  <option key={t.code} value={t.code}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Date d&apos;émission (facultatif)</span>
          <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Date d&apos;expiration (facultatif)</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Fichier (PDF de préférence, toutes les pages en un seul fichier)</span>
        <input type="file" required accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !file || !type} className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-navy-dark disabled:opacity-50">
          {pending ? "Envoi…" : "Déposer la pièce"}
        </button>
        {message?.error && <p className="text-sm text-brand-red-dark">{message.error}</p>}
        {message?.ok && <p className="text-sm text-emerald-700">{message.ok}</p>}
      </div>
    </form>
  );
}
