import Image from "next/image";

// Mise en page des écrans d'authentification (hors menu)
export function AuthCard({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Image src="/logo.png" alt="BalCAN Immigration Services" width={120} height={122} priority />
        </div>
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_8px_30px_rgba(33,51,125,0.08)]">
          <div>
            <h1 className="text-lg font-semibold text-navy">{title}</h1>
            {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export const authInput =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15";
export const authButton =
  "w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-dark disabled:opacity-50";
