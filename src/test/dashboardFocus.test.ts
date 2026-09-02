import { describe, it, expect } from "vitest";
import {
  construirPendientes, leerVariacion, nivelDelDia,
  type DatosFoco,
} from "@/lib/dashboardFocus";

const VACIO: DatosFoco = {
  sinStock: 0, stockBajo: 0,
  deudasPendientes: 0, deudaTotalARS: 0, deudasVencidas30: 0,
  seguimientosHoy: 0, pedidosPorDespachar: 0,
};

describe("construirPendientes", () => {
  // Una lista con "0 productos sin stock" enseña a saltear la lista entera.
  it("no muestra pendientes en cero", () => {
    expect(construirPendientes(VACIO)).toEqual([]);
  });

  it("todo pendiente lleva a un destino concreto", () => {
    const p = construirPendientes({
      ...VACIO, sinStock: 3, deudasVencidas30: 2, seguimientosHoy: 4, pedidosPorDespachar: 1,
    });
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) {
      expect(x.destino.startsWith("/"), `"${x.texto}" sin destino`).toBe(true);
      expect(x.accion, `"${x.texto}" sin acción`).toBeTruthy();
    }
  });

  // El orden es por costo de no hacerlo, no por módulo.
  it("lo crítico va antes que lo que puede esperar", () => {
    const p = construirPendientes({ ...VACIO, sinStock: 2, seguimientosHoy: 5 });
    expect(p[0].id).toBe("sin-stock");
    expect(p[1].id).toBe("seguimientos");
  });

  // Es el único pendiente donde el que espera es un cliente que ya pagó.
  it("un pedido pagado sin despachar va primero de todo", () => {
    const p = construirPendientes({
      ...VACIO, pedidosPorDespachar: 1, sinStock: 9, deudasVencidas30: 9,
    });
    expect(p[0].id).toBe("despachar");
    expect(p[0].destino).toBe("/tienda-online?tab=orders&vista=despachar");
  });

  // Una deuda al día no es un pendiente: es el negocio funcionando.
  it("distingue la deuda vencida de la que está al día", () => {
    const vencida = construirPendientes({
      ...VACIO, deudasPendientes: 5, deudaTotalARS: 100000, deudasVencidas30: 2,
    });
    expect(vencida.find(p => p.id === "deuda-vencida")?.urgencia).toBe("critico");
    expect(vencida.find(p => p.id === "deuda")).toBeUndefined();

    const alDia = construirPendientes({
      ...VACIO, deudasPendientes: 5, deudaTotalARS: 100000, deudasVencidas30: 0,
    });
    expect(alDia.find(p => p.id === "deuda")?.urgencia).toBe("normal");
  });

  it("no avisa de deuda sin monto", () => {
    expect(construirPendientes({ ...VACIO, deudasPendientes: 3, deudaTotalARS: 0 })).toEqual([]);
  });

  it("usa singular y plural donde corresponde", () => {
    expect(construirPendientes({ ...VACIO, sinStock: 1 })[0].texto).toContain("1 producto sin stock");
    expect(construirPendientes({ ...VACIO, sinStock: 2 })[0].texto).toContain("2 productos sin stock");
  });

  it("sin operación, empuja primera venta POS y toma física", () => {
    const p = construirPendientes({ ...VACIO, nuncaVendio: true, sinConteoFisico: true });
    expect(p.map((x) => x.id)).toEqual(["primera-venta", "toma-fisica"]);
    expect(p[0].destino).toBe("/caja");
    expect(p[1].destino).toBe("/kardex");
  });

  it("con pendientes operativos no tapa con CTAs de onboarding", () => {
    const p = construirPendientes({
      ...VACIO, sinStock: 1, nuncaVendio: true, sinConteoFisico: true,
    });
    expect(p.map((x) => x.id)).toEqual(["sin-stock"]);
  });

  it("ofertas IA pendientes aparecen con destino a la vista Ofertas", () => {
    expect(construirPendientes({ ...VACIO, ofertasIaPendientes: 0 })).toEqual([]);
    const una = construirPendientes({ ...VACIO, ofertasIaPendientes: 1 })[0];
    expect(una.id).toBe("ofertas-ia");
    expect(una.texto).toContain("1 oferta IA pendiente");
    expect(una.destino).toBe("/marketing?vista=ofertas");
    expect(una.urgencia).toBe("atencion");
    const varias = construirPendientes({ ...VACIO, ofertasIaPendientes: 3 })[0];
    expect(varias.texto).toContain("3 ofertas IA pendientes");
  });

  // El cobro manual ya existe; sin este renglón la venta por transferencia
  // no aparece en "Para hacer ahora".
  it("pedidos pendientes de pago van a Commerce vista=pago", () => {
    expect(construirPendientes({ ...VACIO, pedidosPendientesDePago: 0 })).toEqual([]);
    const uno = construirPendientes({ ...VACIO, pedidosPendientesDePago: 1 })[0];
    expect(uno.id).toBe("pago-pendiente");
    expect(uno.texto).toBe("1 pedido pendiente de pago");
    expect(uno.accion).toBe("Revisar");
    expect(uno.destino).toBe("/tienda-online?tab=orders&vista=pago");
    expect(uno.urgencia).toBe("critico");
    const varios = construirPendientes({ ...VACIO, pedidosPendientesDePago: 2 })[0];
    expect(varios.texto).toBe("2 pedidos pendientes de pago");
  });

  it("despachar pesa más que pendiente de pago, ambos críticos", () => {
    const p = construirPendientes({
      ...VACIO, pedidosPorDespachar: 1, pedidosPendientesDePago: 3, sinStock: 9,
    });
    expect(p.map((x) => x.id).slice(0, 2)).toEqual(["despachar", "pago-pendiente"]);
    expect(p[0].urgencia).toBe("critico");
    expect(p[1].urgencia).toBe("critico");
  });

  it("carritos abandonados van a Commerce tab=carritos", () => {
    expect(construirPendientes({ ...VACIO, carritosAbandonados: 0 })).toEqual([]);
    const uno = construirPendientes({ ...VACIO, carritosAbandonados: 1 })[0];
    expect(uno.id).toBe("carritos-abandonados");
    expect(uno.texto).toBe("1 carrito abandonado");
    expect(uno.destino).toBe("/tienda-online?tab=carritos");
    expect(uno.urgencia).toBe("atencion");
  });
});

describe("leerVariacion", () => {
  it("lee subas y bajas", () => {
    expect(leerVariacion(120, 100)).toEqual({ pct: 20, sentido: "sube" });
    expect(leerVariacion(80, 100)).toEqual({ pct: -20, sentido: "baja" });
  });

  // "+100%" el primer mes es mentira: no había con qué comparar.
  it("sin período anterior no inventa un porcentaje", () => {
    expect(leerVariacion(5000, 0).pct).toBeNull();
    expect(leerVariacion(5000, -1).pct).toBeNull();
    expect(leerVariacion(5000, NaN).pct).toBeNull();
  });

  // Medio punto no es una tendencia; mostrarlo hace parecer volátil al panel.
  it("el ruido no cuenta como movimiento", () => {
    expect(leerVariacion(100.2, 100).sentido).toBe("igual");
    expect(leerVariacion(100, 100)).toEqual({ pct: 0, sentido: "igual" });
  });

  it("redondea a un decimal", () => {
    expect(leerVariacion(133, 100).pct).toBe(33);
    expect(leerVariacion(112.34, 100).pct).toBe(12.3);
  });
});

describe("nivelDelDia", () => {
  it("resume el peor pendiente", () => {
    expect(nivelDelDia(construirPendientes({ ...VACIO, sinStock: 1 }))).toBe("critico");
    expect(nivelDelDia(construirPendientes({ ...VACIO, stockBajo: 1 }))).toBe("atencion");
    expect(nivelDelDia(construirPendientes(VACIO))).toBe("normal");
  });
});
