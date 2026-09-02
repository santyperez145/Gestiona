import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const form = leer("src/components/afip/AfipConfigForm.tsx");
const page = leer("src/pages/AFIPPage.tsx");
const migracion = leer("supabase/migrations/20260901000070_identidad_fiscal_completa.sql");

const soloCodigo = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Conectar AFIP pide el domicilio una vez, en la autoridad.
 *
 * El campo ya estaba en el formulario y `save_afip_config` lo aceptaba
 * vacío. Facturas y las páginas legales leen la misma vista: un comercio
 * "conectado" seguía sin decir dónde vende.
 */
describe("conectar AFIP pide el domicilio fiscal", () => {
  it("el formulario no manda domicilio vacío a la RPC", () => {
    const codigo = soloCodigo(form);
    expect(codigo).toContain("mensajeIdentidadFiscalFaltante");
    expect(codigo).toContain("p_domicilio: domicilio.trim()");
    expect(codigo).not.toContain("p_domicilio: domicilio || null");
    expect(codigo).toContain("identidadIncompleta");
  });

  it("la autoridad rechaza razón social y domicilio vacíos, misma firma", () => {
    expect(migracion).toContain("Falta el domicilio fiscal");
    expect(migracion).toContain("Falta la razón social");
    expect(migracion).toMatch(
      /save_afip_config\(\s*uuid,\s*text,\s*integer,\s*text,\s*text,\s*text,\s*text\s*\)/,
    );
    expect(migracion).toContain("exigir_permiso");
    expect(migracion).not.toMatch(/UPDATE\s+public\.afip_credentials/i);
  });

  it("Facturas pide el domicilio y no lo mete en configured", () => {
    const codigo = soloCodigo(page);
    expect(codigo).toContain("domicilio");
    expect(codigo).toContain("Falta el domicilio fiscal");
    expect(codigo).toMatch(/select\([^)]*domicilio/);
    expect(codigo).not.toMatch(/configured\s*[:=][^\n]*domicilio/);
  });

  it("las páginas legales siguen en borrador", () => {
    const panel = soloCodigo(leer("src/components/ecommerce/LegalPagesPanel.tsx"));
    expect(panel).toContain('status: "draft"');
    expect(panel).not.toMatch(/status:\s*"published"/);
  });
});
