import { cache } from "react";
import { createClient } from "./supabase/server";

export type Settings = {
  mfa_obligatoire: boolean;
  telechargement_traitement: boolean;
  inactivite_minutes: number;
  taille_max_fichier_mo: number;
};

const DEFAULTS: Settings = { mfa_obligatoire: false, telechargement_traitement: false, inactivite_minutes: 30, taille_max_fichier_mo: 20 };

// Paramètres de l'application (table app_settings), lus une fois par requête
export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value");
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) out[row.key as string] = row.value;
  return out as Settings;
});
