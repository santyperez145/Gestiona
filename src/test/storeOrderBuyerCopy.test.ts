import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  avisoCheckoutMedioPago,
  copyEstadoPedido,
  etiquetaCostoEntrega,
  etiquetaDireccionEntrega,
  etiquetaMedioCheckout,
  etiquetaWhatsAppPedido,
  indicePasoSeguimiento,
  introPagoRevertido,
  introPedidoPagado,
  pasosSeguimiento,
  textoWhatsAppPedido,
} from "@/lib/storeOrderBuyerCopy";

describe("confirmación al comprador: retiro no es envío", () => {
  it("un retiro pagado no promete un paquete en camino", () => {
    expect(introPedidoPagado(true)).toContain("retirar");
    expect(introPedidoPagado(true)).not.toMatch(/envío/i);
    expect(introPedidoPagado(false)).toMatch(/envío/i);
  });

  it("la línea de costo y la dirección cambian de nombre", () => {
    expect(etiquetaCostoEntrega(true)).toBe("Retiro");
    expect(etiquetaCostoEntrega(false)).toBe("Envío");
    expect(etiquetaDireccionEntrega(true)).toBe("Retiro en");
    expect(etiquetaDireccionEntrega(false)).toBe("Envío a");
  });

  it("marcar retirado no avisa como si fuera un domicilio entregado", () => {
    const retiro = copyEstadoPedido("delivered", true);
    expect(retiro.subject).toMatch(/retirado/i);
    expect(retiro.intro).not.toMatch(/transporte|en camino/i);
    const envio = copyEstadoPedido("delivered", false);
    expect(envio.subject).toMatch(/entregado/i);
  });

  it("WhatsApp de un pedido pagado no pide coordinar el pago", () => {
    const retiro = textoWhatsAppPedido({
      orderNumber: "A-1", totalFmt: "$1", esRetiro: true,
      pagado: true, pagoRevertido: false, transferenciaPendiente: false,
    });
    expect(retiro).toMatch(/retiro/i);
    expect(retiro).not.toMatch(/coordinar el pago/i);
    expect(etiquetaWhatsAppPedido(true)).toMatch(/Consultar/);
    expect(etiquetaWhatsAppPedido(false)).toMatch(/Coordinar/);
  });

  it("una reversión en retiro no habla de envío", () => {
    expect(introPagoRevertido(true)).toMatch(/retiro/i);
    expect(introPagoRevertido(true)).not.toMatch(/enviará/i);
    expect(introPagoRevertido(false)).toMatch(/enviará/i);
  });

  it("el seguimiento de un retiro no dice en camino ni entregado", () => {
    const pasos = pasosSeguimiento(true);
    expect(pasos.map((p) => p.label).join(" ")).not.toMatch(/envío|En camino|Entregado/i);
    expect(pasos.map((p) => p.label).join(" ")).toMatch(/retirar|Retirado/i);
    expect(pasosSeguimiento(false).some((p) => p.label === "En camino")).toBe(true);
    expect(indicePasoSeguimiento("unfulfilled", true)).toBe(0);
    expect(indicePasoSeguimiento("delivered", true)).toBe(3);
  });

  it("el checkout no promete «te contactamos» cuando hay transferencia o efectivo", () => {
    const transfer = avisoCheckoutMedioPago({ metodo: "transferencia", esRetiro: true });
    expect(transfer).toMatch(/datos para transferir/i);
    expect(transfer).not.toMatch(/te contactamos/i);
    expect(transfer).toMatch(/retirar/i);
    expect(avisoCheckoutMedioPago({ metodo: "transferencia", esRetiro: false })).toMatch(/envío/i);
    expect(avisoCheckoutMedioPago({ metodo: "efectivo", esRetiro: true })).toMatch(/retirar/i);
    expect(avisoCheckoutMedioPago({ metodo: "efectivo", esRetiro: false })).toMatch(/recibir/i);
    expect(avisoCheckoutMedioPago({ metodo: "gestiona_pay", esRetiro: false })).toBeNull();
    expect(etiquetaMedioCheckout("efectivo", true)).toMatch(/retirar/i);
    expect(etiquetaMedioCheckout("efectivo", false)).toMatch(/recibir/i);
    const checkout = readFileSync(
      resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"),
      "utf8",
    );
    expect(checkout).toContain("avisoCheckoutMedioPago");
    expect(checkout).not.toContain("Te contactamos para coordinar el pago y la entrega apenas recibamos el pedido.");
  });
});
