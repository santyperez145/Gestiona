/**
 * Slider de banners de la home.
 *
 * Con un solo banner no hay slider: se muestra la imagen y listo. Los controles
 * de un carrusel de uno son ruido.
 *
 * El autoplay se detiene cuando el usuario interactúa y cuando la pestaña está
 * en segundo plano; y no arranca si el sistema pide menos movimiento
 * (`prefers-reduced-motion`), que para algunas personas es un problema real y
 * no una preferencia estética.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StoreBanner } from "./storeContext";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";

const INTERVALO_MS = 6000;

export default function StoreBanners({ banners, base, storeName }: { banners: StoreBanner[]; base: string; storeName?: string | null }) {
  const [i, setI] = useState(0);
  const [pausado, setPausado] = useState(false);
  const total = banners.length;
  const ir = useCallback((n: number) => setI(((n % total) + total) % total), [total]);

  useEffect(() => {
    if (total <= 1 || pausado) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      setI(prev => (prev + 1) % total);
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [total, pausado]);

  if (total === 0) return null;

  const b = banners[i];
  const titulo = b.title || storeName || "Tienda online";
  const contenido = (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: "hsl(var(--st-header))" }}
      />
      <picture key={b.id} className="absolute inset-0 block">
        {b.image_url_mobile && <source media="(max-width: 640px)" srcSet={b.image_url_mobile} />}
        <img
          src={b.image_url}
          alt={b.alt_text ?? b.title ?? ""}
          className="absolute inset-0 w-full h-full object-cover"
          onLoad={mostrarImagenValida}
          onError={ocultarImagenRota}
          {...atributosDeImagenVitrina("banner", { lcp: i === 0 })}
        />
      </picture>

      {(b.title || b.subtitle || b.cta_label || !b.image_url) && (
        <div className="absolute inset-0 flex items-end sm:items-center">
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "linear-gradient(90deg, hsl(0 0% 0% / 0.62) 0%, hsl(0 0% 0% / 0.28) 42%, transparent 72%)",
            }}
          />
          <div className="relative z-[1] w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-12 text-left">
            <h2 className="max-w-xl text-2xl sm:text-4xl lg:text-[2.65rem] font-bold tracking-tight text-white leading-[1.08]">
              {titulo}
            </h2>
            {b.subtitle && (
              <p className="mt-3 max-w-lg text-sm sm:text-base text-white/88 leading-relaxed">
                {b.subtitle}
              </p>
            )}
            {b.cta_label && (
              <span
                className="mt-5 inline-flex min-h-11 items-center px-5 py-2.5 text-sm font-semibold"
                style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
              >
                {b.cta_label}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );

  // Los links internos van por react-router para no recargar la tienda entera;
  // los externos, por <a> normal.
  const esExterno = !!b.link_url && /^https?:\/\//.test(b.link_url);
  const destino = b.link_url
    ? (esExterno ? b.link_url : `${base}${b.link_url.startsWith("/") ? "" : "/"}${b.link_url}`)
    : null;

  return (
    <section
      className="storefront-banners relative overflow-hidden select-none"
      style={{ borderBottom: "1px solid hsl(var(--st-border))" }}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      aria-roledescription={total > 1 ? "carrusel" : undefined}
    >
      <div className="relative aspect-[16/8] sm:aspect-[21/7] bg-black/5">
        {destino
          ? (esExterno
            ? <a href={destino} target="_blank" rel="noopener noreferrer" className="block w-full h-full">{contenido}</a>
            : <Link to={destino} className="block w-full h-full">{contenido}</Link>)
          : contenido}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => ir(i - 1)}
            aria-label="Anterior"
            className="absolute left-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center bg-black/55 text-white hover:bg-black/75 transition-colors"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => ir(i + 1)}
            aria-label="Siguiente"
            className="absolute right-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 grid place-items-center bg-black/55 text-white hover:bg-black/75 transition-colors"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
            {banners.map((x, n) => (
              <button
                type="button"
                key={x.id}
                onClick={() => { setPausado(true); ir(n); }}
                aria-label={`Ir al banner ${n + 1}`}
                aria-current={n === i}
                className={`h-1 transition-all ${n === i ? "w-8 bg-white" : "w-4 bg-white/45 hover:bg-white/70"}`}
                style={{ borderRadius: 1 }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
