import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const panel = readFileSync(resolve(ROOT, "src/components/ecommerce/LegalPagesPanel.tsx"), "utf8");

const soloCodigo = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Las páginas legales no adivinan la identidad del comercio.
 *
 * Facturas lee `afip_connection_status`. El panel legales leía `settings.afip_*`
 * (espejo) y usaba `business_name` como razón social. Un workspace llamado
 * «pruebas» quedaba identificado como si alguien hubiera declarado esa firma.
 * El email de avisos de la tienda se tiraba a `""` aunque ya estuviera cargado.
 */
describe("las páginas legales no adivinan quién vende", () => {
  it("el emisor sale de la misma vista que Facturas", () => {
    const codigo = soloCodigo(panel);
    expect(codigo).toContain("afip_connection_status");
    expect(codigo).toContain("semillaLegalDelComercio");
    expect(codigo).toContain("notification_email");
    expect(codigo).toContain("domicilio");
    expect(codigo).not.toContain("afip_razon_social");
    expect(codigo).not.toContain("afip_cuit");
  });

  it("no siembra «nuestra tienda» ni borra el email de avisos", () => {
    const codigo = soloCodigo(panel);
    expect(codigo).not.toContain("nuestra tienda");
    expect(codigo).not.toMatch(/emailContacto:\s*""/);
    expect(codigo).toContain("semillaLegalDelComercio");
  });

  it("genera borrador; publicar es un acto confirmado del comercio", () => {
    const codigo = soloCodigo(panel);
    expect(codigo).toContain('status: "draft"');
    // Una sola escritura de «published», detrás de la confirmación de lectura.
    expect(codigo.match(/status:\s*"published"/g) ?? []).toHaveLength(1);
    expect(codigo).toContain("!leido");
  });

  it("si AFIP ya empezó, sincroniza razón y domicilio al generar", () => {
    const codigo = soloCodigo(panel);
    expect(codigo).toContain("puedeSincronizarIdentidadFiscal");
    expect(codigo).toContain("save_afip_config");
    expect(codigo).toContain("punto_venta");
    // Sin desvío a Facturas (2026-11-03): sacaba al comercio del camino guiado.
    expect(codigo).not.toContain('to="/afip"');
  });

  it("los borradores se abren en el editor para leerlos", () => {
    const codigo = soloCodigo(panel);
    expect(codigo).toContain("onAbrirPagina");
    expect(codigo).toContain("Leer {pagina.title");
  });
});
