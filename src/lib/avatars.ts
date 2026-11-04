import type { SupabaseClient } from "@supabase/supabase-js";

// Liens temporaires (1 h) vers les photos de profil (seau privé « avatars »), en une seule requête
export async function signAvatars(supabase: SupabaseClient, paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from("avatars").createSignedUrls(unique, 3600);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
