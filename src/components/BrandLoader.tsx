import Image from "next/image";

// Indicateur de chargement aux couleurs de BalCAN : le symbole du logo entouré
// de deux anneaux qui tournent en sens inverse (bleu marine et rouge).
export function BrandLoader({ label = "Chargement", size = 72 }: { label?: string; size?: number }) {
  const mark = Math.round(size * 0.5);
  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <div className="relative" style={{ width: size, height: size }}>
        <span className="absolute inset-0 rounded-full border-[3px] border-navy-light" aria-hidden />
        <span className="bc-ring absolute inset-0 rounded-full border-[3px] border-transparent border-t-navy border-r-navy" aria-hidden />
        <span className="bc-ring-slow absolute inset-[7px] rounded-full border-2 border-transparent border-b-brand-red" aria-hidden />
        <span className="bc-mark absolute inset-0 flex items-center justify-center">
          <Image src="/logo-mark.png" alt="" width={mark} height={mark} priority />
        </span>
      </div>
      <p className="flex items-baseline gap-0.5 text-sm font-medium text-navy">
        {label}
        <span className="bc-dot inline-block" style={{ animationDelay: "0s" }}>.</span>
        <span className="bc-dot inline-block" style={{ animationDelay: "0.15s" }}>.</span>
        <span className="bc-dot inline-block" style={{ animationDelay: "0.3s" }}>.</span>
      </p>
    </div>
  );
}
