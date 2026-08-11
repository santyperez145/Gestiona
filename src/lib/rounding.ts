/**
 * A9 — la política de redondeo, declarada en un solo lugar.
 *
 * ── Por qué hacía falta ───────────────────────────────────────────────────
 *
 * Había `Math.round(x * 100) / 100` repartido por el cliente y `round(x, 2)`
 * por la base. Mientras la única moneda sea el peso funciona de casualidad:
 * dos decimales es lo correcto para ARS. El día que la tienda cotice en otra
 * moneda ese `2` pasa a estar mal en la mitad de los casos — el peso chileno y
 * el guaraní no tienen centavos, y "1.234,56 CLP" no es un detalle estético:
 * es un importe que no existe.
 *
 * B6 (multi-moneda) depende de esto.
 *
 * ── Lo que se declara ────────────────────────────────────────────────────
 *
 * **Los decimales los define la moneda.** Agregar una es editar esta lista, no
 * buscar los `round(x, 2)` del sistema.
 *
 * **Media unidad hacia arriba**, y por eso no se usa `Math.round` a secas:
 * `Math.round(-0.5)` da `-0`, es decir redondea hacia el infinito positivo, y
 * un reintegro de -0,005 terminaría en 0,00 en vez de -0,01. Acá el signo se
 * separa del valor para que se redondee igual de los dos lados del cero.
 *
 * **Una moneda desconocida cae en 2, no rompe.** Un carrito no se puede caer
 * porque alguien escribió mal un código de moneda.
 *
 * ⚠️ Espejo exacto de `public.redondear_moneda`, `public.decimales_de_moneda`
 * y `public.prorratear` (`20260811000001_redondeo_declarado.sql`). Si se toca
 * una, se toca la otra: el servidor es la autoridad y el cliente sólo tiene
 * que mostrar lo mismo que se va a cobrar.
 */

/** Monedas sin subdivisión en uso: un importe con centavos no existe. */
const SIN_CENTAVOS = new Set(["CLP", "PYG", "JPY", "KRW", "COP", "ISK", "VND"]);

export function decimalesDeMoneda(moneda?: string | null): number {
  const c = (moneda ?? "ARS").trim().toUpperCase();
  return SIN_CENTAVOS.has(c) ? 0 : 2;
}

/**
 * Redondea con los decimales de la moneda, media unidad hacia arriba en valor
 * absoluto.
 *
 * El `Number(...)` sobre la notación exponencial no es decoración: hace el
 * corrimiento de coma en la representación decimal en vez de multiplicar por
 * 100, que es lo que produce el clásico `1.005 * 100 = 100.49999999999999` y
 * termina redondeando para el lado equivocado.
 */
export function redondearMoneda(importe: number, moneda?: string | null): number {
  if (!Number.isFinite(importe)) return 0;
  const d = decimalesDeMoneda(moneda);
  const signo = importe < 0 ? -1 : 1;
  const abs = Math.abs(importe);
  const corrido = Number(`${abs}e${d}`);
  const r = Math.round(Number.isFinite(corrido) ? corrido : abs * 10 ** d);
  const salida = Number(`${r}e-${d}`);
  // `-0` es un número molesto: se imprime "-0" y no es igual a nada esperado.
  return salida === 0 ? 0 : signo * salida;
}

/**
 * Reparte un total en partes proporcionales cuya suma es **exactamente** el
 * total.
 *
 * Prorratear y redondear cada parte por separado casi nunca cierra: tres partes
 * iguales de $100 dan $33,33 y falta un centavo. La regla declarada es que **el
 * resto va a la última parte**. Cuál parte se lo lleva es arbitrario; que la
 * suma cierre, no — es la diferencia entre que una factura cuadre y que no.
 */
export function prorratear(
  total: number,
  pesos: number[],
  moneda?: string | null,
): number[] {
  const n = pesos.length;
  if (n === 0) return [];

  const positivos = pesos.map(p => (Number.isFinite(p) && p > 0 ? p : 0));
  const suma = positivos.reduce((a, b) => a + b, 0);
  const objetivo = redondearMoneda(total, moneda);

  const salida: number[] = [];
  let acum = 0;

  for (let i = 0; i < n; i++) {
    let parte: number;
    if (i === n - 1) {
      // La última absorbe el resto para que la suma cierre.
      parte = redondearMoneda(objetivo - acum, moneda);
    } else if (suma <= 0) {
      // Sin pesos positivos se reparte en partes iguales: devolver ceros
      // escondería el importe en vez de distribuirlo.
      parte = redondearMoneda(total / n, moneda);
    } else {
      parte = redondearMoneda((total * positivos[i]) / suma, moneda);
    }
    salida.push(parte);
    acum += parte;
  }

  return salida;
}

/**
 * ¿La suma de las partes da el total? Se exporta porque es la propiedad que
 * hace confiable a `prorratear`, y conviene poder afirmarla donde se use.
 */
export function sumaCierra(partes: number[], total: number, moneda?: string | null): boolean {
  const s = partes.reduce((a, b) => a + b, 0);
  return redondearMoneda(s, moneda) === redondearMoneda(total, moneda);
}
