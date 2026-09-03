import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canalDeVentaDelFoco, construirPendientes, FOCO_MAX_PENDIENTES, leerVariacion, nivelDelDia,
  type DatosFoco,
} from "@/lib/dashboardFocus";

const VACIO: DatosFoco = {
  sinStock: 0, stockBajo: 0,
  deudasPendientes: 0, deudaTotalARS: 0, deudasVencidas30: 0,
  seguimientosHoy: 0, pedidosPorDespachar: 0,
};

describe("canalDeVentaDelFoco", () => {
  it("sólo el mostrador explícito manda a POS", () => {
    expect(canalDeVentaDelFoco("pos")).toBe("pos");
    expect(canalDeVentaDelFoco("online")).toBe("online");
    expect(canalDeVentaDelFoco("explore")).toBe("online");
    expect(canalDeVentaDelFoco(null)).toBe("online");
    expect(canalDeVentaDelFoco(undefined)).toBe("online");
  });
});

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
  it("un pedido de retiro no se presenta como despacho", () => {
    const p = construirPendientes({
      ...VACIO, pedidosPorRetirar: 2, pedidosPorDespachar: 1, sinStock: 9,
    });
    expect(p[0].id).toBe("retirar");
    expect(p[0].texto).toBe("2 pedidos listos para retirar");
    expect(p[0].accion).toBe("Marcar retirado");
    expect(p[0].destino).toBe("/pedidos-online?vista=retirar");
    expect(p[1].id).toBe("despachar");
  });

  it("un pedido pagado a domicilio sin despachar va primero si no hay retiro", () => {
    const p = construirPendientes({
      ...VACIO, pedidosPorDespachar: 1, sinStock: 9, deudasVencidas30: 9,
    });
    expect(p[0].id).toBe("despachar");
    expect(p[0].destino).toBe("/pedidos-online?vista=despachar");
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

  it("sin operación y canal POS, empuja el mostrador y la toma física", () => {
    const p = construirPendientes({
      ...VACIO, nuncaVendio: true, sinConteoFisico: true, onboardingGoal: "pos",
    });
    expect(p.map((x) => x.id)).toEqual(["primera-venta", "toma-fisica"]);
    expect(p[0].destino).toBe("/caja");
    expect(p[0].accion).toBe("Abrir el POS");
    expect(p[1].destino).toBe("/kardex");
  });

  it("sin operación, la tienda es la puerta — no el POS", () => {
    const sinCanal = construirPendientes({ ...VACIO, nuncaVendio: true });
    expect(sinCanal[0].id).toBe("primera-venta");
    expect(sinCanal[0].destino).toBe("/tienda-online");
    expect(sinCanal[0].accion).toBe("Abrir Commerce");

    const online = construirPendientes({
      ...VACIO, nuncaVendio: true, onboardingGoal: "online",
    });
    expect(online[0].destino).toBe("/tienda-online");

    const explore = construirPendientes({
      ...VACIO, nuncaVendio: true, onboardingGoal: "explore",
    });
    expect(explore[0].destino).toBe("/tienda-online");
  });

  it("tienda sin publicar aparece aunque falte el tarifario", () => {
    const p = construirPendientes({
      ...VACIO,
      onboardingGoal: "online",
      tiendaPublicada: false,
      zonasSinTarifa: 5,
    });
    expect(p.map((x) => x.id)).toEqual(["publicar-tienda", "tarifario"]);
    expect(p[0].destino).toBe("/tienda-online");
    expect(p[0].accion).toBe("Publicar");
  });

  it("con ventas POS pero cero online, el Foco pide la puerta Commerce", () => {
    const p = construirPendientes({
      ...VACIO, onboardingGoal: "online", ordenesOnlinePagas: 0, tiendaPublicada: true,
    });
    expect(p[0].id).toBe("primera-venta");
    expect(p[0].destino).toBe("/tienda-online?tab=overview&share=1");
    expect(p[0].accion).toBe("Compartí el enlace");
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
    expect(uno.destino).toBe("/pedidos-online?vista=pago");
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

  it("carritos abandonados van a Pedidos → Recuperación", () => {
    expect(construirPendientes({ ...VACIO, carritosAbandonados: 0 })).toEqual([]);
    const uno = construirPendientes({ ...VACIO, carritosAbandonados: 1 })[0];
    expect(uno.id).toBe("carritos-abandonados");
    expect(uno.texto).toBe("1 carrito abandonado");
    expect(uno.destino).toBe("/pedidos-online?cola=recuperacion");
    expect(uno.urgencia).toBe("atencion");
  });

  it("Pulse muestra como máximo cinco pendientes", () => {
    const p = construirPendientes({
      ...VACIO,
      pedidosPorDespachar: 1,
      pedidosPendientesDePago: 1,
      sinStock: 1,
      deudasVencidas30: 1,
      stockBajo: 1,
      seguimientosHoy: 1,
      zonasSinTarifa: 1,
    });
    expect(FOCO_MAX_PENDIENTES).toBe(5);
    expect(p.length).toBe(5);
    expect(p.map((x) => x.id)).toEqual([
      "despachar",
      "pago-pendiente",
      "sin-stock",
      "deuda-vencida",
      "stock-bajo",
    ]);
  });

  it("ATM: tarifario y pesos llevan a Precios por provincia / Completar pesos", () => {
    expect(construirPendientes({ ...VACIO, zonasSinTarifa: 0, productosSinPeso: 0 })).toEqual([]);
    const tarifa = construirPendientes({ ...VACIO, zonasSinTarifa: 2 })[0];
    expect(tarifa.id).toBe("tarifario");
    expect(tarifa.destino).toBe("/envios?tab=zonas");
    expect(tarifa.accion).toBe("Precios por provincia");
    const pesos = construirPendientes({ ...VACIO, productosSinPeso: 5 })[0];
    expect(pesos.id).toBe("pesos");
    expect(pesos.destino).toBe("/productos?completar=pesos");
    expect(pesos.accion).toBe("Completar pesos");
  });

  it("tienda publicada sin zonas: Precios por provincia no alcanza", () => {
    expect(construirPendientes({
      ...VACIO, tiendaPublicada: true, zonasActivas: 0, zonasSinTarifa: 0,
    })[0]).toMatchObject({
      id: "zonas-envio",
      accion: "Crear zonas",
      destino: "/envios?tab=zonas",
    });
    expect(construirPendientes({
      ...VACIO, tiendaPublicada: false, zonasActivas: 0,
    }).map((x) => x.id)).not.toContain("zonas-envio");
  });

  it("tienda publicada con retiro sin horario: no se inventa el texto", () => {
    expect(construirPendientes({
      ...VACIO, tiendaPublicada: true, retiroSinHorario: true,
    })[0]).toMatchObject({
      id: "retiro-horario",
      accion: "Cargar horario",
      destino: "/tienda-online?tab=settings",
    });
    expect(construirPendientes({
      ...VACIO, tiendaPublicada: false, retiroSinHorario: true,
    }).map((x) => x.id)).not.toContain("retiro-horario");
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

describe("FocoDelDia no cuenta fantasmas de Pay ni despacha un retiro", () => {
  it("pide método y fecha, y filtra con la regla del Core", () => {
    const ui = readFileSync(resolve(__dirname, "../components/dashboard/FocoDelDia.tsx"), "utf8");
    expect(ui).toContain("countActionableUnpaidOrders");
    expect(ui).toContain("payment_method, created_at");
  });

  it("parte retiro de domicilio con la misma cola pagada", () => {
    const ui = readFileSync(resolve(__dirname, "../components/dashboard/FocoDelDia.tsx"), "utf8");
    expect(ui).toContain("countFulfillmentPulse");
    expect(ui).toContain("carrier, shipping_service");
  });

  it("el Foco recibe el canal del onboarding, no asume POS", () => {
    const ui = readFileSync(resolve(__dirname, "../components/dashboard/FocoDelDia.tsx"), "utf8");
    const dashboard = readFileSync(resolve(__dirname, "../pages/Dashboard.tsx"), "utf8");
    expect(ui).toContain("onboardingGoal: p.onboardingGoal");
    expect(dashboard).toContain("onboardingGoal={activeOrg?.onboarding_goal}");
    expect(dashboard).toContain("tiendaPublicada={activationSignals?.online_channel_ready");
  });

  it("el Foco lee el horario de retiro de la tienda, no lo inventa", () => {
    const ui = readFileSync(resolve(__dirname, "../components/dashboard/FocoDelDia.tsx"), "utf8");
    expect(ui).toContain("pickup_enabled, pickup_address, pickup_instructions");
    expect(ui).toContain("retiroSinHorario");
  });
});

describe("nivelDelDia", () => {
  it("resume el peor pendiente", () => {
    expect(nivelDelDia(construirPendientes({ ...VACIO, sinStock: 1 }))).toBe("critico");
    expect(nivelDelDia(construirPendientes({ ...VACIO, stockBajo: 1 }))).toBe("atencion");
    expect(nivelDelDia(construirPendientes(VACIO))).toBe("normal");
  });
});
