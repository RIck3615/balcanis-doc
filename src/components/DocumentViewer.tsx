"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { openDocumentAction } from "@/app/actions";
import { DownloadDocumentButton } from "./DownloadButtons";
import { daysUntil, expiryLabel, formatDate } from "@/lib/labels";

// ---------------------------------------------------------------------
// Visionneuse intégrée : les pièces du dossier s'affichent dans la
// plateforme (PDF, JPG, PNG), sans ouvrir d'onglet ni enregistrer de
// fichier. Chaque ouverture est inscrite au journal (consultation).
// Un filigrane avec le code de l'agent décourage les captures d'écran.
// ---------------------------------------------------------------------

export type ViewerDoc = {
  id: string;
  file_name: string;
  label: string;
  person: string;
  folder: string;
  expires_on: string | null;
  is_current: boolean;
};

type Ctx = { open: (id: string) => void };
const ViewerContext = createContext<Ctx | null>(null);
export const useDocumentViewer = () => useContext(ViewerContext);

export function DocumentViewerProvider({
  docs, canDownload, watermark, children,
}: { docs: ViewerDoc[]; canDownload: boolean; watermark: string; children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ open: (id: string) => setOpenId(id) }), []);
  return (
    <ViewerContext.Provider value={value}>
      {children}
      {openId && (
        <Viewer docs={docs} id={openId} onChange={setOpenId} onClose={() => setOpenId(null)} canDownload={canDownload} watermark={watermark} />
      )}
    </ViewerContext.Provider>
  );
}

type Loaded =
  | { kind: "pdf"; data: ArrayBuffer }
  | { kind: "image"; url: string }
  | { kind: "error"; message: string };

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="rounded-lg p-2 text-slate-200 transition hover:bg-white/10 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

function Viewer({
  docs, id, onChange, onClose, canDownload, watermark,
}: { docs: ViewerDoc[]; id: string; onChange: (id: string) => void; onClose: () => void; canDownload: boolean; watermark: string }) {
  const index = Math.max(0, docs.findIndex((d) => d.id === id));
  const doc = docs[index];
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [pages, setPages] = useState(0);
  const [list, setList] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // chargement de la pièce (lien de 60 secondes, lu une seule fois)
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoaded(null);
    setPages(0);
    setRotation(0);
    setFit(true);
    setZoom(1);
    (async () => {
      const res = await openDocumentAction(id);
      if (cancelled) return;
      if (!res.url) return setLoaded({ kind: "error", message: res.error ?? "Pièce indisponible" });
      try {
        const r = await fetch(res.url, { cache: "no-store" });
        if (!r.ok) throw new Error(`Erreur ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        const ext = (doc?.file_name.split(".").pop() ?? "").toLowerCase();
        if (ext === "pdf" || blob.type === "application/pdf") {
          setLoaded({ kind: "pdf", data: await blob.arrayBuffer() });
        } else if (["jpg", "jpeg", "png"].includes(ext) || blob.type.startsWith("image/")) {
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ kind: "image", url: objectUrl });
        } else {
          setLoaded({ kind: "error", message: "Format non pris en charge par la visionneuse" });
        }
      } catch (e) {
        if (!cancelled) setLoaded({ kind: "error", message: e instanceof Error ? e.message : "Chargement impossible" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, doc?.file_name]);

  const go = useCallback((delta: number) => {
    const next = docs[index + delta];
    if (next) onChange(next.id);
  }, [docs, index, onChange]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    setFit(false);
    setZoom((z) => {
      const i = ZOOMS.findIndex((v) => v >= z - 0.001);
      return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    });
  }, []);

  // clavier : Échap, flèches, + et -
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && !e.altKey) go(1);
      else if (e.key === "ArrowLeft" && !e.altKey) go(-1);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-") zoomBy(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose, zoomBy]);

  if (!doc) return null;
  const expiry = doc.expires_on ? expiryLabel(daysUntil(doc.expires_on)) : null;
  const blockMenu = canDownload ? undefined : (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Visionneuse : ${doc.file_name}`}>
      {/* barre du haut */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-navy-dark/80 px-3 py-2 sm:px-4">
        <ToolButton label="Liste des pièces" onClick={() => setList((v) => !v)}>
          <Icon d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" className="h-5 w-5" />
        </ToolButton>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] text-white">{doc.file_name}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>{doc.label}</span><span className="font-mono">{doc.person}</span>
            {!doc.is_current && <span className="rounded-full bg-white/10 px-2 py-0.5">Ancienne version</span>}
            {expiry && doc.expires_on && (
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${expiry.tone}`}>{expiry.text} · {formatDate(doc.expires_on)}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <ToolButton label="Pièce précédente" onClick={() => go(-1)} disabled={index === 0}><Icon d="m15 18-6-6 6-6" className="h-5 w-5" /></ToolButton>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-slate-300">{index + 1} / {docs.length}</span>
          <ToolButton label="Pièce suivante" onClick={() => go(1)} disabled={index === docs.length - 1}><Icon d="m9 18 6-6-6-6" className="h-5 w-5" /></ToolButton>
        </div>
        <div className="flex items-center gap-0.5 border-l border-white/10 pl-2">
          <ToolButton label="Réduire" onClick={() => zoomBy(-1)}><Icon d="M5 12h14" /></ToolButton>
          <button type="button" onClick={() => setFit((f) => !f)} title="Ajuster à la largeur"
            className="min-w-[3.5rem] rounded-lg px-2 py-1.5 text-xs tabular-nums text-slate-200 hover:bg-white/10">
            {fit ? "Largeur" : `${Math.round(zoom * 100)} %`}
          </button>
          <ToolButton label="Agrandir" onClick={() => zoomBy(1)}><Icon d="M12 5v14M5 12h14" /></ToolButton>
          <ToolButton label="Pivoter" onClick={() => setRotation((r) => (r + 90) % 360)}><Icon d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></ToolButton>
          {canDownload && (
            <span className="[&_button]:text-slate-200 [&_button]:ring-white/20 [&_button:hover]:bg-white/10 ml-1">
              <DownloadDocumentButton documentId={doc.id} />
            </span>
          )}
          <ToolButton label="Fermer (Échap)" onClick={onClose}><Icon d="M6 6l12 12M18 6 6 18" className="h-5 w-5" /></ToolButton>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* liste des pièces du dossier */}
        {list && (
          <aside className="absolute inset-y-0 left-0 z-10 w-72 max-w-[85vw] shrink-0 overflow-y-auto border-r border-white/10 bg-navy-dark p-2 shadow-2xl md:static md:bg-navy-dark/60 md:shadow-none">
            {docs.map((d, i) => (
              <div key={d.id}>
                {d.folder !== docs[i - 1]?.folder && <p className="px-2 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">{d.folder}</p>}
                <button type="button" onClick={() => onChange(d.id)}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${d.id === doc.id ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                  <span className="block truncate">{d.label} <span className="font-mono text-slate-400">{d.person}</span></span>
                  <span className="block truncate font-mono text-[10px] text-slate-500">{d.file_name}</span>
                </button>
              </div>
            ))}
          </aside>
        )}

        {/* zone d'affichage */}
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-auto" onContextMenu={blockMenu}>
          {!loaded && <Spinner text="Chargement de la pièce…" />}
          {loaded?.kind === "error" && (
            <div className="flex h-full items-center justify-center p-6">
              <p className="rounded-xl bg-brand-red-light px-4 py-3 text-sm text-brand-red-dark">{loaded.message}</p>
            </div>
          )}
          {loaded?.kind === "image" && (
            <ImageView url={loaded.url} zoom={zoom} fit={fit} rotation={rotation} scroller={scroller} watermark={watermark} />
          )}
          {loaded?.kind === "pdf" && (
            <PdfView key={id} data={loaded.data} zoom={zoom} fit={fit} rotation={rotation} scroller={scroller} watermark={watermark} onPages={setPages} />
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/10 bg-navy-dark/80 px-4 py-1.5 text-[11px] text-slate-400">
        <span>{pages > 0 ? `${pages} page${pages > 1 ? "s" : ""}` : " "}</span>
        <span className="hidden sm:inline">Échap pour fermer · flèches pour changer de pièce · + et - pour le zoom</span>
        <span>Consultation inscrite au journal</span>
      </footer>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-300">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand-red" aria-hidden />
      {text}
    </div>
  );
}

// Filigrane : code de l'agent et date, répété en diagonale sur la page
function Watermark({ text }: { text: string }) {
  const line = `${text} · ${new Date().toLocaleDateString("fr-CA")} · BalCanis confidentiel`;
  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden" aria-hidden>
      <div className="absolute -inset-1/2 flex rotate-[-30deg] flex-col justify-around">
        {Array.from({ length: 14 }).map((_, i) => (
          <p key={i} className="whitespace-nowrap text-center text-sm font-semibold tracking-wider text-navy/[0.09]" style={{ marginLeft: i % 2 ? "8rem" : 0 }}>
            {Array.from({ length: 6 }).map(() => line).join("      ")}
          </p>
        ))}
      </div>
    </div>
  );
}

function useWidth(scroller: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [scroller]);
  return width;
}

function ImageView({ url, zoom, fit, rotation, scroller, watermark }: {
  url: string; zoom: number; fit: boolean; rotation: number; scroller: React.RefObject<HTMLDivElement | null>; watermark: string;
}) {
  const width = useWidth(scroller);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const sideways = rotation % 180 !== 0;
  const baseW = natural ? (sideways ? natural.h : natural.w) : 0;
  const scale = natural ? (fit && width > 0 ? Math.min(1.5, Math.min(1100, width - 48) / baseW) : zoom) : 1;
  const boxW = natural ? baseW * scale : 0;
  const boxH = natural ? (sideways ? natural.w : natural.h) * scale : 0;
  return (
    <div className="flex min-h-full justify-center p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="hidden" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {natural && (
        <div className="relative shrink-0 overflow-hidden rounded bg-white shadow-2xl" style={{ width: boxW, height: boxH }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Pièce du dossier" draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none"
            style={{ width: natural.w * scale, height: natural.h * scale, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} />
          <Watermark text={watermark} />
        </div>
      )}
      {!natural && <Spinner text="Préparation de l'image…" />}
    </div>
  );
}

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

function PdfView({ data, zoom, fit, rotation, scroller, watermark, onPages }: {
  data: ArrayBuffer; zoom: number; fit: boolean; rotation: number;
  scroller: React.RefObject<HTMLDivElement | null>; watermark: string; onPages: (n: number) => void;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false, enableXfa: false });
        loaded = await task.promise;
        if (cancelled) return void loaded.destroy();
        setPdf(loaded);
        onPages(loaded.numPages);
      } catch {
        if (!cancelled) setError("Ce PDF ne peut pas être affiché (fichier endommagé ou protégé par mot de passe).");
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [data, onPages]);

  const width = useWidth(scroller);
  if (error) return <div className="flex h-full items-center justify-center p-6"><p className="rounded-xl bg-brand-red-light px-4 py-3 text-sm text-brand-red-dark">{error}</p></div>;
  if (!pdf) return <Spinner text="Ouverture du PDF…" />;
  const count = Math.min(pdf.numPages, 200);
  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {Array.from({ length: count }).map((_, i) => (
        <PdfPage key={i} pdf={pdf} number={i + 1} zoom={zoom} fit={fit} rotation={rotation} width={width} watermark={watermark} />
      ))}
      {pdf.numPages > count && <p className="text-xs text-slate-400">Seules les {count} premières pages sont affichées.</p>}
    </div>
  );
}

function PdfPage({ pdf, number, zoom, fit, rotation, width, watermark }: {
  pdf: PdfDoc; number: number; zoom: number; fit: boolean; rotation: number; width: number; watermark: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(number <= 2);

  // rendu seulement quand la page approche de l'écran
  useEffect(() => {
    const el = holder.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const scale = fit ? Math.max(0.2, Math.min(960, width - 48) / base.width) : zoom * 1.25;
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
      setSize({ w: viewport.width, h: viewport.height });
      if (!visible || !canvas.current) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try { await task.promise; } catch { /* rendu annulé */ }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, number, zoom, fit, rotation, width, visible]);

  return (
    <div ref={holder} className="relative shrink-0 overflow-hidden rounded bg-white shadow-2xl"
      style={{ width: size?.w ?? Math.max(200, Math.min(960, width - 48)), height: size?.h ?? Math.max(200, Math.min(960, width - 48)) * 1.29 }}>
      <canvas ref={canvas} className="block h-full w-full" />
      <Watermark text={watermark} />
      <span className="absolute bottom-1.5 right-2 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-white">{number} / {pdf.numPages}</span>
    </div>
  );
}
