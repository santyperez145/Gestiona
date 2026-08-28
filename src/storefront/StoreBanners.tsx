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

const INTERVALO_MS = 6000;

export default function StoreBanners({ banners, base }: { banners: StoreBanner[]; base: string }) {
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
  const contenido = (
    <>
      <picture>
        {b.image_url_mobile && <source media="(max-width: 640px)" srcSet={b.image_url_mobile} />}
        <img
          src={b.image_url}
          alt={b.alt_text ?? b.title ?? ""}
          className="w-full h-full object-cover"
          // El primero decide el LCP de la home; los demás pueden esperar.
          loading={i === 0 ? "eager" : "lazy"}
        />
      </picture>

      {(b.title || b.subtitle || b.cta_label) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-black/35">
          {b.title && <h2 className="text-2xl sm:text-4xl font-bold text-white drop-shadow">{b.title}</h2>}
          {b.subtitle && <p className="mt-2 text-sm sm:text-lg text-white/90 max-w-2xl drop-shadow">{b.subtitle}</p>}
          {b.cta_label && (
            <span
              className="mt-5 inline-block px-6 py-3 font-medium"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              {b.cta_label}
            </span>
          )}
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
      className="relative overflow-hidden select-none"
      style={{ borderBottom: "1px solid hsl(var(--st-border))" }}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      aria-roledescription={total > 1 ? "carrusel" : undefined}
    >
      <div className="relative aspect-[16/7] sm:aspect-[21/7] bg-black/5">
        {destino
          ? (esExterno
            ? <a href={destino} target="_blank" rel="noopener noreferrer" className="block w-full h-full">{contenido}</a>
            : <Link to={destino} className="block w-full h-full">{contenido}</Link>)
          : contenido}
      </div>

      {total > 1 && (
        <>
          <button
            onClick={() => ir(i - 1)}
            aria-label="Anterior"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 min-h-11 min-w-11 grid place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => ir(i + 1)}
            aria-label="Siguiente"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 min-h-11 min-w-11 grid place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
            {banners.map((x, n) => (
              <button
                key={x.id}
                onClick={() => { setPausado(true); ir(n); }}
                aria-label={`Ir al banner ${n + 1}`}
                aria-current={n === i}
                className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-white" : "w-2 bg-white/60"}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
