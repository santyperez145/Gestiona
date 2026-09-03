import { describe, expect, it } from "vitest";
import {
  copyEstadoPedido,
  etiquetaCostoEntrega,
  etiquetaDireccionEntrega,
  etiquetaWhatsAppPedido,
  introPagoRevertido,
  introPedidoPagado,
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
});
