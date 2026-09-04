import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const migration = read("supabase/migrations/20260903000090_factura_identidad_fiscal_inmutable.sql");
const invoices = read("src/pages/InvoicesPage.tsx");
const config = read("src/components/afip/AfipConfigForm.tsx");

describe("factura profesional ARCA", () => {
  it("congela la identidad fiscal antes de pedir autorización", () => {
    expect(migration).toContain("snapshot_identidad_fiscal_factura");
    for (const field of [
      "emisor_razon_social",
      "emisor_cuit",
      "emisor_domicilio",
      "emisor_condicion_iva",
      "emisor_ingresos_brutos",
      "emisor_inicio_actividades",
      "punto_venta",
      "receptor_tipo_documento",
      "moneda_cotizacion",
      "arca_qr_payload",
    ]) expect(migration).toContain(field);
    expect(migration).toContain("NEW.afip_status = 'processing'");
    expect(migration).toContain("fiscal_snapshot_source := 'authorization'");
  });

  it("impide modificar también el snapshot de una factura con CAE", () => {
    expect(migration).toContain("trg_factura_autorizada_inmutable");
    expect(migration).toContain("NEW.emisor_razon_social IS DISTINCT FROM OLD.emisor_razon_social");
    expect(migration).toContain("NEW.arca_qr_payload IS DISTINCT FROM OLD.arca_qr_payload");
  });

  it("la configuración captura los datos visibles exigidos para producción", () => {
    expect(config).toContain("Ingresos Brutos");
    expect(config).toContain("Inicio de actividades");
    expect(config).toContain("p_ingresos_brutos");
    expect(config).toContain("p_inicio_actividades");
    expect(migration).toContain("p_environment = 'produccion'");
    expect(migration).toContain("Falta Ingresos Brutos");
  });

  it("el PDF dibuja un QR real y no imprime el viejo link de AFIP", () => {
    expect(invoices).toContain("QRCode.toDataURL");
    expect(invoices).toContain("doc.addImage(qrDataUrl");
    expect(invoices).toContain("QR oficial ARCA");
    expect(invoices).not.toContain("https://www.afip.gob.ar/fe/qr/");
  });

  it("homologación queda visible y no se presenta como factura productiva", () => {
    expect(invoices).toContain("HOMOLOGACIÓN · COMPROBANTE DE PRUEBA SIN VALOR FISCAL");
    expect(invoices).toContain("Homologación: comprobante de prueba sin valor fiscal.");
  });
});
