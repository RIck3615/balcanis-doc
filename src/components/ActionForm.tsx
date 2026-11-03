"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions";
import { buttonClass } from "./ui";

type Props = {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  variant?: keyof typeof buttonClass;
  confirmMessage?: string;
};

// Formulaire relié à une action serveur, avec message d'erreur ou de succès
export function ActionForm({ action, children, submitLabel, className, variant = "primary", confirmMessage }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className ?? "space-y-4"}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${buttonClass[variant]}`}
        >
          {pending ? "Un instant…" : submitLabel}
        </button>
        {state?.error && <p className="rounded-lg bg-brand-red-light px-3 py-1.5 text-sm text-brand-red-dark">{state.error}</p>}
        {state?.ok && <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">{state.ok}</p>}
      </div>
    </form>
  );
}
