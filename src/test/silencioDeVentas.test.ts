import { describe, it, expect } from "vitest";
import {
  construirPendientes, umbralDeSilencio, ritmoHabitual, type DatosFoco,
} from "@/lib/dashboardFocus";

const VACIO: DatosFoco = {
  sinStock: 0, stockBajo: 0, deudasPendientes: 0, deudaTotalARS: 0,
  deudasVencidas30: 0, seguimientosHoy: 0, pedidosPorDespachar: 0,
};

/**
 * Los huecos entre ventas del comercio real, **leídos de la base** el
 * 2026-08-26 (17 días con venta, 16 intervalos). No es un ejemplo inventado:
 * con estos números el umbral da 15 y el ritmo da 2.
 *
 * El bache de 61 es junio entero.
 */
const HUECOS_REALES = [1, 1, 1, 1, 1, 4, 15, 2, 1, 2, 4, 5, 12, 2, 3, 61];

/**
 * El comercio no se enteraba de que dejó de vender.
 *
 * Medido el 2026-08-26 sobre la única organización operando: 17 ventas por
 * $616.784 en abril, 15 por $526.910 en mayo, **nada en junio**, dos pruebas de
 * $1 en julio y nada en agosto. **26 días sin registrar una venta**, con 42
 * productos con stock y USD 1.528 de capital parado.
 *
 * El panel mostraba despachos, sin-stock, deudas, stock bajo y seguimientos.
 * Ninguno de esos es el hecho más importante de esa pantalla.
 *
 * ⚠️ Y `platform_org_health` **sí lo sabía**: la plataforma veía la
 * organización dormida con su señal de riesgo. El comercio no. Un sistema que
 * le cuenta al operador del SaaS lo que no le cuenta al dueño del negocio tiene
 * la asimetría al revés.
 */
describe("el umbral sale del ritmo del comercio, no de un número fijo", () => {
  it("con la historia real, 26 días de silencio es raro", () => {
    // Con los huecos reales el umbral da 15: el comercio ya estuvo 15 días sin
    // vender en operación normal, así que avisar antes sería ruido. Un fijo de
    // 7 lo habría molestado; uno de 30 lo habría callado.
    const umbral = umbralDeSilencio(HUECOS_REALES);
    expect(umbral).not.toBeNull();
    expect(26).toBeGreaterThan(umbral!);
  });

  it("y 5 días no lo es, porque ya estuvo 15 sin vender", () => {
    expect(5).toBeLessThanOrEqual(umbralDeSilencio(HUECOS_REALES)!);
  });

  it("quien vende todos los días no recibe el aviso al segundo", () => {
    // Sin piso, un fin de semana largo dispararía el aviso — y un aviso que
    // salta seguido enseña a ignorar la lista entera.
    const diario = Array(20).fill(1);
    expect(umbralDeSilencio(diario)).toBe(7);
  });

  it("quien vende una vez por mes no recibe el aviso a los quince", () => {
    const mensual = [30, 28, 31, 29, 30, 32, 27, 30, 31, 29];
    expect(umbralDeSilencio(mensual)!).toBeGreaterThanOrEqual(30);
  });

  it("con poca historia se espera a superar todo lo conocido", () => {
    // Con pocos intervalos el p90 es ruido: se avisa recién cuando el silencio
    // supera el hueco más largo que el comercio ya vivió.
    expect(umbralDeSilencio([2, 3, 20])).toBe(20);
  });

  it("sin historia no hay umbral, y eso no es 'está todo bien'", () => {
    expect(umbralDeSilencio([])).toBeNull();
  });

  it("el ritmo habitual es la mediana, no el promedio", () => {
    // El promedio de los huecos reales lo distorsiona el bache de 61 días:
    // daría ~7 cuando el comercio vende cada 2.
    expect(ritmoHabitual(HUECOS_REALES)).toBe(2);
  });
});

describe("el pendiente de silencio", () => {
  const conSilencio = (dias: number | null, huecos = HUECOS_REALES): DatosFoco =>
    ({ ...VACIO, diasSinRegistrarVenta: dias, huecosEntreVentas: huecos });

  it("aparece con el caso real y compara contra el ritmo propio", () => {
    const p = construirPendientes(conSilencio(26)).find(x => x.id === "sin-ventas");
    expect(p).toBeDefined();
    // La comparación es lo que lo vuelve creíble: sin ella son 26 días sueltos
    // que el comercio no sabe si están bien o mal.
    expect(p!.texto).toBe("26 días sin registrar una venta (solés vender cada 2)");
  });

  it("dice «registrar», no «vender»", () => {
    // El sistema no puede saber si el comercio vendió y no lo cargó — las 34
    // ventas reales entraron todas a mano. Afirmar la equivocada suena a
    // reproche y puede ser falsa.
    const p = construirPendientes(conSilencio(26)).find(x => x.id === "sin-ventas");
    expect(p!.texto).toContain("sin registrar una venta");
    expect(p!.texto).not.toContain("sin vender");
  });

  it("lleva a un lugar donde se puede hacer algo", () => {
    const p = construirPendientes(conSilencio(26)).find(x => x.id === "sin-ventas");
    expect(p!.destino).toBe("/tienda-online");
    expect(p!.accion).toBe("Revisar la tienda");
  });

  it("si eligió mostrador, el silencio abre el POS", () => {
    const p = construirPendientes({
      ...conSilencio(26), onboardingGoal: "pos",
    }).find(x => x.id === "sin-ventas");
    expect(p!.destino).toBe("/caja");
    expect(p!.accion).toBe("Registrar una venta");
  });

  it("no aparece cuando el silencio es normal para ese comercio", () => {
    expect(construirPendientes(conSilencio(3)).map(x => x.id)).not.toContain("sin-ventas");
  });

  it("no aparece si nunca vendió: no hay silencio que medir", () => {
    // Un comercio recién dado de alta no tiene por qué recibir un reproche.
    expect(construirPendientes(conSilencio(null, [])).map(x => x.id)).not.toContain("sin-ventas");
  });

  it("va después del pedido pagado sin despachar", () => {
    // Ahí espera un cliente que ya pagó; eso gana sobre cualquier otra cosa.
    const ids = construirPendientes({
      ...conSilencio(26), pedidosPorDespachar: 1,
    }).map(x => x.id);
    expect(ids.indexOf("despachar")).toBeLessThan(ids.indexOf("sin-ventas"));
  });

  it("va antes que el stock: si no vendés, reponer no es lo urgente", () => {
    const ids = construirPendientes({
      ...conSilencio(26), sinStock: 5, stockBajo: 9,
    }).map(x => x.id);
    expect(ids.indexOf("sin-ventas")).toBeLessThan(ids.indexOf("sin-stock"));
  });
});
