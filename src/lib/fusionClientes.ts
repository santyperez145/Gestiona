import { plural } from "@/lib/plural";

/** «2 ventas, 1 deuda y 3 registros más pasaron al cliente». */
export function resumenDeFusion(movidas: Record<string, number>): string | undefined {
  const ventas = movidas.sales ?? 0;
  const deudas = movidas.debts ?? 0;
  const resto = Object.entries(movidas).reduce((s, [t, n]) => (t === "sales" || t === "debts" ? s : s + n), 0);
  const partes = [
    ventas ? plural(ventas, "venta", "ventas") : "",
    deudas ? plural(deudas, "deuda", "deudas") : "",
    resto ? (ventas + deudas ? plural(resto, "registro más", "registros más") : plural(resto, "registro", "registros")) : "",
  ].filter(Boolean);
  if (partes.length === 0) return undefined;
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}` : partes[0];
  const uno = partes.length === 1 && ventas + deudas + resto === 1;
  return `${lista} ${uno ? "pasó" : "pasaron"} al cliente.`;
}
