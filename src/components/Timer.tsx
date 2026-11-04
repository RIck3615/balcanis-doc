"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/labels";

type Props = {
  dossierId: string;
  canRun: boolean;            // statut où le chronomètre est permis
  billable: boolean;          // le temps de ce statut est payé
  active: { dossier_id: string; started_at: string; number: string } | null;
};

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 10 * 60_000;

// Chronomètre de l'agent de traitement. Il envoie un signal d'activité chaque minute
// tant que l'agent bouge la souris ou tape ; après 10 minutes sans activité,
// la base arrête la session à la dernière activité.
export function Timer({ dossierId, canRun, billable, active }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lastInput = useRef(Date.now());
  const runningHere = active?.dossier_id === dossierId;

  useEffect(() => {
    if (!active) return;
    const mark = () => (lastInput.current = Date.now());
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const beat = setInterval(async () => {
      if (Date.now() - lastInput.current > IDLE_MS) return; // pas d'activité : on laisse la pause se faire
      const { data } = await createClient().rpc("timer_heartbeat");
      if (data === false) router.refresh();
    }, HEARTBEAT_MS);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      clearInterval(tick);
      clearInterval(beat);
    };
  }, [active, router]);

  async function call(fn: "start_timer" | "stop_timer") {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = fn === "start_timer" ? await supabase.rpc(fn, { p_dossier: dossierId }) : await supabase.rpc(fn);
    setPending(false);
    if (error) setError(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {active ? (
        <p className="text-sm">
          {runningHere ? "Session en cours sur ce dossier : " : `Session en cours sur ${active.number} : `}
          <span className="font-mono text-lg font-semibold tabular-nums">
            {formatDuration(now - new Date(active.started_at).getTime())}
          </span>
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          {canRun
            ? billable
              ? "Démarrez le chronomètre quand vous travaillez sur ce dossier. Le temps est payé après acceptation au contrôle."
              : "Correction : le temps est mesuré mais non payé (règle actuelle du cabinet)."
            : "Le chronomètre fonctionne aux statuts En traitement, À corriger, Retourné par le chef et Complément demandé."}
        </p>
      )}
      <div className="flex gap-2">
        {!active && canRun && (
          <button disabled={pending} onClick={() => call("start_timer")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Démarrer
          </button>
        )}
        {active && (
          <button disabled={pending} onClick={() => call("stop_timer")} className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Arrêter
          </button>
        )}
      </div>
      {error && <p className="text-sm text-brand-red-dark">{error}</p>}
    </div>
  );
}
