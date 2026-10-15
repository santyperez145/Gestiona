import { diaDeCompra } from "@/lib/comprasDeCliente";
import { hoyAR, mesAR } from "@/lib/fechaAR";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export type Venta = {
  id: string; date: string; total_ars: number | string; profit_ars?: number | string | null;
  customer_id?: string | null; customer_name?: string | null; product_name?: string | null;
  product_id?: string | null; sale_transaction_id?: string | null;
};

export function sumarMeses(ym: string, n: number): string {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function diasAtras(n: number): string[] {
  const hoy = hoyAR();
  const base = new Date(`${hoy}T12:00:00`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (n - 1 - i));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

/** Retención por mes de primera compra: qué parte de esos clientes volvió N meses después. */
export function cohortesDeClientes(ventas: Venta[], hasta: string = mesAR(), cantidad = 6) {
  const clave = (v: Venta) => v.customer_id ?? (v.customer_name?.trim().toLowerCase() || null);
  const meses = new Map<string, Set<string>>();
  for (const v of ventas) {
    const c = clave(v);
    if (!c) continue;
    const ym = diaDeCompra(v.date).slice(0, 7);
    if (!ym) continue;
    (meses.get(c) ?? meses.set(c, new Set()).get(c)!).add(ym);
  }
  const primera = new Map<string, string>();
  for (const [c, set] of meses) primera.set(c, [...set].sort()[0]);
  const cohortes = [...new Set(primera.values())].sort().slice(-cantidad);
  return cohortes.map(ym => {
    const clientes = [...primera].filter(([, p]) => p === ym).map(([c]) => c);
    const retencion = Array.from({ length: 6 }, (_, k) => {
      const objetivo = sumarMeses(ym, k);
      if (objetivo > hasta) return null;
      if (k === 0) return 100;
      const volvieron = clientes.filter(c => meses.get(c)!.has(objetivo)).length;
      return Math.round((volvieron / clientes.length) * 100);
    });
    const [a, m] = ym.split("-").map(Number);
    return { mes: `${MESES[m - 1]} ${a}`, clientes: clientes.length, retencion };
  });
}

