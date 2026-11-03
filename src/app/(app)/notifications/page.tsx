import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { Card, Empty, PageTitle, buttonClass } from "@/components/ui";
import { markAllNotificationsReadAction, openNotificationAction } from "@/app/actions";
import { formatDateTime } from "@/lib/labels";
import type { NotificationRow } from "@/lib/types";

const KIND_TONE: Record<string, string> = {
  renvoi: "bg-amber-100 text-amber-700",
  annulation: "bg-slate-200 text-slate-600",
  bloque: "bg-brand-red-light text-brand-red-dark",
  decision: "bg-emerald-100 text-emerald-700",
  soumission: "bg-emerald-100 text-emerald-700",
  validation: "bg-brand-red-light text-brand-red-dark",
};

export default async function NotificationsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as NotificationRow[];
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Notifications" sub={unread > 0 ? `${unread} non lue(s)` : "Tout est lu."}>
          Mes notifications
        </PageTitle>
        {unread > 0 && (
          <form action={markAllNotificationsReadAction} className="mb-6">
            <button className={`rounded-lg px-4 py-2 text-sm font-medium ${buttonClass.secondary}`}>Tout marquer comme lu</button>
          </form>
        )}
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>Aucune notification pour l&apos;instant.</Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="link" value={n.link ?? "/notifications"} />
                  <button className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-navy-light/40 ${n.read_at ? "" : "bg-navy-light/30"}`}>
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand-red"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm ${n.read_at ? "text-slate-700" : "font-semibold text-navy"}`}>{n.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_TONE[n.kind] ?? "bg-navy-light text-navy"}`}>
                          {n.kind.replace("_", " ")}
                        </span>
                      </span>
                      {n.body && <span className="mt-0.5 block truncate font-mono text-xs text-slate-500">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTime(n.created_at)}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
