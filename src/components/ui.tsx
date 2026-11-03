import { STATUS_LABELS, pad2, statusTone } from "@/lib/labels";

export function StatusBadge({ status }: { status: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusTone(status)}`}>
      <span className="font-mono text-[11px] opacity-70">{pad2(status)}</span>
      {STATUS_LABELS[status] ?? "?"}
    </span>
  );
}

export function Card({
  title, children, actions, className = "",
}: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,0.05)] ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-navy">
              <span className="h-4 w-1 rounded-full bg-brand-red" aria-hidden />
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15 disabled:bg-slate-50";

export const buttonClass = {
  primary: "bg-navy text-white shadow-sm hover:bg-navy-dark",
  secondary: "bg-white text-navy ring-1 ring-inset ring-slate-300 hover:bg-navy-light",
  danger: "bg-brand-red text-white shadow-sm hover:bg-brand-red-dark",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
};

export function PageTitle({ children, sub, eyebrow }: { children: React.ReactNode; sub?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6">
      {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-red">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-navy">{children}</h1>
      {sub && <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{sub}</p>}
    </div>
  );
}

export function StatTile({ label, value, tone = "navy" }: { label: string; value: number | string; tone?: "navy" | "red" | "amber" | "emerald" }) {
  const tones = {
    navy: "text-navy",
    red: "text-brand-red",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.05)]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}
