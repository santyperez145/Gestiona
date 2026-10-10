// Contrato del cliente con `uso_de_nerqia` y `guardar_herramienta_reemplazada`
// (migración 20261010001800). Experimento E5 de docs/TESIS.md: mostrarle al
// comercio qué herramientas sueltas reemplaza y cuánto deja de pagar.
//
// 📌 Nunca se inventa el precio de otra herramienta: el ahorro sale sólo de lo
// que el comercio cargó. Sin montos cargados, no hay ahorro que mostrar.
import { plural } from "@/lib/plural";

export type ProductoNerqia = "commerce" | "business" | "finance" | "creators" | "profit" | "growth";

export interface ProductoCatalogo {
  id: ProductoNerqia;
  nombre: string;
  trabajo: string;
  /** Herramientas que el comercio suele usar por separado para este trabajo. */
  ejemplos: string;
}

/** Mismo orden y equivalencias que la tabla de docs/TESIS.md §1. */
export const PRODUCTOS_NERQIA: ProductoCatalogo[] = [
  { id: "commerce", nombre: "Tienda online", trabajo: "Tienda, checkout y pedidos", ejemplos: "Tiendanube, Empretienda" },
  { id: "business", nombre: "Gestión", trabajo: "Stock, caja, clientes, compras y facturación", ejemplos: "Xubio, Colppy, planillas" },
  { id: "finance", nombre: "Finanzas", trabajo: "Gastos, comprobantes y conciliación", ejemplos: "Mendel" },
  { id: "creators", nombre: "Influencers", trabajo: "Campañas, canjes y resultados", ejemplos: "GoMarz" },
  { id: "profit", nombre: "Rentabilidad", trabajo: "Margen real por producto, canal y campaña", ejemplos: "Escalafy" },
  { id: "growth", nombre: "Marketing", trabajo: "Contactos, segmentos, email y fidelidad", ejemplos: "Clientify" },
];

export interface UsoDeProducto {
  producto: ProductoNerqia;
  dias: number;
  senales: Record<string, number>;
}

export interface HerramientaReemplazada {
  producto: ProductoNerqia;
  herramienta: string | null;
  monto_mensual_ars: number;
  updated_at?: string;
}

export interface UsoDeNerqia {
  medido_at: string;
  productos: UsoDeProducto[];
  herramientas: HerramientaReemplazada[];
}

const SENALES: Record<string, [string, string?]> = {
  pedidos_online: ["pedido online"],
  ventas: ["venta"],
  facturas: ["factura"],
  compras: ["compra"],
  gastos: ["gasto"],
  comprobantes: ["comprobante"],
  campanias: ["campaña", "campañas"],
  canjes: ["canje"],
  operaciones_con_margen: ["operación con margen", "operaciones con margen"],
  campanias_email: ["campaña de email", "campañas de email"],
  contactos_nuevos: ["contacto nuevo", "contactos nuevos"],
};

/** Normaliza la respuesta de la base: cualquier número inválido cuenta como 0. */
export function normalizarUso(raw: unknown): UsoDeNerqia {
  const data = (raw ?? {}) as Partial<UsoDeNerqia>;
  const ids = new Set(PRODUCTOS_NERQIA.map(p => p.id));
  const productos = (Array.isArray(data.productos) ? data.productos : [])
    .filter(p => p && ids.has(p.producto))
    .map(p => ({
      producto: p.producto,
      dias: Number(p.dias) > 0 ? Number(p.dias) : 30,
      senales: Object.fromEntries(Object.entries(p.senales ?? {})
        .map(([k, v]) => [k, Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0])),
    }));
  const herramientas = (Array.isArray(data.herramientas) ? data.herramientas : [])
    .filter(h => h && ids.has(h.producto) && Number.isFinite(Number(h.monto_mensual_ars)))
    .map(h => ({ ...h, monto_mensual_ars: Number(h.monto_mensual_ars) }));
  return { medido_at: String(data.medido_at ?? ""), productos, herramientas };
}

export function productoEnUso(uso: UsoDeProducto | undefined): boolean {
  if (!uso) return false;
  return Object.values(uso.senales).some(v => v > 0);
}

/** «3 ventas · 1 factura en 30 días»; sin actividad, «Sin uso en 30 días». */
export function describirUso(uso: UsoDeProducto | undefined): string {
  const dias = uso?.dias ?? 30;
  if (!uso || !productoEnUso(uso)) return `Sin uso en ${plural(dias, "día")}`;
  const partes = Object.entries(uso.senales)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => {
      const [singular, formaPlural] = SENALES[k] ?? [k];
      return plural(v, singular, formaPlural);
    });
  return `${partes.join(" · ")} en ${plural(dias, "día")}`;
}

/**
 * Montos en pesos escritos por el comercio: «25.000», «25000», «25.000,50».
 * Vacío → null (borra lo cargado). Inválido o negativo → NaN.
 */
export function parsearMontoMensual(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "");
  if (limpio === "") return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpio)) return Number.NaN;
  return Number(limpio.replace(/\./g, "").replace(",", "."));
}

export interface ResumenDeAhorro {
  /** Lo que el comercio declaró pagar por mes, sumado. */
  pagaHoy: number;
  productosCargados: number;
  /** pagaHoy − precio del plan; null si no hay montos o no hay precio. */
  ahorroMensual: number | null;
}

export function resumirAhorro(
  herramientas: HerramientaReemplazada[],
  precioPlanMensual: number | null,
): ResumenDeAhorro {
  const cargadas = herramientas.filter(h => h.monto_mensual_ars > 0);
  const pagaHoy = Math.round(cargadas.reduce((s, h) => s + h.monto_mensual_ars, 0) * 100) / 100;
  return {
    pagaHoy,
    productosCargados: cargadas.length,
    ahorroMensual: cargadas.length === 0 || precioPlanMensual == null || precioPlanMensual <= 0
      ? null
      : Math.round((pagaHoy - precioPlanMensual) * 100) / 100,
  };
}
