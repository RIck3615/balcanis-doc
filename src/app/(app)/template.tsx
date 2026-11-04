// Contrairement au layout, le template est recréé à chaque changement de page :
// c'est ce qui rejoue l'animation d'entrée (voir .bc-page dans globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="bc-page">{children}</div>;
}
