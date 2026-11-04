import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accionDeEntregaDeLaFila,
  cantidadDePedidos,
  celularParaWhatsApp,
  dialogoMarcarCobrado,
  enlaceAvisoDeRetiro,
  estadoDeEntregaVisible,
  montoACobrar,
  pistaDeCobroManual,
  textoDeCobroDeLaFicha,
  totalDelPedido,
  vistaVisible,
} from "@/lib/colaDePedidosOnline";
import type { StoreOrderQueueRow } from "@/lib/storeOrderQueue";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
const fila = (extra: Partial<StoreOrderQueueRow>): StoreOrderQueueRow => ({
  id: "o1", order_number: "TN-1", customer_name: "ZZ Ana", customer_email: "a@example.test",
  customer_phone: null, total: 10000, payment_status: "paid", fulfillment_status: "pending",
  tracking_number: null, created_at: "2026-11-04T10:00:00Z", ...extra,
});

describe("estado de entrega visible (2026-11-04)", () => {
  it("un retiro impago no dice «Para retirar»", () => {
    expect(estadoDeEntregaVisible("pending", { carrier: "retiro", payment_status: "pending" })).toBe("Retira cuando pague");
    expect(estadoDeEntregaVisible("pending", { carrier: "retiro", payment_status: "paid" })).toBe("Para retirar");
    expect(estadoDeEntregaVisible("processing", { payment_status: "pending" })).toBe("Esperando el pago");
    expect(estadoDeEntregaVisible("pending", { carrier: "retiro", payment_status: "refunded" })).toBe("No entregar");
    expect(estadoDeEntregaVisible("pending", { payment_status: "charged_back" })).toBe("No entregar");
  });
  it("sin pago conocido se comporta como antes, y un retiro avisado queda listo", () => {
    expect(estadoDeEntregaVisible("processing")).toBe("Para despachar");
    expect(estadoDeEntregaVisible("delivered", { payment_status: "pending" })).toBe("Entregada");
    expect(estadoDeEntregaVisible("shipped", { carrier: "retiro", payment_status: "paid" })).toBe("Listo para retirar");
    expect(estadoDeEntregaVisible("shipped", { payment_status: "paid" })).toBe("Enviada");
  });
});

describe("próximo paso del cobro", () => {
  it("dice el medio y qué hacer; Nerqia Pay no lleva pista", () => {
    expect(pistaDeCobroManual({ payment_status: "pending", payment_method: "transferencia" })).toMatch(/^Transferencia · fijate en tu banco/);
    expect(pistaDeCobroManual({ payment_status: "pending", payment_method: "efectivo" })).toMatch(/^Efectivo · cobralo al entregar/);
    expect(pistaDeCobroManual({ payment_status: "pending", payment_method: "cuenta_corriente" })).toMatch(/^A cuenta corriente/);
    expect(pistaDeCobroManual({ payment_status: "pending", payment_method: "gestiona_pay" })).toBe("");
    expect(pistaDeCobroManual({ payment_status: "paid", payment_method: "transferencia" })).toBe("");
  });
});

describe("monto a cobrar con saldo a favor", () => {
  it("descuenta el saldo, redondea a centavos y nunca da negativo", () => {
    expect(montoACobrar(10000, 0)).toBe(10000);
    expect(montoACobrar("10000", 2500.5)).toBe(7499.5);
    expect(montoACobrar(100.1, 0.2)).toBe(99.9);
    expect(montoACobrar(5000, 8000)).toBe(0);
    expect(montoACobrar(5000, Number.NaN)).toBe(5000);
    expect(montoACobrar(null, 0)).toBe(0);
  });
  it("el diálogo de la fila dice cuánto y de quién", () => {
    const sinSaldo = dialogoMarcarCobrado({ orderNumber: "TN-1", paymentMethod: "transferencia", total: 10000, customerName: "ZZ Ana", saldoAplicado: 0 });
    expect(sinSaldo.description).toBe(`Confirmás que recibiste una transferencia de ${pesos(10000)} de ZZ Ana por el pedido TN-1. Se registra la venta y ya lo podés preparar.`);
    expect(sinSaldo.confirmText).toBe(`Marcar cobrado (${pesos(10000)})`);
    const conSaldo = dialogoMarcarCobrado({ orderNumber: "TN-2", paymentMethod: "efectivo", total: 10000, customerName: null, saldoAplicado: 3000 });
    expect(conSaldo.aCobrar).toBe(7000);
    expect(conSaldo.description).toContain(`recibiste ${pesos(7000)} en efectivo por el pedido TN-2`);
    expect(conSaldo.description).toContain(`(el total es ${pesos(10000)}; ${pesos(3000)} se pagaron con saldo a favor)`);
    expect(conSaldo.confirmText).toBe(`Marcar cobrado (${pesos(7000)})`);
  });
  it("si no se pudo leer el saldo, no afirma un importe exacto (2026-11-04)", () => {
    const d = dialogoMarcarCobrado({ orderNumber: "TN-3", paymentMethod: "transferencia", total: 10000, customerName: "ZZ Ana", saldoAplicado: null });
    expect(d.aCobrar).toBeNull();
    expect(d.confirmText).toBe("Marcar cobrado");
    expect(d.description).toContain("No pudimos leer si usó saldo a favor; revisá el importe en la ficha");
    expect(d.description).toContain("la transferencia de ZZ Ana por el pedido TN-3");
    expect(d.description).not.toContain(pesos(10000));
    expect(dialogoMarcarCobrado({ orderNumber: "TN-4", paymentMethod: "efectivo", total: 500, saldoAplicado: null }).description)
      .toMatch(/^Confirmás que recibiste el efectivo por el pedido TN-4\./);
  });
  it("la franja de cobro rotula el total con el mismo formato del diálogo", () => {
    expect(totalDelPedido(10000)).toBe(`Total ${pesos(10000)}`);
    expect(totalDelPedido("2500.5")).toBe(`Total ${pesos(2500.5)}`);
    expect(totalDelPedido(null)).toBe(`Total ${pesos(0)}`);
    const panel = readFileSync("src/components/ecommerce/StoreOrdersPanel.tsx", "utf8");
    expect(panel).toContain("{totalDelPedido(primeroPorCobrar.total)}");
    expect(panel).not.toContain("SLA configurado");
  });
});

describe("texto del cobro en la ficha", () => {
  it("una transferencia pendiente no dice que ya se cobró", () => {
    const t = textoDeCobroDeLaFicha({ payment_status: "pending", payment_method: "transferencia", customer_name: "ZZ Ana", aCobrar: 7000 });
    expect(t.pendiente).toBe(true);
    expect(t.texto).toContain("Todavía no lo cobraste");
    expect(t.texto).toContain(pesos(7000));
    expect(t.texto).not.toMatch(/lo cobró/);
  });
  it("cuenta corriente, pago digital pendiente, devuelto y cobrado", () => {
    expect(textoDeCobroDeLaFicha({ payment_status: "pending", payment_method: "cuenta_corriente", customer_name: "ZZ Ana", aCobrar: 1 }).texto).toMatch(/^Todavía no lo aprobaste/);
    expect(textoDeCobroDeLaFicha({ payment_status: "pending", payment_method: "gestiona_pay", aCobrar: 1 }).texto).toMatch(/^Esperando que se acredite/);
    expect(textoDeCobroDeLaFicha({ payment_status: "refunded", payment_method: "transferencia", aCobrar: 1 }).texto).toMatch(/No entregues/);
    expect(textoDeCobroDeLaFicha({ payment_status: "paid", payment_method: "transferencia", aCobrar: 1 }).texto).toMatch(/^Cobrado\./);
  });
  it("la ficha usa el texto y ya no afirma que cobró el checkout", () => {
    const ficha = readFileSync("src/components/ecommerce/StoreOrderInspector.tsx", "utf8");
    expect(ficha).toContain("textoDeCobroDeLaFicha");
    expect(ficha).not.toContain("El total lo cobró el checkout");
    expect(ficha).toContain('"Retira en el local"');
    expect(ficha).not.toContain("Retiro o sin dirección cargada");
  });
});

describe("cola", () => {
  it("cuenta pedidos en singular y plural", () => {
    expect(cantidadDePedidos(1)).toBe("1 pedido");
    expect(cantidadDePedidos(3)).toBe("3 pedidos");
    expect(cantidadDePedidos(undefined)).toBe("0 pedidos");
  });
  it("muestra sólo las vistas con pedidos, salvo mientras carga", () => {
    const counts = { todas: 1, retirar: 0, pago: 0, enviadas: 0, despachar: 2 };
    const ctx = { view: "todas", loading: false, error: null, counts };
    expect(vistaVisible("todas", ctx)).toBe(true);
    expect(vistaVisible("pago", ctx)).toBe(true);
    expect(vistaVisible("despachar", ctx)).toBe(true);
    expect(vistaVisible("retirar", ctx)).toBe(false);
    expect(vistaVisible("retirar", { ...ctx, view: "retirar" })).toBe(true);
    expect(vistaVisible("enviadas", { ...ctx, loading: true })).toBe(true);
  });
  it("el retiro usa el flujo que la base acepta: sin paso a 'shipped' (2026-11-04)", () => {
    expect(accionDeEntregaDeLaFila(fila({ carrier: "retiro" }))).toBe("Marcar retiro");
    expect(accionDeEntregaDeLaFila(fila({ carrier: "retiro", fulfillment_status: "processing" }))).toBe("Marcar retiro");
    expect(accionDeEntregaDeLaFila(fila({ carrier: "retiro", fulfillment_status: "delivered" }))).toBe("Ver retiro");
    expect(accionDeEntregaDeLaFila(fila({ carrier: "retiro", payment_status: "pending" }))).toBe("");
    expect(accionDeEntregaDeLaFila(fila({}))).toBe("Preparar");
  });
  it("el diálogo no intenta pasar un retiro a 'shipped' ni afirma un aviso que no salió", () => {
    const dialogo = readFileSync("src/components/ecommerce/OrderShipmentDialog.tsx", "utf8");
    // update_store_order_fulfillment rechaza retiro → 'shipped' («El retiro en tienda no se despacha»).
    expect(dialogo).not.toContain("Avisar que está listo");
    expect(dialogo).not.toContain("Le avisamos al comprador que ya puede retirarlo");
    expect(dialogo).toContain("Avisarle por WhatsApp que ya puede retirar");
    expect(dialogo).toContain("const avisado = await avisarEstado(status);");
    expect(dialogo).toContain("toast.success(avisado ?");
    // 2026-11-04: un envío todavía en curso (inProgress) no cuenta como avisado.
    expect(dialogo).toContain("if ((data as { inProgress?: boolean } | null)?.inProgress) return false;");
  });
  it("el panel de tiempos de entrega no habla de SLA", () => {
    const sla = readFileSync("src/components/ecommerce/StoreOrdersSLAPanel.tsx", "utf8");
    expect(sla).toContain("Tiempos de entrega — {storeName");
    expect(sla).not.toMatch(/SLA de pedidos|Atrasados \(SLA\)|Estado SLA|Panel de SLA|pipeline|fulfillment</);
  });
});

describe("aviso de retiro por WhatsApp", () => {
  it("normaliza celulares argentinos y no adivina los raros", () => {
    expect(celularParaWhatsApp("11 5555-1234")).toBe("5491155551234");
    expect(celularParaWhatsApp("011 15 5555 1234")).toBe("5491155551234");
    expect(celularParaWhatsApp("+54 9 11 5555-1234")).toBe("5491155551234");
    expect(celularParaWhatsApp("+54 11 5555-1234")).toBe("5491155551234");
    expect(celularParaWhatsApp("0351 15 555 1234")).toBe("5493515551234");
    // Sin área: no hay área «15»; antes salía 5491555551234 (2026-11-04).
    expect(celularParaWhatsApp("15 5555-1234")).toBeNull();
    expect(celularParaWhatsApp("015 5555 1234")).toBeNull();
    // Con código de país y sin área (2026-11-04): tampoco se adivina.
    expect(celularParaWhatsApp("+54 15 5555-1234")).toBeNull();
    expect(celularParaWhatsApp("+54 9 15 5555 1234")).toBeNull();
    expect(celularParaWhatsApp("0054 9 15 5555 1234")).toBeNull();
    expect(celularParaWhatsApp("0054 9 11 5555 1234")).toBe("5491155551234");
    expect(celularParaWhatsApp("1234")).toBeNull();
    expect(celularParaWhatsApp(null)).toBeNull();
  });
  it("arma el mensaje con el pedido", () => {
    const wa = enlaceAvisoDeRetiro({ customer_phone: "11 5555-1234", customer_name: "ZZ Ana", order_number: "TN-1" });
    expect(wa).toBe(`https://wa.me/5491155551234?text=${encodeURIComponent("Hola ZZ Ana, tu pedido TN-1 ya está listo para retirar.")}`);
    expect(enlaceAvisoDeRetiro({ customer_phone: "", order_number: "TN-1" })).toBeNull();
  });
});
