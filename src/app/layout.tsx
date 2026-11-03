import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BalCAN · Gestion des dossiers",
  description: "Plateforme de gestion des dossiers clients de BalCAN Immigration Services",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-surface text-slate-900 antialiased">{children}</body>
    </html>
  );
}
