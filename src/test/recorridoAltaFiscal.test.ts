import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pasosHechos, recorridoAltaFiscal } from "@/lib/recorridoAltaFiscal";
import type { ComprobanteFiscalSalud, ConexionFiscal } from "@/lib/fiscalHealth";

const conexion = (over: Partial<ConexionFiscal>): ConexionFiscal => ({
  cuit: null, razon_social: null, punto_venta: null, domicilio: null, ingresos_brutos: null,
  inicio_actividades: null, environment: "homologacion", configured: false, motivo: null, delegacion_verificada: false, ...over,
});
const emisor = { cuit: "20123456789", razon_social: "ZZ SA", domicilio: "Calle 1" };
const cae = { cae: "123", afip_status: "authorized", issue_date: "2026-10-10" } as unknown as ComprobanteFiscalSalud;

const estados = (c: ConexionFiscal | null, comprobantes: ComprobanteFiscalSalud[] = []) =>
  recorridoAltaFiscal(c, comprobantes).map(p => `${p.id}:${p.estado}`);

describe("recorrido único de alta fiscal", () => {
  it("sin datos, el primer paso es el emisor y el resto espera", () => {
    expect(estados(null)).toEqual(["emisor:actual", "delegacion:pendiente", "punto:pendiente", "prueba:pendiente", "produccion:pendiente"]);
  });

  it("avanza de a un paso con los mismos datos de la salud fiscal", () => {
    expect(estados(conexion(emisor))[1]).toBe("delegacion:actual");
    expect(estados(conexion({ ...emisor, delegacion_verificada: true }))[2]).toBe("punto:actual");
    expect(estados(conexion({ ...emisor, delegacion_verificada: true, punto_venta: 3 }))[3]).toBe("prueba:actual");
    expect(estados(conexion({ ...emisor, delegacion_verificada: true, punto_venta: 3 }), [cae])[4]).toBe("produccion:actual");
  });

  it("producción cuenta sólo con un CAE otorgado, y entonces está todo listo", () => {
    const listo = recorridoAltaFiscal(conexion({ ...emisor, delegacion_verificada: true, punto_venta: 3, environment: "produccion" }), [cae]);
    expect(pasosHechos(listo)).toBe(5);
    const sinCae = recorridoAltaFiscal(conexion({ ...emisor, delegacion_verificada: true, punto_venta: 3, environment: "produccion" }), []);
    expect(sinCae.find(p => p.id === "produccion")?.estado).toBe("pendiente");
  });

  it("la página lo muestra arriba y cada paso lleva a su sección", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/AFIPPage.tsx"), "utf8");
    expect(page).toContain("<RecorridoAltaFiscal pasos={pasosAlta} />");
    expect(page).toContain('id="conectar-arca"');
    expect(page).toContain('id="datos-fiscales"');
    expect(page.indexOf("<RecorridoAltaFiscal")).toBeLessThan(page.indexOf("<ConectarAfip"));
  });
});
