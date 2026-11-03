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
