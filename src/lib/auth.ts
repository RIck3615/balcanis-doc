import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import type { AppRole, Profile } from "./types";
import { hasRole } from "./auth-shared";

// Profil de l'utilisateur connecté (mis en cache pour la durée de la requête)
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/connexion");
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!data) redirect("/connexion");
  return data as Profile;
});

export { hasRole };

export async function requireRole(...roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!hasRole(profile, ...roles)) redirect("/");
  return profile;
}
