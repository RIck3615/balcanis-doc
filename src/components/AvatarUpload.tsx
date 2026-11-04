"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./AgentBits";
import { buttonClass } from "./ui";

// Recadre au centre en carré 256 px et réencode en JPEG : fichier léger, et les
// métadonnées de la photo d'origine (position GPS, appareil) sont supprimées.
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible"))), "image/jpeg", 0.88),
  );
}

export function AvatarUpload({ userId, name, src, self }: { userId: string; name: string; src: string | null; self: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("Choisissez une photo JPG, PNG ou WebP.");
    if (file.size > 15 * 1024 * 1024) return setError("Photo trop volumineuse (15 Mo maximum avant réduction).");
    setPending(true);
    try {
      const blob = await toSquareJpeg(file);
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data: old, error } = await supabase.rpc("set_avatar", { p_user: userId, p_path: path });
      if (error) {
        await supabase.storage.from("avatars").remove([path]);
        throw new Error(error.message);
      }
      if (old) await supabase.storage.from("avatars").remove([old as string]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm(self ? "Retirer votre photo de profil ?" : `Retirer la photo de ${name} ?`)) return;
    setPending(true);
    const supabase = createClient();
    const { data: old, error } = await supabase.rpc("set_avatar", { p_user: userId, p_path: null });
    if (!error && old) await supabase.storage.from("avatars").remove([old as string]);
    setPending(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar name={name} src={src} size="xl" />
      <div className="space-y-2">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => input.current?.click()}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${buttonClass.primary}`}>
            {pending ? "Envoi…" : src ? "Changer la photo" : "Ajouter une photo"}
          </button>
          {src && (
            <button type="button" disabled={pending} onClick={remove}
              className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${buttonClass.secondary}`}>
              Retirer
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">Photo de face, visage bien visible. Recadrée en carré ; visible uniquement par le personnel du cabinet.</p>
        {error && <p className="text-xs text-brand-red-dark">{error}</p>}
      </div>
    </div>
  );
}
