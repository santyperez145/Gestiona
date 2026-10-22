import { describe, expect, it } from "vitest";
import { enlaceWhatsApp, numeroDeRecibo, reciboDesdeCobros, reciboHtml, textoDeRecibo } from "@/lib/reciboDeCobro";
import type { CobroCuentaCorriente } from "@/lib/supabaseStore";

const cobro = (extra: Partial<CobroCuentaCorriente> = {}): CobroCuentaCorriente => ({
  cobro_id: "8f3a2c1d-0000-4000-8000-000000000001", aplicado: 15000,
  imputaciones: [
    { debt_id: "d1", aplicado: 10000, saldo: 0, descripcion: "Venta 12/09" },
    { debt_id: "d2", aplicado: 5000, saldo: 2500, descripcion: null },
  ],
  saldo_pendiente: 2500, en_caja: true, repetido: false, ...extra,
});
const negocio = { nombre: "Ferretería <Famatina>", cuit: "20123456786" };

describe("recibo de un cobro de cuenta corriente", () => {
  it("sale de lo que devolvió la base: imputaciones, total y saldo", () => {
    const r = reciboDesdeCobros([cobro()], { negocio, cliente: "Juan Pérez", medio: "debito", fecha: "2026-10-22T15:00:00Z" });
    expect(r).toMatchObject({ numero: "8F3A2C1D", cliente: "Juan Pérez", medio: "Tarjeta de débito", total: 15000, saldoPendiente: 2500, aFavor: 0 });
    expect(r.imputaciones).toEqual([
      { descripcion: "Venta 12/09", aplicado: 10000, saldo: 0 },
      { descripcion: "Deuda", aplicado: 5000, saldo: 2500 },
    ]);
  });

  it("lo que queda a favor suma al total recibido", () => {
    const r = reciboDesdeCobros([cobro({ a_favor: 1000, saldo_pendiente: 0 })], { negocio, cliente: "Ana", medio: "efectivo" });
    expect(r).toMatchObject({ total: 16000, aFavor: 1000, saldoPendiente: 0 });
    expect(reciboHtml(r)).toContain("Queda a favor del cliente");
  });

  it("varios cobros del mismo cliente van en un solo recibo", () => {
    const segundo = cobro({ cobro_id: "aaaaaaaa-1111-4000-8000-000000000002", aplicado: 2500, imputaciones: [{ debt_id: "d2", aplicado: 2500, saldo: 0, descripcion: "Resto" }], saldo_pendiente: 0 });
    const r = reciboDesdeCobros([cobro(), segundo], { negocio, cliente: "Juan", medio: "efectivo" });
    expect(r.numero).toBe("8F3A2C1D · AAAAAAAA");
    expect(r.total).toBe(17500);
    expect(r.imputaciones).toHaveLength(3);
    expect(r.saldoPendiente).toBe(0);
  });

  it("el HTML escapa lo que escribe el comercio y aclara que no es factura", () => {
    const html = reciboHtml(reciboDesdeCobros([cobro()], { negocio, cliente: "<script>x</script>", medio: "efectivo", nota: "a & b" }));
    expect(html).toContain("Ferretería &lt;Famatina&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("CUIT 20-12345678-6");
    expect(html).toContain("Documento no válido como factura.");
    expect(html).toContain("a &amp; b");
  });

  it("texto y enlace para WhatsApp", () => {
    const r = reciboDesdeCobros([cobro()], { negocio, cliente: "Juan", medio: "transferencia", fecha: "2026-10-22T15:00:00Z" });
    const texto = textoDeRecibo(r);
    expect(texto).toContain("Recibo N.º 8F3A2C1D");
    expect(texto).toContain("Saldo pendiente:");
    expect(enlaceWhatsApp(r, "+54 9 11 1234-5678")).toMatch(/^https:\/\/wa\.me\/5491112345678\?text=/);
    expect(enlaceWhatsApp(r)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(numeroDeRecibo("abcdef12-3456")).toBe("ABCDEF12");
  });
});
