import { describe, expect, it } from "vitest";
import {
  etiquetaCostoEntrega,
  etiquetaDireccionEntrega,
  introPedidoPagado,
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
});
