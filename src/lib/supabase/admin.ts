import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client « administrateur » : utilise la clé service_role, qui contourne toutes les règles.
// Uniquement côté serveur, et seulement pour créer des comptes ou changer un mot de passe,
// APRÈS avoir vérifié que l'utilisateur connecté est ADM ou CHF.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Mot de passe temporaire lisible (sans caractères ambigus comme 0/O ou 1/l)
export function temporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const body = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}
