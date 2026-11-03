import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageTitle } from "@/components/ui";
import { CreateAgentForm } from "@/components/AgentAccountForms";

export default async function NouvelAgentPage() {
  await requireRole("ADM", "CHF");
  const supabase = await createClient();
  const { data: offices } = await supabase.from("offices").select("code, name").eq("active", true).order("code");

  return (
    <div className="space-y-5">
      <Link href="/admin/agents" className="inline-block text-sm font-medium text-navy hover:text-brand-red">‹ Retour aux agents</Link>
      <PageTitle eyebrow="Administration" sub="Le compte est prêt immédiatement. L'agent choisira son propre mot de passe à sa première connexion.">
        Nouvel agent
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Informations" className="lg:col-span-2">
          <CreateAgentForm offices={offices ?? []} />
        </Card>
        <div className="space-y-4">
          <Card title="Quel rôle choisir ?">
            <dl className="space-y-3 text-sm">
              {[
                ["Agent de traitement", "Remplit les formulaires, à distance, payé à l'heure. Indiquez ses programmes certifiés et son taux."],
                ["Contrôleur", "Vérifie les dossiers des autres. Ne contrôle jamais un dossier qu'il a traité."],
                ["Agent de collecte", "Reçoit les clients au bureau. Le bureau est obligatoire."],
                ["Gestionnaire de bureau", "Ouvre et assigne les dossiers de son bureau."],
                ["Chef du cabinet", "Valide et soumet. Peut aussi gérer les agents."],
                ["Administrateur", "Gère les comptes et confirme les coordonnées de paiement."],
              ].map(([t, d]) => (
                <div key={t}>
                  <dt className="font-medium text-navy">{t}</dt>
                  <dd className="text-slate-600">{d}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Après la création">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-600">
              <li>Copiez le message avec le mot de passe temporaire.</li>
              <li>Envoyez-le à l&apos;agent par un canal privé.</li>
              <li>À sa première connexion, il choisit son mot de passe.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
