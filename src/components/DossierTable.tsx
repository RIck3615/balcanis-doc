import Link from "next/link";
import type { DossierWithClient } from "@/lib/types";
import { StatusBadge } from "./ui";
import { daysSince } from "@/lib/labels";

export function DossierTable({ dossiers, empty }: { dossiers: DossierWithClient[]; empty?: string }) {
  if (dossiers.length === 0) return <p className="text-sm text-slate-500">{empty ?? "Aucun dossier."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Dossier</th>
            <th className="py-2 pr-3">Client</th>
            <th className="py-2 pr-3">Statut</th>
            <th className="py-2 pr-3 text-right">Dans ce statut</th>
            <th className="py-2 text-right">Renvois</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.map((d) => {
            const days = daysSince(d.status_changed_at);
            return (
              <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-3">
                  <Link href={`/dossiers/${d.id}`} className="font-mono text-slate-900 underline-offset-2 hover:underline">
                    {d.number}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {d.clients ? `${d.clients.last_name} ${d.clients.first_name}` : "—"}
                  <span className="ml-2 font-mono text-xs text-slate-500">{d.clients?.client_code}</span>
                </td>
                <td className="py-2 pr-3"><StatusBadge status={d.status} /></td>
                <td className={`py-2 pr-3 text-right tabular-nums ${days >= 7 && d.status < 80 ? "font-semibold text-red-700" : ""}`}>
                  {days} j
                </td>
                <td className="py-2 text-right tabular-nums">{d.return_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
