/**
 * Detección de productos duplicados del catálogo.
 *
 * Dos productos activos son el mismo si comparten un código (SKU, código de
 * barras o alternativo, sin distinguir mayúsculas) o el mismo nombre y marca
 * ignorando tildes, espacios y signos ("Tornillo 6 mm" = "tornillo 6mm").
 * Union-find lineal: 11.000 productos se agrupan en milisegundos.
 * La unificación la hace `unificar_productos` en la base.
 */
import { normalizeText } from "@/lib/searchText";

export type ProductoComparable = {
  id: string;
  name: string;
  brand?: string | null;
  sku?: string | null;
  barcode?: string | null;
  barcode_aliases?: string[] | null;
  stock?: number | null;
  total_sold?: number | null;
  created_at?: string | null;
  is_active?: boolean | null;
};

export type GrupoDuplicado<T extends ProductoComparable> = {
  motivo: "codigo" | "nombre";
  productos: T[];
  /** Id sugerido para conservar: más vendido, luego más stock, luego el más antiguo. */
  sugerido: string;
};

const codigo = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
export const claveNombre = (p: Pick<ProductoComparable, "name" | "brand">) =>
  `${normalizeText(p.brand ?? "").replace(/[^a-z0-9]/g, "")}|${normalizeText(p.name).replace(/[^a-z0-9]/g, "")}`;

export function detectarDuplicados<T extends ProductoComparable>(productos: T[]): GrupoDuplicado<T>[] {
  const activos = productos.filter(p => p.is_active !== false);
  const padre = activos.map((_, i) => i);
  const raiz = (i: number): number => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  const unir = (a: number, b: number) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) padre[rb] = ra; };
  const porCodigo = new Map<string, number>();
  const porNombre = new Map<string, number>();
  const porCodigoUnido = new Set<number>();

  activos.forEach((p, i) => {
    const codigos = new Set([p.sku, p.barcode, ...(p.barcode_aliases ?? [])].map(codigo).filter(Boolean));
    for (const c of codigos) {
      const previo = porCodigo.get(c);
      if (previo === undefined) porCodigo.set(c, i);
      else { unir(previo, i); porCodigoUnido.add(i); porCodigoUnido.add(previo); }
    }
    const nombre = claveNombre(p);
    if (nombre.split("|")[1]) {
      const previo = porNombre.get(nombre);
      if (previo === undefined) porNombre.set(nombre, i); else unir(previo, i);
    }
  });

  const grupos = new Map<number, number[]>();
  activos.forEach((_, i) => { const r = raiz(i); (grupos.get(r) ?? grupos.set(r, []).get(r)!).push(i); });

  return [...grupos.values()]
    .filter(indices => indices.length > 1)
    .map(indices => {
      const miembros = indices.map(i => activos[i]);
      const sugerido = [...miembros].sort((a, b) =>
        (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0)
        || (Number(b.stock) || 0) - (Number(a.stock) || 0)
        || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0].id;
      return {
        motivo: indices.some(i => porCodigoUnido.has(i)) ? "codigo" as const : "nombre" as const,
        productos: miembros,
        sugerido,
      };
    })
    .sort((a, b) => b.productos.length - a.productos.length || a.productos[0].name.localeCompare(b.productos[0].name, "es"));
}
