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
  85: "Complément demandé",
  90: "Fermé",
  99: "Annulé",
};

// Couleur par phase : collecte, traitement, contrôle, chef, terminé, retour
export function statusTone(status: number): string {
  if (status === 55 || status === 75) return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === 35 || status === 85) return "bg-orange-50 text-orange-800 ring-orange-200";
  if (status === 99) return "bg-slate-100 text-slate-500 ring-slate-200";
  if (status >= 80) return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status >= 60) return "bg-brand-red-light text-brand-red-dark ring-brand-red/20";
  if (status >= 40) return "bg-sky-50 text-sky-800 ring-sky-200";
  if (status >= 20) return "bg-navy-light text-navy ring-navy/15";
  return "bg-slate-50 text-slate-700 ring-slate-200";
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
  if (!value) return "Non renseigné";
  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Non renseignée";
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

export const REQUEST_KINDS: Record<string, string> = {
  pieces: "Pièces supplémentaires",
  biometrie: "Biométrie",
  examen_medical: "Examen médical",
  entrevue: "Entrevue",
  passeport: "Passeport à envoyer",
  formulaire: "Formulaire à remplir",
  autre: "Autre",
};

export const REQUEST_STATUS: Record<string, string> = {
  a_faire: "À préparer",
  prete: "Prête à envoyer",
  repondue: "Répondue",
  annulee: "Annulée",
};

// Jours restants avant une date (négatif = en retard)
export function daysUntil(date: string): number {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((new Date(date).getTime() - today.getTime()) / 86400000);
}

export function dueLabel(date: string): { text: string; tone: string } {
  const n = daysUntil(date);
  if (n < 0) return { text: `En retard de ${-n} j`, tone: "bg-brand-red text-white" };
  if (n === 0) return { text: "Aujourd'hui", tone: "bg-brand-red-light text-brand-red-dark ring-1 ring-brand-red/30" };
  if (n <= 3) return { text: `Dans ${n} j`, tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" };
  return { text: `Dans ${n} j`, tone: "bg-slate-100 text-slate-700" };
}
