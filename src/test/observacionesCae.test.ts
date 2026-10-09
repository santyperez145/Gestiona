import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("observaciones de ARCA con CAE otorgado", () => {
  it("afip-authorize las guarda después de registrar la autorización", () => {
    const edge = readFileSync("supabase/functions/afip-authorize/index.ts", "utf8");
    const finaliza = edge.indexOf('"afip_autorizacion_resultado"');
    const registra = edge.indexOf('supabase.rpc("afip_registrar_observaciones"');
    expect(finaliza).toBeGreaterThan(0);
    expect(registra).toBeGreaterThan(finaliza);
    expect(edge).toContain("observaciones: respuesta.observaciones");
  });

  it("sólo el servicio las escribe y la factura las muestra", () => {
    const sql = readFileSync("supabase/migrations/20261009001400_observaciones_cae.sql", "utf8");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.afip_registrar_observaciones(uuid, jsonb) TO service_role;");
    expect(sql).toContain("WHERE id = p_invoice_id AND cae IS NOT NULL AND afip_observaciones IS NULL;");
    const page = readFileSync("src/pages/InvoicesPage.tsx", "utf8");
    expect(page).toContain("ARCA autorizó con observaciones");
  });
});
