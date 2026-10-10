import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tutorial } from "@/lib/tutorials";

type Caja = { top: number; left: number; width: number; height: number };

const MARGEN = 8;
const ANCHO_TARJETA = 340;

/** El elemento del paso, si existe y se ve; si no, el paso va centrado. */
function elementoVisible(selector?: string): HTMLElement | null {
  if (!selector) return null;
  let el: HTMLElement | null = null;
  try { el = document.querySelector<HTMLElement>(selector); } catch { return null; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function posicionTarjeta(caja: Caja | null): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ancho = Math.min(ANCHO_TARJETA, vw - 2 * MARGEN);
  if (!caja) return { width: ancho, left: (vw - ancho) / 2, top: Math.max(MARGEN, vh / 2 - 120) };
  const left = Math.min(Math.max(MARGEN, caja.left), vw - ancho - MARGEN);
  // Debajo del elemento si entra; si no, arriba.
  const abajo = caja.top + caja.height + 12;
  if (abajo + 200 < vh) return { width: ancho, left, top: abajo };
  return { width: ancho, left, bottom: Math.max(MARGEN, vh - caja.top + 12) };
}

/**
 * Recorrido guiado: resalta el elemento del paso y explica qué hace.
 * Teclado: → / Enter avanza, ← vuelve, Esc cierra.
 */
export default function TutorialOverlay({ tutorial, onTerminar, onCerrar }: {
  tutorial: Tutorial;
  onTerminar: () => void;
  onCerrar: () => void;
}) {
  const [indice, setIndice] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const paso = tutorial.pasos[indice];
  const ultimo = indice === tutorial.pasos.length - 1;

  const medir = useCallback(() => {
    const el = elementoVisible(paso?.target);
    if (!el) { setCaja(null); return; }
    const r = el.getBoundingClientRect();
    setCaja({ top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 });
  }, [paso?.target]);

  useLayoutEffect(() => {
    const el = elementoVisible(paso?.target);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    medir();
    // El scroll suave termina después: se vuelve a medir.
    const t = window.setTimeout(medir, 350);
    return () => window.clearTimeout(t);
  }, [medir, paso?.target]);

  useEffect(() => {
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => { window.removeEventListener("resize", medir); window.removeEventListener("scroll", medir, true); };
  }, [medir]);

  const siguiente = useCallback(() => { if (ultimo) onTerminar(); else setIndice(i => i + 1); }, [ultimo, onTerminar]);
  const anterior = useCallback(() => setIndice(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); siguiente(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); anterior(); }
    };
    // Captura: el recorrido tiene prioridad sobre los atajos de la pantalla (F-keys del POS).
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [siguiente, anterior, onCerrar]);

  if (!paso) return null;

  return createPortal(<div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tutorial-titulo">
    {caja
      ? <div aria-hidden className="pointer-events-none fixed rounded-[10px] ring-2 ring-primary transition-all duration-200"
          style={{ top: caja.top, left: caja.left, width: caja.width, height: caja.height, boxShadow: "0 0 0 9999px hsl(var(--background) / 0.72)" }} />
      : <div aria-hidden className="fixed inset-0 bg-background/72" />}
    <div className="fixed rounded-[12px] border border-border bg-card p-4 shadow-xl" style={posicionTarjeta(caja)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">{tutorial.titulo} · {indice + 1} de {tutorial.pasos.length}</p>
          <h2 id="tutorial-titulo" className="mt-0.5 text-sm font-semibold">{paso.titulo}</h2>
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar recorrido" className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{paso.texto}</p>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {tutorial.pasos.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === indice ? "bg-primary" : "bg-muted-foreground/30"}`} />)}
        </div>
        {indice > 0 && <Button type="button" size="sm" variant="ghost" onClick={anterior}>Anterior</Button>}
        <Button type="button" size="sm" onClick={siguiente} autoFocus>{ultimo ? "Terminar" : "Siguiente"}</Button>
      </div>
    </div>
  </div>, document.body);
}
