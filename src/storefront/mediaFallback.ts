import type { SyntheticEvent } from "react";

/**
 * Un activo público puede desaparecer después de publicado: una URL heredada
 * puede apuntar a una página HTML, vencer o ser retirada por su dueño. El
 * navegador muestra un ícono de archivo roto por defecto, que degrada la
 * confianza y además tapa el fallback que cada superficie deja debajo.
 */
export function ocultarImagenRota(event: SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  image.hidden = true;
  image.setAttribute("data-media-state", "error");
}

/**
 * La misma etiqueta puede volver a cargar al cambiar de banner, miniatura o
 * fuente responsive. Restituirla en `load` evita que un fallo anterior deje
 * oculto un activo que sí se recuperó.
 */
export function mostrarImagenValida(event: SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  image.hidden = false;
  image.setAttribute("data-media-state", "ready");
}

/**
 * Tamaños intrínsecos de la vitrina. El CSS recorta con `object-cover` y
 * `aspect-*`; el `width`/`height` le dice al navegador la proporción antes de
 * que el archivo llegue, que es lo que evita el salto de layout.
 *
 * No son recortes reales ni un CDN: la tienda sigue sirviendo la URL que
 * cargó el comercio. Declarar 800×800 en una tarjeta de 50 vw no descarga
 * 800 px; sólo reserva el hueco.
 */
export const TAMANO_IMAGEN_VITRINA = {
  tarjeta: {
    width: 800,
    height: 800,
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  },
  banner: {
    width: 1600,
    height: 700,
    sizes: "100vw",
  },
  ficha: {
    width: 1200,
    height: 1200,
    sizes: "(max-width: 768px) 100vw, 50vw",
  },
  categoria: {
    width: 800,
    height: 600,
    sizes: "(max-width: 640px) 50vw, 25vw",
  },
  miniatura: {
    width: 128,
    height: 128,
    sizes: "64px",
  },
  logo: {
    width: 64,
    height: 64,
    sizes: "32px",
  },
} as const;

export type TamanoImagenVitrina = keyof typeof TAMANO_IMAGEN_VITRINA;

/**
 * Atributos de imagen para la vitrina.
 *
 * Sólo el LCP (banner de home o foto principal de la ficha) pide `eager` y
 * `high`. El resto queda `lazy` + `auto`: marcar `low` en toda la grilla
 * retrasa las fotos que el comprador ya está mirando.
 */
export function atributosDeImagenVitrina(
  tamano: TamanoImagenVitrina,
  opciones?: { lcp?: boolean },
): {
  width: number;
  height: number;
  sizes: string;
  decoding: "async";
  loading: "eager" | "lazy";
  /**
   * React 18 no mapea `fetchPriority` al DOM: lo avisa y lo descarta. El
   * atributo HTML es `fetchpriority` y así llega al navegador.
   */
  fetchpriority: "high" | "auto";
} {
  const t = TAMANO_IMAGEN_VITRINA[tamano];
  const lcp = opciones?.lcp === true;
  return {
    width: t.width,
    height: t.height,
    sizes: t.sizes,
    decoding: "async",
    loading: lcp ? "eager" : "lazy",
    fetchpriority: lcp ? "high" : "auto",
  };
}
