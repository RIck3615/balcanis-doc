"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Déconnexion automatique après une période sans activité (poste partagé, oubli)
export function IdleLogout({ minutes }: { minutes: number }) {
  const last = useRef(Date.now());
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    const limit = minutes * 60_000;
    const mark = () => {
      last.current = Date.now();
      setWarning(false);
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const timer = setInterval(async () => {
      const idle = Date.now() - last.current;
      if (idle > limit) {
        clearInterval(timer);
        await createClient().auth.signOut();
        window.location.href = "/connexion?raison=inactivite";
      } else if (idle > limit - 60_000) {
        setWarning(true);
      }
    }, 10_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      clearInterval(timer);
    };
  }, [minutes]);

  if (!warning) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white" role="alert">
      Sans activité, vous serez déconnecté dans moins d&apos;une minute. Bougez la souris pour rester connecté.
    </div>
  );
}
