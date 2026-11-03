import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageTitle, StatTile, buttonClass, inputClass } from "@/components/ui";
import { Avatar, Flag, ROLE_ORDER, RoleChip } from "@/components/AgentBits";
import type { AgentPayment, AppRole, Dossier, Profile } from "@/lib/types";

type Tab = { key: string; label: string; match: (p: Profile) => boolean };

const TABS: Tab[] = [
  { key: "tous", label: "Actifs", match: (p) => p.active },
  { key: "traitement", label: "Traitement", match: (p) => p.active && p.roles.includes("TRT") },
  { key: "controle", label: "Contrôle", match: (p) => p.active && p.roles.includes("CTL") },
  { key: "collecte", label: "Collecte", match: (p) => p.active && p.roles.includes("COL") },
  { key: "encadrement", label: "Encadrement", match: (p) => p.active && p.roles.some((r) => ["GBR", "CHF", "ADM"].includes(r)) },
  { key: "attention", label: "À traiter", match: () => false }, // calculé plus bas
  { key: "inactifs", label: "Inactifs", match: (p) => !p.active },
];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ onglet?: string; q?: string }> }) {
  await requireRole("ADM", "CHF");
  const { onglet = "tous", q = "" } = await searchParams;
  const supabase = await createClient();
  const [{ data: profiles }, { data: payments }, { data: dossiers }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("agent_payments").select("*"), // visible seulement par l'administrateur
    supabase.from("dossiers").select("collector_id, processor_id, controller_id, status").lt("status", 90),
  ]);
  const all = (profiles ?? []) as Profile[];
  const pays = (payments ?? []) as AgentPayment[];
  const open = (dossiers ?? []) as Pick<Dossier, "collector_id" | "processor_id" | "controller_id" | "status">[];

  const pendingPay = new Set(pays.filter((x) => x.pending).map((x) => x.agent_id));
  const needsAttention = (p: Profile) => p.active && (p.roles.length === 0 || p.must_change_password || pendingPay.has(p.id));
  const workload = (id: string) =>
    open.filter((d) => d.collector_id === id || d.processor_id === id || d.controller_id === id).length;

  const tab = TABS.find((t) => t.key === onglet) ?? TABS[0];
  const term = q.trim().toLowerCase();
  const list = all
    .filter((p) => (tab.key === "attention" ? needsAttention(p) : tab.match(p)))
    .filter((p) => !term || [p.full_name, p.email, p.agent_code ?? ""].some((v) => v.toLowerCase().includes(term)));
  const count = (t: Tab) => all.filter((p) => (t.key === "attention" ? needsAttention(p) : t.match(p))).length;

  const active = all.filter((p) => p.active);
  const collectors = active.filter((p) => p.roles.includes("COL"));
  const byRole = (r: AppRole) => active.filter((p) => p.roles.includes(r)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Administration" sub="Comptes, rôles, disponibilité et accès de l'équipe.">
          Agents
        </PageTitle>
        <Link href="/admin/agents/nouveau" className={`mb-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.primary}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          Nouvel agent
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Agents actifs" value={active.length} />
        <StatTile label="Traitement · contrôle" value={`${byRole("TRT")} · ${byRole("CTL")}`} />
        <StatTile label="Collecte disponibles" value={`${collectors.filter((p) => p.available).length} / ${collectors.length}`} tone="emerald" />
        <StatTile label="À traiter" value={count(TABS.find((t) => t.key === "attention")!)} tone="red" />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface p-1">
            {TABS.map((t) => {
              const on = t.key === tab.key;
              return (
                <Link
                  key={t.key}
                  href={`/admin/agents?onglet=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${on ? "bg-white text-navy shadow-sm" : "text-slate-600 hover:text-navy"}`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-xs tabular-nums ${on ? "text-brand-red" : "text-slate-400"}`}>{count(t)}</span>
                </Link>
              );
            })}
          </div>
          <form className="w-full sm:w-72">
            <input type="hidden" name="onglet" value={tab.key} />
            <input name="q" defaultValue={q} placeholder="Rechercher un nom, un courriel, un code" className={inputClass} />
          </form>
        </div>

        {list.length === 0 ? (
          <Empty>Aucun agent dans cette vue.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Agent</th>
                  <th className="px-3 py-2.5">Rôles</th>
                  <th className="px-3 py-2.5">Bureau</th>
                  <th className="px-3 py-2.5">Certifications</th>
                  <th className="px-3 py-2.5 text-right">Dossiers en cours</th>
                  <th className="px-3 py-2.5">État</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => (
                  <tr key={p.id} className="transition hover:bg-navy-light/40">
                    <td className="px-5 py-3">
                      <Link href={`/admin/agents/${p.id}`} className="flex items-center gap-3">
                        <Avatar name={p.full_name || p.email} active={p.active} />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">{p.full_name || "Sans nom"}</span>
                          <span className="block truncate text-xs text-slate-500">
                            <span className="font-mono">{p.agent_code ?? "Sans code"}</span> · {p.email}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {p.roles.length === 0 ? <Flag tone="red">Aucun rôle</Flag> : ROLE_ORDER.filter((r) => p.roles.includes(r)).map((r) => <RoleChip key={r} role={r} short />)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{p.office_code ?? "À distance"}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {p.roles.includes("TRT") ? (p.certified_programs.includes("*") ? "Tous les programmes" : p.certified_programs.join(", ") || "Aucune") : ""}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{workload(p.id)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {!p.active && <Flag tone="slate">Inactif</Flag>}
                        {p.active && p.roles.includes("COL") && (p.available ? <Flag tone="emerald">Disponible</Flag> : <Flag tone="slate">Indisponible</Flag>)}
                        {p.must_change_password && <Flag tone="amber">Mot de passe temporaire</Flag>}
                        {pendingPay.has(p.id) && <Flag tone="red">Paiement à confirmer</Flag>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/admin/agents/${p.id}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${buttonClass.secondary}`}>
                        Gérer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
