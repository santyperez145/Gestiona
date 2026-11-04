import type { StorefrontLayout } from "@/lib/storeHomeLayout";

/**
 * Bloque «Código personalizado» de la portada.
 *
 * 2026-11-04: se veía en la portada de TODA tienda, dos veces, con el texto
 * de ayuda del editor (en tuteo, sobre pegar HTML y scripts) y una caja vacía. Era un
 * esqueleto: el layout nunca guardó contenido para este bloque, y el bloque
 * viene prendido por defecto (storeHomeLayout marca todas las secciones con
 * enabled:true). Al comprador le parecía una tienda rota o insegura.
 *
 * Regla: al comprador sólo le llega contenido que cargó el comercio. Hoy no
 * existe ese campo en HomeSection, así que el bloque no muestra nada. Cuando
 * se sume un `html` saneado al layout, se renderiza acá con el sanitizador,
 * sin título ni descripción fijos.
 */
export default function CodigoPersonalizado({ layout }: { layout: StorefrontLayout }) {
  const seccion = layout.sections.find((s) => s.id === "codigo") as
    | (StorefrontLayout["sections"][number] & { html?: unknown })
    | undefined;
  if (!seccion || !seccion.enabled) return null;
  const html = typeof seccion.html === "string" ? seccion.html.trim() : "";
  // Sin contenido cargado (siempre, hasta que exista el campo): nada.
  if (!html) return null;
  // Todavía no hay sanitizador conectado a este bloque: aunque llegara un
  // `html` crudo, no se inyecta. Mejor no mostrar que mostrar algo inseguro.
  return null;
}
