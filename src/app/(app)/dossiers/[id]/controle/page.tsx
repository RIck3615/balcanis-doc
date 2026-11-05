import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getProfile, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ControlWorkspace, type CheckPoint, type ControlDoc, type SavedCheck } from "@/components/ControlWorkspace";
import type { DocumentCategory, DocumentRow, DocumentType, Dossier, ChecklistItem } from "@/lib/types";

// Espace de contrôle : réservé au contrôleur du dossier, au statut 50
export default async function ControlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const profile = await getProfile();
  const supabase = await createClient();
  const { data: dossierData } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
  if (!dossierData) notFound();
  const d = dossierData as Dossier;
  const isController = hasRole(profile, "CTL") && d.controller_id === profile.id && d.processor_id !== profile.id;
  if (!isController || d.status !== 50) redirect(`/dossiers/${id}`);

  const [{ data: documents }, { data: types }, { data: categories }, { data: checklist }, { data: round }, { data: canDownload }] = await Promise.all([
    supabase.from("documents").select("*").eq("dossier_id", id).eq("is_current", true).order("category_code").order("person_code").order("type_code"),
    supabase.from("document_types").select("*"),
    supabase.from("document_categories").select("*").order("code"),
    supabase.from("checklist_items").select("*").eq("active", true).eq("level", "controle")
      .or(`program_code.is.null,program_code.eq.${d.program_code}`).order("sort"),
    supabase.rpc("control_round", { p_dossier: id }),
    supabase.rpc("can_download"),
  ]);
  const docs = (documents ?? []) as DocumentRow[];
  const typeList = (types ?? []) as DocumentType[];
  const catList = (categories ?? []) as DocumentCategory[];
  const currentRound = (round as number) ?? 1;

  const { data: checkRows } = await supabase
    .from("document_checks")
    .select("document_id, round, points, result, comment")
    .eq("dossier_id", id)
    .order("round", { ascending: false });
  type Row = { document_id: string; round: number; points: Record<string, "exact" | "inexact">; result: "conforme" | "non_conforme"; comment: string | null };
  const rows = (checkRows ?? []) as Row[];

  // une pièce remplacée après un renvoi n'a plus le même identifiant : on retrouve
  // le signalement précédent par la personne et le type de pièce
  const { data: flagged } = await supabase
    .from("document_checks")
    .select("round, comment, documents(person_code, type_code)")
    .eq("dossier_id", id)
    .eq("result", "non_conforme")
    .lt("round", currentRound)
    .order("round", { ascending: false });
  type Flag = { round: number; comment: string | null; documents: { person_code: string; type_code: string } | null };
  const flags = (flagged ?? []) as unknown as Flag[];

  const points = await Promise.all(docs.map((doc) => supabase.rpc("document_check_points", { p_document: doc.id })));

  const controlDocs: ControlDoc[] = docs.map((doc, i) => {
    const t = typeList.find((x) => x.code === doc.type_code);
    const saved = rows.find((r) => r.document_id === doc.id && r.round === currentRound);
    const prev = flags.find((f) => f.documents?.person_code === doc.person_code && f.documents?.type_code === doc.type_code);
    return {
      id: doc.id,
      file_name: doc.file_name,
      label: t?.label ?? doc.type_code,
      person: doc.person_code,
      folder: catList.find((c) => c.code === doc.category_code)?.folder ?? doc.category_code,
      expires_on: doc.expires_on,
      is_current: true,
      points: ((points[i].data ?? []) as CheckPoint[]),
      check: saved ? ({ result: saved.result, points: saved.points, comment: saved.comment } as SavedCheck) : null,
      previous: prev ? { comment: prev.comment, round: prev.round } : null,
    };
  });

  return (
    <ControlWorkspace
      dossierId={id}
      number={d.number}
      round={currentRound}
      docs={controlDocs}
      items={((checklist ?? []) as ChecklistItem[]).map((i) => ({ id: i.id, label: i.label }))}
      canDownload={!!canDownload}
      watermark={profile.agent_code ?? profile.email}
    />
  );
}
