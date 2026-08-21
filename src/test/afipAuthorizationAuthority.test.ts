import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260821000048_afip_authorization_guard.sql");
const fn = leer("supabase/functions/afip-authorize/index.ts");
const ui = leer("src/pages/InvoicesPage.tsx");

describe("autoridad de autorización ARCA", () => {
  it("reserva el número por organización, punto de venta y tipo", () => {
    expect(migracion).toContain("afip_authorization_locks");
    expect(migracion).toContain("PRIMARY KEY (org_id, punto_venta, tipo_cbte)");
    expect(migracion).toContain("pg_advisory_xact_lock");
  });

  it("la reserva vuelve a comprobar el rol dentro de la base", () => {
    expect(migracion).toContain("has_org_role(");
    expect(migracion).toContain("ARRAY['owner', 'admin']");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.afip_autorizacion_reservar");
  });

  it("un CAE existente es una lectura idempotente", () => {
    expect(migracion).toContain("'idempotent', true");
    expect(fn).toContain('status: "authorized"');
    expect(fn).toContain("afip_autorizacion_reservar");
  });

  it("los caminos de éxito y error usan la misma transición", () => {
    expect(fn).toContain('"afip_autorizacion_resultado"');
    expect(fn).not.toMatch(/\.from\("invoices"\)[\s\S]{0,160}\.update\(/);
    expect(migracion).toContain("p_status = 'processing'");
    expect(migracion).toContain("p_status <> 'processing'");
  });

  it("un timeout no libera de inmediato la reserva", () => {
    expect(fn).toContain('afipStatus === "network_error" ? "processing"');
    expect(migracion).toContain("SET expires_at = now() + interval '15 minutes'");
    expect(ui).toContain("inv.afip_status === \"processing\"");
  });

  it("la UI no puede marcar un rechazo escribiendo la factura desde el navegador", () => {
    const inicio = ui.indexOf("const handleAuthorizeAfip");
    const fin = ui.indexOf("/**", inicio);
    const handler = ui.slice(inicio, fin > inicio ? fin : inicio + 3000);
    expect(handler).not.toContain('from("invoices").update');
    expect(handler).toContain("La autorización quedó en verificación");
  });

  it("la función sólo permite autorizar a owner/admin", () => {
    const inicio = fn.indexOf("// Verify the same write role");
    const fin = fn.indexOf("const resuelto", inicio);
    const bloque = fn.slice(inicio, fin);
    expect(bloque).toContain('.in("role", ["owner", "admin"])');
  });
});
