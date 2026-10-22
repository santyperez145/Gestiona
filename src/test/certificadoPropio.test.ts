import { describe, expect, it } from "vitest";
import { estadoCertificado, factura, pasosEnArca, tipoDePuntoDeVenta } from "@/lib/certificadoPropio";

const ahora = new Date("2026-10-22T12:00:00Z");
const base = { cuit: "23228915599", modo: "propio", environment: "produccion" };

describe("etapa del certificado propio", () => {
  it("sin CUIT, sin certificado y con pedido pendiente", () => {
    expect(estadoCertificado({ ...base, cuit: "", motivo: "falta_datos_fiscales" }, ahora).fase).toBe("sin_cuit");
    expect(estadoCertificado({ ...base, motivo: "falta_certificado_propio" }, ahora).fase).toBe("sin_certificado");
    expect(estadoCertificado({ ...base, motivo: "falta_certificado_propio", pedido_pendiente: true }, ahora).fase).toBe("pedido_pendiente");
  });

  it("un rechazo por falta de asociación se distingue de un certificado inválido", () => {
    const sinAsociar = estadoCertificado({ ...base, motivo: "certificado_rechazado",
      certificado_verificado_motivo: "El certificado es válido, pero en ARCA todavía no está asociado a Facturación Electrónica." }, ahora);
    expect(sinAsociar.fase).toBe("falta_asociar");
    expect(estadoCertificado({ ...base, motivo: "certificado_rechazado", certificado_verificado_motivo: "ARCA no reconoce este certificado" }, ahora).fase).toBe("rechazado");
  });

  it("vencido, por vencer y listo", () => {
    expect(estadoCertificado({ ...base, motivo: "certificado_vencido", certificado_vence: "2026-10-01T00:00:00Z" }, ahora)).toMatchObject({ fase: "vencido", dias: -22 });
    const porVencer = estadoCertificado({ ...base, motivo: "listo", certificado_vence: "2026-11-10T12:00:00Z" }, ahora);
    expect(porVencer).toMatchObject({ fase: "por_vencer", dias: 19 });
    expect(factura(porVencer)).toBe(true);
    expect(estadoCertificado({ ...base, motivo: "listo", certificado_vence: "2028-10-22T12:00:00Z" }, ahora).fase).toBe("listo");
    expect(factura(estadoCertificado({ ...base, motivo: "falta_verificar" }, ahora))).toBe(false);
  });

  it("los pasos en ARCA dependen del ambiente y de si es renovación", () => {
    const prod = pasosEnArca("produccion");
    expect(prod.map(p => p.titulo)).toEqual(["Creá el certificado en ARCA", "Asocialo a Facturación Electrónica"]);
    expect(prod[0].detalle.join(" ")).toContain("Agregar alias");
    expect(pasosEnArca("produccion", true)[0].detalle.join(" ")).toContain("no hay que repetirla");
    expect(pasosEnArca("homologacion")[0].detalle.join(" ")).toContain("WSASS");
    expect(tipoDePuntoDeVenta("monotributo")).toContain("Monotributo");
    expect(tipoDePuntoDeVenta("responsable_inscripto")).toContain("RECE");
  });
});
