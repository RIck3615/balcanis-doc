import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BalCanis — Dossiers",
  description: "Gestion des dossiers clients du cabinet d'immigration BalCanis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
