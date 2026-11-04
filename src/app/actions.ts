"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, hasRole } from "@/lib/auth";

export type ActionResult = { error?: string; ok?: string; password?: string; email?: string; userId?: string } | null;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function optional(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ error?: string; data?: unknown }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  return { data };
}

// ---------------------------------------------------------------- session
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}

// ---------------------------------------------------------------- dossiers
export async function createDossierAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let clientId = optional(fd, "client_id");
  if (!clientId) {
    const res = await rpc("create_client", {
      p_first_name: str(fd, "first_name"),
      p_last_name: str(fd, "last_name"),
      p_birth_date: optional(fd, "birth_date"),
      p_email: optional(fd, "email"),
      p_phone: optional(fd, "phone"),
      p_country: optional(fd, "country"),
      p_office: optional(fd, "office"),
    });
    if (res.error) return { error: res.error };
    clientId = (res.data as { id: string }).id;
  }
  const res = await rpc("create_dossier", {
    p_client: clientId,
    p_program: str(fd, "program"),
    p_collector: optional(fd, "collector"), // vide = attribution automatique
    p_office: optional(fd, "office"),
  });
  if (res.error) return { error: res.error };
  redirect(`/dossiers/${res.data as string}`);
}

export async function transitionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("transition_dossier", {
    p_dossier: dossier,
    p_to: Number(str(fd, "to")),
    p_reason: optional(fd, "reason"),
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Statut mis à jour" };
}

export async function assignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("assign_dossier", {
    p_dossier: dossier,
    p_role: str(fd, "role"),
    p_agent: str(fd, "agent"),
    p_reason: optional(fd, "reason"),
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Assignation enregistrée" };
}

export async function addMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("add_member", {
    p_dossier: dossier,
    p_person_code: str(fd, "person_code"),
    p_first_name: str(fd, "first_name"),
    p_last_name: str(fd, "last_name"),
    p_birth_date: optional(fd, "birth_date"),
    p_accompanying: fd.get("accompanying") === "on",
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Membre ajouté" };
}

export async function submitReviewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const level = str(fd, "level");
  const answers: { item_id: number; answer: string; comment?: string }[] = [];
  for (const [key, value] of fd.entries()) {
    const m = key.match(/^item_(\d+)$/);
    if (m) answers.push({ item_id: Number(m[1]), answer: String(value), comment: str(fd, `comment_${m[1]}`) });
  }
  const res = await rpc("submit_review", {
    p_dossier: dossier,
    p_level: level,
    p_answers: answers,
    p_comment: optional(fd, "comment"),
    p_reason_codes: fd.getAll("reason_codes").map(String),
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Liste de contrôle enregistrée" };
}

export async function submitDossierAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("submit_dossier", { p_dossier: dossier, p_submission_number: str(fd, "submission_number") });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Dossier soumis" };
}

export async function validateHoursAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("validate_hours", { p_dossier: dossier });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  revalidatePath("/heures");
  return { ok: `${res.data as number} session(s) validée(s)` };
}

export async function correctSessionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("correct_session", {
    p_session: str(fd, "session"),
    p_started: new Date(str(fd, "started") + "Z").toISOString(),
    p_ended: new Date(str(fd, "ended") + "Z").toISOString(),
    p_reason: str(fd, "reason"),
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  return { ok: "Session corrigée" };
}

// Lien temporaire (60 s) vers une pièce ; la consultation est journalisée
export async function openDocumentAction(documentId: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .single();
  if (error || !doc) return { error: "Pièce introuvable" };
  const log = await supabase.rpc("log_document_access", { p_document: documentId, p_action: "consultation" });
  if (log.error) return { error: log.error.message };
  const { data, error: signError } = await supabase.storage.from("dossiers").createSignedUrl(doc.storage_path, 60);
  if (signError || !data) return { error: signError?.message ?? "Lien indisponible" };
  return { url: data.signedUrl };
}

// Téléchargement d'une pièce : lien de 60 s qui force l'enregistrement sous le nom de la nomenclature
export async function downloadDocumentAction(documentId: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("id, storage_path, file_name").eq("id", documentId).single();
  if (!doc) return { error: "Pièce introuvable" };
  const log = await supabase.rpc("log_document_access", { p_document: documentId, p_action: "telechargement" });
  if (log.error) return { error: log.error.message };
  const { data, error } = await supabase.storage.from("dossiers").createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) return { error: error?.message ?? "Lien indisponible" };
  return { url: data.signedUrl };
}

// Téléchargement du dossier complet : liens temporaires pour chaque pièce, rangées
// dans l'arborescence de la nomenclature. Le ZIP est assemblé dans le navigateur.
export async function prepareDossierDownloadAction(
  dossierId: string,
  allVersions: boolean,
): Promise<{ number?: string; files?: { path: string; url: string }[]; error?: string }> {
  const supabase = await createClient();
  const { data: dossier } = await supabase.from("dossiers").select("number").eq("id", dossierId).single();
  if (!dossier) return { error: "Dossier introuvable" };
  let query = supabase.from("documents").select("id, storage_path, file_name, is_current").eq("dossier_id", dossierId);
  if (!allVersions) query = query.eq("is_current", true);
  const { data: docs } = await query;
  if (!docs || docs.length === 0) return { error: "Aucune pièce à télécharger" };

  const logs = await Promise.all(
    docs.map((d) => supabase.rpc("log_document_access", { p_document: d.id, p_action: "telechargement" })),
  );
  const denied = logs.find((l) => l.error);
  if (denied?.error) return { error: denied.error.message };

  const { data: signed, error } = await supabase.storage.from("dossiers").createSignedUrls(docs.map((d) => d.storage_path), 300);
  if (error || !signed) return { error: error?.message ?? "Liens indisponibles" };
  const files = signed
    .filter((x) => x.signedUrl && x.path)
    .map((x) => {
      const doc = docs.find((d) => d.storage_path === x.path)!;
      // storage_path = NUMERO/NN_DOSSIER/fichier ; les anciennes versions vont dans un sous-dossier
      const [, folder] = doc.storage_path.split("/");
      return {
        path: `${dossier.number}/${folder}/${doc.is_current ? "" : "versions_precedentes/"}${doc.file_name}`,
        url: x.signedUrl as string,
      };
    });
  return { number: dossier.number, files };
}

// ---------------------------------------------------------------- agents et profil
export async function adminSetProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const rate = optional(fd, "hourly_rate");
  const certified = str(fd, "certified")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const res = await rpc("admin_set_profile", {
    p_user: str(fd, "user"),
    p_full_name: str(fd, "full_name"),
    p_roles: fd.getAll("roles").map(String),
    p_office: optional(fd, "office"),
    p_certified: certified,
    p_hourly_rate: rate ? Number(rate.replace(",", ".")) : null,
    p_active: fd.get("active") === "on",
  });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/agents", "layout");
  return { ok: "Profil enregistré" };
}

export async function approvePaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("approve_payment", { p_user: str(fd, "user") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/agents", "layout");
  return { ok: "Coordonnées confirmées" };
}

export async function updateMyPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("update_my_payment", {
    p_method: str(fd, "method"),
    p_frequency: str(fd, "frequency"),
    p_details: str(fd, "details"),
  });
  if (res.error) return { error: res.error };
  revalidatePath("/profil");
  return { ok: "Enregistré. L'administrateur doit confirmer avant le prochain paiement." };
}

export async function setAvailabilityAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const available = str(fd, "available") === "true";
  const res = await rpc("set_availability", { p_user: optional(fd, "user"), p_available: available });
  if (res.error) return { error: res.error };
  revalidatePath("/profil");
  revalidatePath("/admin/agents", "layout");
  revalidatePath("/dossiers/nouveau");
  return { ok: available ? "Marqué disponible" : "Marqué indisponible" };
}

// ---------------------------------------------------------------- notifications
export async function openNotificationAction(fd: FormData) {
  const id = Number(str(fd, "id"));
  const link = str(fd, "link");
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_ids: [id] });
  revalidatePath("/", "layout");
  redirect(link.startsWith("/") ? link : "/notifications");
}

export async function markAllNotificationsReadAction() {
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_ids: null });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- création d'agents (ADM, CHF)
// Tout se fait dans la base (fonctions create_agent et reset_agent_password),
// qui vérifie elle-même que l'utilisateur est administrateur ou chef du cabinet.
export async function createAgentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!hasRole(me, "ADM", "CHF")) return { error: "Seuls l'administrateur et le chef du cabinet peuvent créer un agent." };
  const rate = optional(fd, "hourly_rate");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_agent", {
    p_email: str(fd, "email"),
    p_full_name: str(fd, "full_name"),
    p_roles: fd.getAll("roles").map(String),
    p_office: optional(fd, "office"),
    p_certified: str(fd, "certified").split(/[\s,]+/).filter(Boolean),
    p_hourly_rate: rate ? Number(rate.replace(",", ".")) : null,
  });
  if (error) return { error: error.message };
  const row = (data as { user_id: string; agent_code: string; temporary_password: string }[])[0];
  revalidatePath("/admin/agents");
  return { ok: `Agent ${row.agent_code} créé`, email: str(fd, "email").toLowerCase(), password: row.temporary_password, userId: row.user_id };
}

// Nouveau mot de passe temporaire (agent qui a oublié le sien)
export async function resetAgentPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("reset_agent_password", { p_user: str(fd, "user") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/agents");
  return { ok: "Nouveau mot de passe temporaire", email: str(fd, "email"), password: res.data as string };
}

export async function passwordChangedAction() {
  const supabase = await createClient();
  await supabase.rpc("password_changed");
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- bureaux (ADM, CHF)
export async function createOfficeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("create_office", { p_code: str(fd, "code"), p_name: str(fd, "name"), p_country: str(fd, "country") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/bureaux");
  return { ok: `Bureau ${(res.data as { code: string }).code} créé` };
}

export async function updateOfficeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("update_office", {
    p_code: str(fd, "code"),
    p_name: str(fd, "name"),
    p_country: str(fd, "country"),
    p_active: fd.get("active") === "on",
  });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/bureaux");
  return { ok: "Bureau enregistré" };
}

// ---------------------------------------------------------------- formulaires par programme (ADM, CHF)
export async function saveFormTypeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("save_form_type", { p_number: str(fd, "number"), p_label: str(fd, "label"), p_url: str(fd, "url") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/formulaires");
  return { ok: "Formulaire enregistré" };
}

export async function addProgramFormAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("add_program_form", { p_program: str(fd, "program"), p_type: str(fd, "type"), p_scope: str(fd, "scope") || "P" });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/formulaires");
  return { ok: "Ajouté" };
}

export async function removeProgramFormAction(fd: FormData) {
  await rpc("remove_program_form", { p_id: Number(str(fd, "id")) });
  revalidatePath("/admin/formulaires");
}

// ---------------------------------------------------------------- sécurité et paramètres (ADM, CHF)
export async function updateSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const updates: [string, unknown][] = [
    ["telechargement_traitement", fd.get("telechargement_traitement") === "on"],
    ["inactivite_minutes", Number(str(fd, "inactivite_minutes"))],
    ["taille_max_fichier_mo", Number(str(fd, "taille_max_fichier_mo"))],
    ["mfa_obligatoire", fd.get("mfa_obligatoire") === "on"],
  ];
  for (const [key, value] of updates) {
    const res = await rpc("update_setting", { p_key: key, p_value: value });
    if (res.error) return { error: res.error };
  }
  revalidatePath("/", "layout");
  return { ok: "Paramètres enregistrés" };
}

export async function forceSignOutAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("force_sign_out", { p_user: str(fd, "user") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/securite");
  return { ok: `${res.data as number} session(s) fermée(s)` };
}

export async function resetMfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("reset_mfa", { p_user: str(fd, "user") });
  if (res.error) return { error: res.error };
  revalidatePath("/admin/securite");
  return { ok: "Double authentification réinitialisée" };
}

// ---------------------------------------------------------------- suivi après la soumission
export async function addRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const dossier = str(fd, "dossier");
  const res = await rpc("add_authority_request", {
    p_dossier: dossier,
    p_kind: str(fd, "kind"),
    p_title: str(fd, "title"),
    p_details: optional(fd, "details"),
    p_received: optional(fd, "received_on"),
    p_due: optional(fd, "due_on"),
    p_assignee_role: str(fd, "assignee_role"),
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${dossier}`);
  revalidatePath("/suivi");
  return { ok: "Demande enregistrée ; l'agent est prévenu" };
}

export async function markRequestReadyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("mark_request_ready", { p_request: str(fd, "request"), p_note: str(fd, "note") });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${str(fd, "dossier")}`);
  revalidatePath("/suivi");
  return { ok: "Marquée prête ; le chef du cabinet est prévenu" };
}

export async function markRequestAnsweredAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("mark_request_answered", { p_request: str(fd, "request"), p_sent_on: str(fd, "sent_on"), p_note: optional(fd, "note") });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${str(fd, "dossier")}`);
  revalidatePath("/suivi");
  return { ok: "Réponse enregistrée" };
}

export async function cancelRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await rpc("cancel_request", { p_request: str(fd, "request"), p_reason: str(fd, "reason") });
  if (res.error) return { error: res.error };
  revalidatePath(`/dossiers/${str(fd, "dossier")}`);
  revalidatePath("/suivi");
  return { ok: "Demande annulée" };
}
