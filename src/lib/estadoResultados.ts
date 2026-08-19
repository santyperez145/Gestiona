/**
 * I1 — lectura del estado de resultados que devuelve `ledger_resultado`.
 *
 * ── Por qué estas funciones existen y no se calcula en el componente ─────
 *
 * Es la regla del repo para plata: los cálculos van a funciones puras
 * testeadas, nunca inline. Acá además hay un motivo específico — **el margen
 * porcentual tiene tres formas de salir mal** y las tres son fáciles de
 * escribir sin querer:
 *
 *   1. dividir por cero cuando no hubo ventas;
 *   2. dividir el margen por el costo en vez de por las ventas;
 *   3. mostrar un porcentaje cuando el número de abajo no es confiable.
 *
 * El servidor es la autoridad de los importes: acá no se recalcula ninguno, se
 * derivan sólo las razones y se decide qué se puede afirmar.
 */
import { redondearMoneda } from "./rounding";

export interface Resultado {
  desde: string;
  hasta: string;
  ventas: number;
  fletes_cobrados: number;
  ingresos: number;
  costo_mercaderia: number;
  margen_bruto: number;
  comision_medios_pago: number;
  comision_plataforma: number;
  fletes_pagados: number;
  otros_gastos: number;
  gastos_operativos: number;
  resultado: number;
  asientos: number;
  ventas_sin_costo: number;
}

/** Un resultado en cero, para que la pantalla nunca lea de `undefined`. */
export const RESULTADO_VACIO: Resultado = {
  desde: "", hasta: "", ventas: 0, fletes_cobrados: 0, ingresos: 0,
  costo_mercaderia: 0, margen_bruto: 0, comision_medios_pago: 0,
  comision_plataforma: 0, fletes_pagados: 0, otros_gastos: 0,
  gastos_operativos: 0, resultado: 0, asientos: 0, ventas_sin_costo: 0,
};

/**
 * Margen bruto en porcentaje sobre las ventas.
 *
 * Devuelve `null` y no `0` cuando no hay ventas: son cosas distintas. Un 0%
 * dice "vendiste y no ganaste nada"; un `null` dice "no vendiste". Mostrar el
 * primero cuando pasó el segundo es la clase de número que hace que alguien
 * tome una decisión sobre un dato que no existe.
 */
export function margenPorcentual(r: Resultado): number | null {
  if (!Number.isFinite(r.ventas) || r.ventas <= 0) return null;
  return redondearMoneda((r.margen_bruto / r.ventas) * 100);
}

/** Lo mismo para el resultado final sobre los ingresos totales. */
export function resultadoPorcentual(r: Resultado): number | null {
  if (!Number.isFinite(r.ingresos) || r.ingresos <= 0) return null;
  return redondearMoneda((r.resultado / r.ingresos) * 100);
}

/**
 * ¿Se puede confiar en el margen que se va a mostrar?
 *
 * Es la función que hace honesto todo el tablero. Si hay ventas asentadas sin
 * costo, el margen bruto sale **mejor de lo que la realidad es**, y mostrarlo
 * como si nada sería exactamente el problema que H7 vino a arreglar, movido de
 * la base a la pantalla.
 */
export interface ConfianzaMargen {
  confiable: boolean;
  /** Cuántas ventas del período se asentaron sin costo. */
  sinCosto: number;
  /** Qué proporción del total representan, de 0 a 1. */
  proporcion: number;
  aviso?: string;
}

export function confianzaDelMargen(r: Resultado): ConfianzaMargen {
  const sinCosto = Math.max(0, r.ventas_sin_costo ?? 0);
  const total = Math.max(0, r.asientos ?? 0);

  if (sinCosto === 0) return { confiable: true, sinCosto: 0, proporcion: 0 };

  // Si no sabemos contra cuántos asientos comparar, la proporción no se puede
  // afirmar — pero el aviso sí, porque lo que importa es que hay ventas sin
  // costo, no cuántas exactamente.
  const proporcion = total > 0 ? Math.min(1, sinCosto / total) : 1;

  return {
    confiable: false,
    sinCosto,
    proporcion,
    aviso:
      sinCosto === 1
        ? "Una venta del período se asentó sin costo de mercadería, así que el margen real es menor al que ves."
        : `${sinCosto} ventas del período se asentaron sin costo de mercadería, así que el margen real es menor al que ves.`,
  };
}

/**
 * Las filas del estado de resultados, en el orden en que se leen.
 *
 * El orden no es estético: margen bruto va **antes** que los gastos operativos
 * porque es la pregunta que responde si el negocio funciona. Un P&L que muestra
 * primero las comisiones invita a optimizar lo que menos mueve la aguja.
 */
export interface FilaResultado {
  clave: string;
  etiqueta: string;
  monto: number;
  /** `subtotal` se destaca; `resta` se muestra en negativo. */
  tipo: "ingreso" | "resta" | "subtotal" | "total";
  sangria?: boolean;
}

export function filasDelResultado(r: Resultado): FilaResultado[] {
  const filas: FilaResultado[] = [
    { clave: "ventas", etiqueta: "Ventas (neto de IVA)", monto: r.ventas, tipo: "ingreso" },
  ];

  // El flete cobrado sólo aparece si existe: una línea en cero por si acaso es
  // ruido que hace más difícil leer las que sí tienen número.
  if (r.fletes_cobrados > 0) {
    filas.push({
      clave: "fletes_cobrados", etiqueta: "Fletes cobrados",
      monto: r.fletes_cobrados, tipo: "ingreso",
    });
  }

  filas.push(
    { clave: "costo", etiqueta: "Costo de la mercadería vendida", monto: r.costo_mercaderia, tipo: "resta" },
    { clave: "margen", etiqueta: "Margen bruto", monto: r.margen_bruto, tipo: "subtotal" },
  );

  const gastos: Array<[string, string, number]> = [
    ["comision_mp", "Comisiones de medios de pago", r.comision_medios_pago],
    ["comision_plat", "Comisión de plataforma", r.comision_plataforma],
    ["fletes_pagados", "Fletes pagados", r.fletes_pagados],
    ["otros", "Otros gastos", r.otros_gastos],
  ];
  for (const [clave, etiqueta, monto] of gastos) {
    if (monto > 0) filas.push({ clave, etiqueta, monto, tipo: "resta", sangria: true });
  }

  filas.push({ clave: "resultado", etiqueta: "Resultado del período", monto: r.resultado, tipo: "total" });
  return filas;
}

/** Rango de fechas de un preset, en el formato que espera el RPC. */
export function rangoDelPreset(preset: "mes" | "mes_anterior" | "30dias" | "anio"): {
  desde: string; hasta: string;
} {
  const hoy = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "mes_anterior": {
      const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      // Día 0 del mes actual es el último del anterior — evita la lista de
      // cuántos días tiene cada mes y el caso bisiesto.
      const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde: iso(desde), hasta: iso(hasta) };
    }
    case "30dias": {
      const desde = new Date(hoy);
      desde.setDate(desde.getDate() - 29);
      return { desde: iso(desde), hasta: iso(hoy) };
    }
    case "anio":
      return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta: iso(hoy) };
    case "mes":
    default:
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) };
  }
}
