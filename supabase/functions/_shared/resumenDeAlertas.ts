// Sin dependencias a propósito: lo usa check-alerts (Deno) y lo prueba vitest.
//
// Un aviso por regla, no uno por cliente o producto (2026-10-15). Medido en
// Exentry: una sola corrida del 14/10 dejó 51 avisos sin leer, uno por cada
// cliente inactivo y por cada producto con stock bajo. Uno de esos clientes
// nunca había comprado y figuraba «inactivo». El aviso dice cuántos son, los
// primeros por importancia y adónde ir; la lista completa está en la pantalla.

export interface Resumen {
  title: string;
  message: string;
  /** Pantalla donde se resuelve. */
  url: string;
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/** «A, B, C y 4 más». */
export function primeros(nombres: string[], max = 3): string {
  const lista = nombres.filter(Boolean);
  if (lista.length <= max) {
    return lista.length <= 1 ? (lista[0] ?? "") : `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
  }
  return `${lista.slice(0, max).join(", ")} y ${lista.length - max} más`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function resumirStockBajo(
  productos: { name: string; stock: number | null; is_active?: boolean | null }[],
  umbral: number,
): Resumen | null {
  const bajos = productos
    .filter(p => p.is_active !== false && p.stock != null && Number(p.stock) <= umbral)
    .sort((a, b) => Number(a.stock) - Number(b.stock));
  if (bajos.length === 0) return null;
  const sinStock = bajos.filter(p => Number(p.stock) <= 0).length;
  return {
    title: `${plural(bajos.length, "producto", "productos")} con stock bajo`,
    message: `${primeros(bajos.map(p => `${p.name} (${Number(p.stock)})`))}.`
      + (sinStock > 0 ? ` ${plural(sinStock, "ya no tiene", "ya no tienen")} stock.` : "")
      + ` Umbral: ${umbral} unidades. Reponé desde Reposición.`,
    url: "/planificacion?vista=reposicion",
  };
}

export function resumirMargenBajo(
  productos: { name: string; sale_price_ars: number | null; profit_per_unit_ars: number | null; is_active?: boolean | null }[],
  umbralPct: number,
): Resumen | null {
  const bajos = productos
    .filter(p => p.is_active !== false && Number(p.sale_price_ars) > 0)
    .map(p => ({ name: p.name, pct: (Number(p.profit_per_unit_ars ?? 0) / Number(p.sale_price_ars)) * 100 }))
    .filter(p => p.pct < umbralPct)
    .sort((a, b) => a.pct - b.pct);
  if (bajos.length === 0) return null;
  return {
    title: `${plural(bajos.length, "producto", "productos")} con margen menor a ${umbralPct}%`,
    message: `${primeros(bajos.map(p => `${p.name} (${p.pct.toFixed(1)}%)`))}. Revisá el precio o el costo.`,
    url: "/productos",
  };
}

/**
 * Clientes que compraron alguna vez y no volvieron en `dias`. Quien nunca
 * compró no está «inactivo»: es un contacto, y avisarlo es ruido.
 */
export function resumirClientesInactivos(
  clientes: { id: string; name: string }[],
  ventas: { customer_id?: string | null; customer_name?: string | null; date: string; total_ars?: number | null }[],
  dias: number,
  ahora: Date,
): Resumen | null {
  const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
  const ultima = new Map<string, number>();
  const gastado = new Map<string, number>();
  const idPorNombre = new Map(clientes.map(c => [norm(c.name), c.id]));
  for (const v of ventas) {
    const clave = v.customer_id ?? idPorNombre.get(norm(v.customer_name));
    if (!clave) continue;
    const t = Date.parse(v.date);
    if (!Number.isNaN(t)) ultima.set(clave, Math.max(ultima.get(clave) ?? 0, t));
    gastado.set(clave, (gastado.get(clave) ?? 0) + Number(v.total_ars ?? 0));
  }
  const corte = ahora.getTime() - dias * 86_400_000;
  const inactivos = clientes
    .filter(c => ultima.has(c.id) && (ultima.get(c.id) as number) < corte)
    .sort((a, b) => (gastado.get(b.id) ?? 0) - (gastado.get(a.id) ?? 0));
  if (inactivos.length === 0) return null;
  return {
    title: `${plural(inactivos.length, "cliente no compra", "clientes no compran")} hace más de ${dias} días`,
    message: `Los que más compraban: ${primeros(inactivos.map(c => `${c.name} (${pesos(gastado.get(c.id) ?? 0)})`))}. Mandales una oferta desde Clientes.`,
    url: "/clientes",
  };
}

export function resumirDeudasVencidas(
  deudas: { customer_name: string | null; remaining_ars: number | null; due_date: string }[],
  ahora: Date,
): Resumen | null {
  if (deudas.length === 0) return null;
  const orden = [...deudas].sort((a, b) => Number(b.remaining_ars) - Number(a.remaining_ars));
  const total = deudas.reduce((s, d) => s + Number(d.remaining_ars ?? 0), 0);
  const masVieja = Math.max(...deudas.map(d => Math.floor((ahora.getTime() - Date.parse(`${d.due_date}T12:00:00-03:00`)) / 86_400_000)));
  return {
    title: `${plural(deudas.length, "deuda vencida", "deudas vencidas")} por ${pesos(total)}`,
    message: `${primeros(orden.map(d => `${d.customer_name || "Sin nombre"} (${pesos(Number(d.remaining_ars ?? 0))})`))}. La más vieja venció hace ${plural(masVieja, "día", "días")}.`,
    url: "/deudas",
  };
}

export function resumirVencimientos(
  productos: { name: string; expiry_date: string; stock: number | null }[],
  hoy: string,
): Resumen | null {
  if (productos.length === 0) return null;
  const vencidos = productos.filter(p => p.expiry_date < hoy);
  const porVencer = productos.filter(p => p.expiry_date >= hoy).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  const partes: string[] = [];
  if (vencidos.length) partes.push(`Vencidos: ${primeros(vencidos.map(p => `${p.name} (${Number(p.stock)} u.)`))}.`);
  if (porVencer.length) partes.push(`Por vencer: ${primeros(porVencer.map(p => `${p.name} (${p.expiry_date.split("-").reverse().join("/")})`))}.`);
  return {
    title: vencidos.length
      ? `${plural(vencidos.length, "producto vencido", "productos vencidos")}${porVencer.length ? ` y ${porVencer.length} por vencer` : ""}`
      : `${plural(porVencer.length, "producto por vencer", "productos por vencer")}`,
    message: partes.join(" "),
    url: "/productos?vencimientos=1",
  };
}
