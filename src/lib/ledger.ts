/**
 * Ledger — las reglas de partida doble, del lado del cliente.
 *
 * El libro lo escribe la base: `ledger_asentar` es la única puerta de entrada y
 * el cuadre lo verifica Postgres. Lo que vive acá es lo que el panel necesita
 * para **armar y mostrar** un asiento sin volver a inventar las reglas, y para
 * avisarle a quien lo está cargando que no cuadra **antes** de mandarlo — que
 * es la diferencia entre corregir un número y perder el formulario entero.
 *
 * ── El signo natural, que es lo que más confunde ──────────────────────────
 *
 * Un activo y un gasto crecen por el **debe**. Un pasivo, el patrimonio y un
 * ingreso crecen por el **haber**. Si se resta siempre igual, las ventas
 * aparecen en negativo y el tablero deja de creerse. Por eso el signo sale del
 * tipo de cuenta y no de una convención escrita en cada pantalla.
 *
 * Espejo de `public.ledger_saldo` y de la vista `ledger_saldos`.
 */

export type TipoCuenta = "activo" | "pasivo" | "patrimonio" | "ingreso" | "gasto";

export interface CuentaLedger {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  imputable?: boolean;
  is_active?: boolean;
}

export interface PartidaLedger {
  cuenta: string;
  debe?: number;
  haber?: number;
  detalle?: string;
}

/** Metadatos de cada tipo, para no repetir la regla en cada pantalla. */
export const TIPOS_CUENTA: Record<TipoCuenta, {
  label: string;
  /** Por qué lado crece el saldo. */
  crecePor: "debe" | "haber";
  /** Dónde se muestra: las tres primeras arman el balance, las otras el resultado. */
  estado: "balance" | "resultado";
}> = {
  activo:     { label: "Activo",         crecePor: "debe",  estado: "balance" },
  pasivo:     { label: "Pasivo",         crecePor: "haber", estado: "balance" },
  patrimonio: { label: "Patrimonio neto",crecePor: "haber", estado: "balance" },
  ingreso:    { label: "Ingresos",       crecePor: "haber", estado: "resultado" },
  gasto:      { label: "Gastos",         crecePor: "debe",  estado: "resultado" },
};

/**
 * El saldo de una cuenta con su signo natural.
 *
 * Un activo con $12.100 de debe da 12.100. Un ingreso con $10.000 de haber
 * también da 10.000 — y no −10.000, que es lo que saldría si se restara
 * siempre en el mismo orden.
 */
export function saldoNatural(tipo: TipoCuenta, debe: number, haber: number): number {
  const d = Number(debe) || 0;
  const h = Number(haber) || 0;
  return TIPOS_CUENTA[tipo]?.crecePor === "debe" ? d - h : h - d;
}

const centavos = (n: number) => Math.round((Number(n) || 0) * 100);

export interface CuadreAsiento {
  cuadra: boolean;
  totalDebe: number;
  totalHaber: number;
  /** Debe − haber. Cero cuando cuadra; sirve para decir cuánto falta. */
  diferencia: number;
  /** Qué está mal, si algo lo está. */
  problema?: "sin_partidas" | "partida_ambigua" | "partida_vacia" | "no_cuadra";
}

/**
 * ¿Este asiento cuadra?
 *
 * ⚠️ La comparación se hace en **centavos enteros**, no en pesos. Sumar
 * `0.1 + 0.2` en punto flotante da `0.30000000000000004`, y un asiento que
 * cuadra perfecto quedaría rechazado por un error de representación que no
 * existe en la base —donde la columna es `numeric`—. El cliente diría "no
 * cuadra" y el servidor lo aceptaría: dos verdades distintas sobre lo mismo.
 */
export function verificarCuadre(partidas: PartidaLedger[] | null | undefined): CuadreAsiento {
  const lineas = (partidas ?? []).filter(p => p && p.cuenta);

  const conImporte = lineas.filter(p => (Number(p.debe) || 0) > 0 || (Number(p.haber) || 0) > 0);
  if (conImporte.length === 0) {
    return { cuadra: false, totalDebe: 0, totalHaber: 0, diferencia: 0, problema: "sin_partidas" };
  }

  // Una partida con debe y haber a la vez se cancela sola y no significa nada.
  const ambigua = conImporte.some(p => (Number(p.debe) || 0) > 0 && (Number(p.haber) || 0) > 0);

  let debe = 0;
  let haber = 0;
  for (const p of conImporte) {
    debe += centavos(p.debe ?? 0);
    haber += centavos(p.haber ?? 0);
  }

  const dif = debe - haber;
  const salida: CuadreAsiento = {
    cuadra: dif === 0 && !ambigua && conImporte.length >= 2,
    totalDebe: debe / 100,
    totalHaber: haber / 100,
    diferencia: dif / 100,
  };

  if (ambigua) salida.problema = "partida_ambigua";
  else if (conImporte.length < 2) salida.problema = "sin_partidas";
  else if (dif !== 0) salida.problema = "no_cuadra";

  return salida;
}

/** Qué se le dice a quien está cargando el asiento. Sin jerga contable. */
export function mensajeDeCuadre(
  c: CuadreAsiento,
  fmt: (n: number) => string = n => `$${n.toLocaleString("es-AR")}`,
): string | null {
  if (c.cuadra) return null;
  switch (c.problema) {
    case "sin_partidas":
      return "Un asiento necesita al menos dos partidas";
    case "partida_ambigua":
      return "Una partida va en el debe o en el haber, nunca en los dos";
    case "no_cuadra":
      return c.diferencia > 0
        ? `Faltan ${fmt(Math.abs(c.diferencia))} en el haber`
        : `Faltan ${fmt(Math.abs(c.diferencia))} en el debe`;
    default:
      return "El asiento no se puede registrar";
  }
}

/** Sólo las hojas activas reciben partidas. Espejo del trigger de la base. */
export function cuentaAceptaPartidas(c: CuentaLedger | null | undefined): boolean {
  if (!c) return false;
  return c.imputable !== false && c.is_active !== false;
}

/**
 * Ordena el plan de cuentas por código jerárquico.
 *
 * ⚠️ No alcanza con ordenar como texto: `'1.10'` va después de `'1.9'` en
 * orden alfabético, y antes en orden contable. Se compara tramo por tramo como
 * número, que es como lo lee una persona.
 */
export function compararCodigos(a: string, b: string): number {
  const pa = String(a ?? "").split(".");
  const pb = String(b ?? "").split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? -1);
    const nb = Number(pb[i] ?? -1);
    if (na !== nb) return na - nb;
  }
  return 0;
}

export interface SaldoCuenta {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  saldo: number;
}

export interface ResumenLedger {
  activo: number;
  pasivo: number;
  patrimonio: number;
  ingresos: number;
  gastos: number;
  /** Ingresos − gastos. Lo que el comercio ganó en el período. */
  resultado: number;
}

/**
 * Los totales que se muestran arriba de todo.
 *
 * El resultado es ingresos menos gastos y no "lo que hay en la caja": una venta
 * cobrada por MercadoPago que todavía no se acreditó ya es un ingreso, y la
 * plata no está. Confundir las dos cosas es lo que hace que un comercio crea
 * que le fue mal en un mes que le fue bien.
 */
export function resumir(saldos: SaldoCuenta[] | null | undefined): ResumenLedger {
  const total = (t: TipoCuenta) => (saldos ?? [])
    .filter(s => s.tipo === t)
    .reduce((acc, s) => acc + (Number(s.saldo) || 0), 0);

  const ingresos = total("ingreso");
  const gastos = total("gasto");

  return {
    activo: total("activo"),
    pasivo: total("pasivo"),
    patrimonio: total("patrimonio"),
    ingresos,
    gastos,
    resultado: Math.round((ingresos - gastos) * 100) / 100,
  };
}
