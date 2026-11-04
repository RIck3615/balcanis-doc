import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";

export default function NotFound() {
  return (
    <AuthCard title="Page introuvable" sub="Cette page n'existe pas, ou vous n'avez pas accès à ce contenu.">
      <Link href="/" className="block w-full rounded-lg bg-navy py-2.5 text-center text-sm font-semibold text-white hover:bg-navy-dark">
        Retour au tableau de bord
      </Link>
    </AuthCard>
  );
}
