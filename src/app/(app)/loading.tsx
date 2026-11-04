import { BrandLoader } from "@/components/BrandLoader";

// Affiché instantanément dans la zone de contenu pendant que la page suivante se prépare
// (le menu reste en place) : squelette de la page et indicateur aux couleurs de BalCAN.
export default function Loading() {
  const card = "rounded-2xl border border-slate-200/80 bg-white p-5";
  return (
    <div className="relative">
      <div className="space-y-6" aria-hidden>
        <div className="space-y-2">
          <div className="bc-skeleton h-3 w-28 rounded" />
          <div className="bc-skeleton h-7 w-72 rounded-lg" />
          <div className="bc-skeleton h-3 w-96 max-w-full rounded" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={card}>
              <div className="bc-skeleton h-3 w-24 rounded" />
              <div className="bc-skeleton mt-3 h-7 w-14 rounded-lg" />
            </div>
          ))}
        </div>
        <div className={`${card} space-y-4`}>
          <div className="bc-skeleton h-4 w-48 rounded" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="bc-skeleton h-9 w-9 rounded-full" />
              <div className="bc-skeleton h-3 flex-1 rounded" />
              <div className="bc-skeleton h-5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 top-44 flex justify-center">
        <div className="rounded-3xl border border-slate-100 bg-white px-12 py-9 shadow-[0_16px_48px_rgba(33,51,125,0.16)]">
          <BrandLoader size={84} />
        </div>
      </div>
    </div>
  );
}
