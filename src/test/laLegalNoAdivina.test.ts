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

  it("genera borrador, no publica", () => {
    expect(soloCodigo(panel)).toContain('status: "draft"');
    expect(soloCodigo(panel)).not.toMatch(/status:\s*"published"/);
  });
});
