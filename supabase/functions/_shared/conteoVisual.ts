/** Validación de la entrada y la salida del conteo visual (conteo-visual). */

/** Límites de la entrada: una foto de hasta ~3 MB y 80 candidatos. */
export const MAX_IMAGEN_BASE64 = 4_000_000;
export const MAX_CANDIDATOS = 80;
export const MAX_UNIDADES = 300;
export const LADO_MAXIMO = 2576;

export type Candidato = { id: string; nombre: string; imagen?: string };
export type Punto = { x: number; y: number };

/** Cuántas fotos de catálogo van como referencia (cada una suma tokens). */
export const MAX_REFERENCIAS = 6;

/**
 * Una foto de catálogo sólo vale si está en NUESTRO storage público: la URL
 * la manda el navegador y no se le pasa a la IA cualquier dirección.
 */
export function imagenDeReferenciaValida(url: unknown, supabaseUrl: string): string | null {
  if (typeof url !== "string" || url.length > 1000) return null;
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const publica = u.pathname.startsWith("/storage/v1/object/public/") || u.pathname.startsWith("/storage/v1/render/image/public/");
    if (u.host !== base.host || !publica) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function candidatosValidos(entrada: unknown, supabaseUrl = ""): Candidato[] {
  if (!Array.isArray(entrada)) return [];
  const vistos = new Set<string>();
  const salida: Candidato[] = [];
  for (const c of entrada.slice(0, MAX_CANDIDATOS)) {
    const id = typeof c?.id === "string" ? c.id.trim() : "";
    const nombre = typeof c?.nombre === "string" ? c.nombre.trim().slice(0, 120) : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !nombre || vistos.has(id)) continue;
    vistos.add(id);
    const imagen = supabaseUrl ? imagenDeReferenciaValida(c?.imagen, supabaseUrl) : null;
    salida.push(imagen ? { id, nombre, imagen } : { id, nombre });
  }
  return salida;
}

/** Sólo puntos dentro de la imagen, enteros y sin repetir; a lo sumo MAX_UNIDADES. */
export function puntosValidos(entrada: unknown, ancho: number, alto: number): Punto[] {
  if (!Array.isArray(entrada)) return [];
  const vistos = new Set<string>();
  const salida: Punto[] = [];
  for (const p of entrada) {
    const x = Math.round(Number(p?.x));
    const y = Math.round(Number(p?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > ancho || y > alto) continue;
    const clave = `${x},${y}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ x, y });
    if (salida.length >= MAX_UNIDADES) break;
  }
  return salida;
}
