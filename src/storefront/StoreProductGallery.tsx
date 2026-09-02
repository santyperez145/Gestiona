/**
 * Galería de la ficha: miniaturas, desliz y foto ampliada.
 *
 * La competencia seria abre la toma a pantalla completa y deja pasar entre
 * fotos. Acá el zoom es un 2× sobre la misma URL del comercio — no hay CDN
 * ni recorte — y el stock/precio siguen fuera.
 */
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";
import {
  clampIndice,
  indiceAnterior,
  indicePorDesliz,
  indiceSiguiente,
} from "@/lib/storeProductGallery";

export default function StoreProductGallery({
  imagenes,
  alt,
  resetKey,
}: {
  imagenes: string[];
  alt: string;
  resetKey?: string | null;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const [zoom, setZoom] = useState(false);
  const toque = useRef<number | null>(null);

  useEffect(() => {
    setImgIdx(0);
    setZoom(false);
  }, [resetKey]);

  useEffect(() => {
    setImgIdx((i) => clampIndice(i, imagenes.length));
  }, [imagenes.length]);

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAbierta(false); setZoom(false); }
      if (e.key === "ArrowRight") setImgIdx((i) => indiceSiguiente(i, imagenes.length));
      if (e.key === "ArrowLeft") setImgIdx((i) => indiceAnterior(i, imagenes.length));
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [abierta, imagenes.length]);

  const idx = clampIndice(imgIdx, imagenes.length);
  const src = imagenes[idx];
  const varias = imagenes.length > 1;

  const onTouchStart = (e: TouchEvent) => {
    toque.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = toque.current;
    toque.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX;
    if (end == null) return;
    setImgIdx((i) => indicePorDesliz(end - start, i, imagenes.length));
  };

  return (
    <div>
      <div
        className="relative aspect-square overflow-hidden bg-black/5 border"
        style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div aria-hidden="true" className="absolute inset-0 grid place-items-center opacity-20">
          <ZoomIn className="w-12 h-12" />
        </div>
        {src && (
          <button
            type="button"
            onClick={() => { setAbierta(true); setZoom(false); }}
            className="absolute inset-0 min-h-11 w-full"
            aria-label="Ver foto ampliada"
          >
            <img
              key={src}
              src={src}
              alt={alt}
              {...atributosDeImagenVitrina("ficha", { lcp: imgIdx === 0 })}
              onLoad={mostrarImagenValida}
              onError={ocultarImagenRota}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </button>
        )}
        {varias && (
          <>
            <button
              type="button"
              aria-label="Foto anterior"
              onClick={() => setImgIdx((i) => indiceAnterior(i, imagenes.length))}
              className="absolute left-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center bg-black/45 text-white"
              style={{ borderRadius: "var(--st-radius)" }}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="Foto siguiente"
              onClick={() => setImgIdx((i) => indiceSiguiente(i, imagenes.length))}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center bg-black/45 text-white"
              style={{ borderRadius: "var(--st-radius)" }}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {varias && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {imagenes.map((thumb, i) => (
            <button
              key={thumb}
              type="button"
              onClick={() => setImgIdx(i)}
              aria-label={`Ver foto ${i + 1} de ${imagenes.length}`}
              aria-current={i === idx}
              className="h-16 w-16 min-h-11 shrink-0 overflow-hidden border-2 transition-colors"
              style={{
                borderColor: i === idx ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                borderRadius: "var(--st-radius)",
              }}
            >
              <img
                src={thumb}
                alt=""
                {...atributosDeImagenVitrina("miniatura")}
                onLoad={mostrarImagenValida}
                onError={ocultarImagenRota}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {abierta && src && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto del producto"
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center justify-end gap-2 p-3">
            <button
              type="button"
              onClick={() => setZoom((z) => !z)}
              className="min-h-11 min-w-11 px-3 inline-flex items-center justify-center gap-1.5 text-sm text-white"
              aria-pressed={zoom}
            >
              {zoom ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
              {zoom ? "Alejar" : "Acercar"}
            </button>
            <button
              type="button"
              onClick={() => { setAbierta(false); setZoom(false); }}
              className="min-h-11 min-w-11 grid place-items-center text-white"
              aria-label="Cerrar foto"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <img
              src={src}
              alt={alt}
              className={`mx-auto h-full max-h-full w-full object-contain transition-transform ${zoom ? "scale-150 cursor-zoom-out" : "cursor-zoom-in"}`}
              onClick={() => setZoom((z) => !z)}
            />
            {varias && (
              <>
                <button
                  type="button"
                  aria-label="Foto anterior"
                  onClick={() => setImgIdx((i) => indiceAnterior(i, imagenes.length))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center text-white"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  aria-label="Foto siguiente"
                  onClick={() => setImgIdx((i) => indiceSiguiente(i, imagenes.length))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center text-white"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
