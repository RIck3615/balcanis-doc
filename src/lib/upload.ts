import { createClient } from "./supabase/client";

// Dépôt d'une pièce depuis le navigateur : la base génère le nom et le chemin selon la
// nomenclature, puis le fichier est envoyé à ce chemin. En cas d'échec, la fiche est annulée.
export async function uploadDocument(args: {
  dossierId: string;
  person: string;
  type: string;
  file: File;
  issuedOn?: string | null;
  expiresOn?: string | null;
  maxMb?: number;
}): Promise<{ fileName?: string; error?: string }> {
  const supabase = createClient();
  const { file } = args;
  // vérification immédiate (la base et le stockage vérifient aussi de leur côté)
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
    return { error: "Format refusé : seuls les fichiers PDF, JPG et PNG sont acceptés." };
  }
  if (args.maxMb && file.size > args.maxMb * 1024 * 1024) {
    return { error: `Fichier trop volumineux : ${(file.size / 1048576).toFixed(1)} Mo (maximum ${args.maxMb} Mo).` };
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const { data, error } = await supabase.rpc("register_document", {
    p_dossier: args.dossierId,
    p_person_code: args.person,
    p_type: args.type,
    p_extension: ext,
    p_mime: file.type || null,
    p_size: file.size,
    p_issued_on: args.issuedOn || null,
    p_expires_on: args.expiresOn || null,
  });
  if (error || !data?.[0]) return { error: error?.message ?? "Enregistrement impossible" };
  const doc = data[0] as { id: string; file_name: string; storage_path: string };
  const upload = await supabase.storage.from("dossiers").upload(doc.storage_path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upload.error) {
    await supabase.rpc("discard_document", { p_document: doc.id });
    return { error: `Dépôt du fichier échoué : ${upload.error.message}. Réessayez.` };
  }
  return { fileName: doc.file_name };
}
