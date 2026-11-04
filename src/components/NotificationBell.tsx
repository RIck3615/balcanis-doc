"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Toast = { id: number; title: string; body: string | null; link: string | null };

// Cloche avec le nombre de notifications non lues, mise à jour en temps réel,
// et petite fenêtre qui apparaît à l'arrivée d'une nouvelle notification.
export function NotificationBell({ userId, unread }: { userId: string; unread: number }) {
  const router = useRouter();
  const [count, setCount] = useState(unread);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => setCount(unread), [unread]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      // nom unique par cloche : la cloche peut être affichée deux fois (menu ordinateur et barre mobile)
      .channel(`notifications-${userId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Toast;
          setCount((c) => c + 1);
          setToast({ id: n.id, title: n.title, body: n.body, link: n.link });
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }, [count]);

  return (
    <>
      <Link
        href="/notifications"
        aria-label={`Notifications${count > 0 ? ` : ${count} non lue(s)` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-navy transition hover:bg-navy-light"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_40px_rgba(33,51,125,0.18)]" role="status">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-red" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-navy">{toast.title}</p>
              {toast.body && <p className="mt-0.5 truncate text-xs text-slate-600">{toast.body}</p>}
              <div className="mt-2 flex gap-3 text-xs font-medium">
                {toast.link && (
                  <Link href={toast.link} onClick={() => setToast(null)} className="text-navy hover:text-brand-red">Ouvrir</Link>
                )}
                <button onClick={() => setToast(null)} className="text-slate-500 hover:text-slate-700">Fermer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
