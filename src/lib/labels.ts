import type { AppRole } from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  CHF: "Chef du cabinet",
  GBR: "Gestionnaire de bureau",
  COL: "Agent de collecte",
  TRT: "Agent de traitement",
  CTL: "Contrôleur",
  ADM: "Administrateur",
};

export const STATUS_LABELS: Record<number, string> = {
  0: "Ouvert",
  10: "Collecte en cours",
  15: "Collecte complète",
  20: "Assigné",
  30: "En traitement",
  35: "En attente client",
  40: "Prêt au contrôle",
  50: "En contrôle",
  55: "À corriger",
  60: "Contrôlé",
  70: "En validation finale",
  75: "Retourné par le chef",
  80: "Soumis",
  90: "Fermé",
  99: "Annulé",
};

// Couleur par phase : collecte, traitement, contrôle, chef, terminé, retour
export function statusTone(status: number): string {
  if (status === 55 || status === 75) return "bg-amber-100 text-amber-900 ring-amber-300";
  if (status === 35) return "bg-orange-100 text-orange-900 ring-orange-300";
  if (status === 99) return "bg-zinc-100 text-zinc-600 ring-zinc-300";
  if (status >= 80) return "bg-emerald-100 text-emerald-900 ring-emerald-300";
  if (status >= 60) return "bg-violet-100 text-violet-900 ring-violet-300";
  if (status >= 40) return "bg-sky-100 text-sky-900 ring-sky-300";
  if (status >= 20) return "bg-indigo-100 text-indigo-900 ring-indigo-300";
  return "bg-slate-100 text-slate-800 ring-slate-300";
}

export const PERSON_LABELS: Record<string, string> = {
  P: "Demandeur principal",
  C: "Conjoint",
  G: "Garant / répondant",
};

export function personLabel(code: string): string {
  if (PERSON_LABELS[code]) return PERSON_LABELS[code];
  if (/^E\d+$/.test(code)) return `Enfant ${code.slice(1)}`;
  return code;
}

export const RETURN_REASONS: Record<string, string> = {
  piece_manquante: "Pièce manquante",
  erreur_saisie: "Erreur de saisie",
  incoherence: "Incohérence entre pièces ou formulaires",
  traduction: "Traduction manquante ou non conforme",
  autre: "Autre",
};

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" }).format(new Date(value));
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${pad2(m)}` : `${m} min`;
}

export function daysSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}
