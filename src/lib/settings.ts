import { cache } from "react";
import { createClient } from "./supabase/server";

export type Settings = {
  mfa_obligatoire: boolean;
  telechargement_traitement: boolean;
  inactivite_minutes: number;
  taille_max_fichier_mo: number;
  courriel_actif: boolean;
  courriel_expediteur: string;
  url_application: string;
  courriel_delai_minutes: number;
};

const DEFAULTS: Settings = { mfa_obligatoire: false, telechargement_traitement: false, inactivite_minutes: 30, taille_max_fichier_mo: 20,
  courriel_actif: false, courriel_expediteur: "BalCanis <notifications@balcanis.ca>", url_application: "", courriel_delai_minutes: 10,
};

// Paramètres de l'application (table app_settings), lus une fois par requête
export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value");
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) out[row.key as string] = row.value;
  return out as Settings;
});
