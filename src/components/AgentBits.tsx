import type { AppRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/labels";

export const ROLE_ORDER: AppRole[] = ["TRT", "CTL", "COL", "GBR", "CHF", "ADM"];

const ROLE_TONE: Record<AppRole, string> = {
  TRT: "bg-navy-light text-navy",
  CTL: "bg-sky-50 text-sky-800",
  COL: "bg-emerald-50 text-emerald-800",
  GBR: "bg-violet-50 text-violet-800",
  CHF: "bg-brand-red-light text-brand-red-dark",
  ADM: "bg-slate-100 text-slate-700",
};

export function RoleChip({ role, short }: { role: AppRole; short?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${ROLE_TONE[role]}`} title={ROLE_LABELS[role]}>
      {short ? role : ROLE_LABELS[role]}
    </span>
  );
}

export function Avatar({ name, active = true, size = "md" }: { name: string; active?: boolean; size?: "md" | "lg" }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const dims = size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${dims} ${active ? "bg-navy text-white" : "bg-slate-200 text-slate-500"}`}>
      {initials || "?"}
    </span>
  );
}

export function Flag({ tone, children }: { tone: "amber" | "red" | "slate" | "emerald"; children: React.ReactNode }) {
  const tones = {
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-brand-red-light text-brand-red-dark ring-brand-red/20",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}
