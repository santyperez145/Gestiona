import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DASH = readFileSync(resolve(ROOT, "src/pages/Dashboard.tsx"), "utf8");
const HEALTH = readFileSync(resolve(ROOT, "src/components/dashboard/DashboardHealthSection.tsx"), "utf8");

/** Sólo el código: los comentarios nombran los antipatrones para explicarlos. */
const CODIGO = DASH.split(/\r?\n/)
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");
const CODIGO_HEALTH = HEALTH.split(/\r?\n/)
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

/**
 * Dos números equivocados en la primera pantalla del comercio.
 *
 * Encontrados leyendo el panel en producción con la sesión del dueño el
 * 2026-08-26, no por un test.
 *
 * ── 1. El semáforo mostraba el texto opuesto al color ─────────────────────
 *
 * `sigLabel(score, labels)` indexaba `labels[2 - score]`, y los arreglos se
 * escriben `[rojo, amarillo, verde]`. Con puntaje rojo mostraba el texto verde:
 *
 *   18 productos agotados   →  «Sin agotados ✓»
 *   42 productos parados    →  «Todos rotando ✓»
 *   0% de margen            →  «0.0% ✓»
 *
 * El punto quedaba del color correcto —rojo— porque el color usa `score` y no
 * el índice. Eso es justamente lo que lo volvía difícil de ver: un punto rojo
 * al lado de un texto que dice que está todo bien.
 *
 * ── 2. Un conteo de productos viajaba como deudas ─────────────────────────
 *
 * `deudasVencidas30={stats.agingCount30}`: `agingCount30` cuenta PRODUCTOS con
 * stock y sin ventas en 30 días. El panel decía **«42 deudas vencidas hace más
 * de 30 días · Cobrar»** y llevaba a `/deudas`.
 *
 * Medido contra la base el mismo día: **0 deudas vencidas, 0 pendientes** (las
 * 3 que existen están pagas) y **42 productos con stock sin movimiento**. El 42
 * era exactamente el conteo de productos. Mandaba al comercio a cobrar plata
 * que nadie debe, mientras la pantalla de Clientes decía «Sin deudas ✓».
 */
describe("el semáforo dice lo que el color dice", () => {
  it("traduce el puntaje sin invertirlo", () => {
    expect(CODIGO_HEALTH).toContain('score === 2 ? "healthy"');
    expect(CODIGO_HEALTH).toContain('score === 1 ? "attention" : "critical"');
  });

  it("no declara saludable al stock cuando hay agotados", () => {
    expect(CODIGO_HEALTH).toContain('outOfStock === 0 ? "Sin productos agotados"');
    expect(CODIGO_HEALTH).toContain('score: outOfStock === 0 ? 2 : outOfStock <= 3 ? 1 : 0');
  });

  it("el color y el texto salen del mismo puntaje", () => {
    expect(CODIGO_HEALTH).toContain("const style = LEVEL_STYLES[overall]");
    expect(CODIGO_HEALTH).toContain("{style.label}");
  });
});

describe("las deudas vencidas son deudas", () => {
  it("el foco del día recibe el conteo de deudas, no de productos", () => {
    expect(CODIGO).toContain("deudasVencidas30={stats.overdueDebts30}");
    expect(CODIGO).not.toContain("deudasVencidas30={stats.agingCount30}");
  });

  it("ese conteo mira la fecha de vencimiento y el estado", () => {
    // Una deuda paga no está vencida, y una sin `due_date` no se puede vencer.
    expect(CODIGO).toContain("d.status !== 'paid' && d.due_date");
  });

  it("y son las de más de 30 días, como dice el texto", () => {
    // El pendiente afirma «hace más de 30 días». Contar cualquier vencida haría
    // que el número no corresponda a la frase.
    expect(CODIGO).toContain("treintaDiasAtras");
    expect(CODIGO).toMatch(/new Date\(d\.due_date\) < treintaDiasAtras/);
  });

  it("el conteo de productos parados sigue existiendo, con su nombre", () => {
    // No se borró: es un dato útil, sólo que no es una deuda.
    expect(CODIGO).toContain("const agingCount30 =");
  });
});
