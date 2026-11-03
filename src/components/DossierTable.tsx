import Link from "next/link";
import type { DossierWithClient } from "@/lib/types";
import { Empty, StatusBadge } from "./ui";
import { daysSince } from "@/lib/labels";

export function DossierTable({ dossiers, empty }: { dossiers: DossierWithClient[]; empty?: string }) {
  if (dossiers.length === 0) return <Empty>{empty ?? "Aucun dossier."}</Empty>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-100 bg-surface/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-5 py-2.5">Dossier</th>
            <th className="px-3 py-2.5">Client</th>
            <th className="px-3 py-2.5">Statut</th>
            <th className="px-3 py-2.5 text-right">Dans ce statut</th>
            <th className="px-5 py-2.5 text-right">Renvois</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dossiers.map((d) => {
            const days = daysSince(d.status_changed_at);
            const late = days >= 7 && d.status < 80;
            return (
              <tr key={d.id} className="transition hover:bg-navy-light/40">
                <td className="px-5 py-3">
                  <Link href={`/dossiers/${d.id}`} className="font-mono text-[13px] font-medium text-navy hover:text-brand-red">
                    {d.number}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  {d.clients ? (
                    <>
                      <span className="font-medium text-slate-900">{d.clients.last_name}</span> {d.clients.first_name}
                      <span className="ml-2 font-mono text-xs text-slate-400">{d.clients.client_code}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">Client inconnu</span>
                  )}
                </td>
                <td className="px-3 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className={late ? "rounded-full bg-brand-red-light px-2 py-0.5 font-semibold text-brand-red-dark" : "text-slate-600"}>
                    {days} j
                  </span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.return_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
