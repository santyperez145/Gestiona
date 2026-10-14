import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ADR 006, acciones 4 y 5. El 2026-10-14 dos auditores críticos se habían
// corrido sin que nadie lo viera (13 funciones sin contrato, una política
// abierta sin declarar). Ahora los corre un cron y avisa en Errores de la app.
const sql = fs.readFileSync("supabase/migrations/20261014000100_auditoria_de_seguridad_diaria.sql", "utf8");

describe("auditoría de seguridad diaria", () => {
  it("corre los cinco auditores críticos y las políticas abiertas no declaradas", () => {
    for (const a of ["audit_funciones_expuestas", "audit_costo_expuesto", "audit_policies_sin_tenant", "audit_rpc_sin_permiso", "audit_vistas_abiertas"]) {
      expect(sql).toContain(`'${a}'`);
    }
    expect(sql).toContain("FROM public.rls_audit_open_policies WHERE NOT (tablename = ANY (c_abiertas_declaradas))");
  });

  it("las políticas abiertas declaradas coinciden con SEGURIDAD.md", () => {
    const declaradas = sql.match(/c_abiertas_declaradas constant text\[\] := ARRAY\[([^\]]+)\]/)![1].match(/'([a-z_]+)'/g)!.map(x => x.slice(1, -1));
    const seguridad = fs.readFileSync("docs/SEGURIDAD.md", "utf8");
    for (const t of declaradas) expect(seguridad).toContain(`\`${t}\``);
    expect(declaradas).toHaveLength(4);
  });

  it("deja los hallazgos en app_errores, queda programada y no se ejecuta desde el navegador", () => {
    expect(sql).toContain("INSERT INTO public.app_errores");
    expect(sql).toContain("cron.schedule('auditoria-de-seguridad-diaria'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.auditoria_de_seguridad_diaria() FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON public.audit_vistas_abiertas FROM anon, authenticated");
  });

  it("cada contrato nuevo explica su público con un motivo real", () => {
    const filas = [...sql.matchAll(/\('([a-z_]+)', '(public_storefront|authenticated_delegate)', '([^']+)'\)/g)];
    expect(filas).toHaveLength(13);
    for (const f of filas) expect(f[3].length).toBeGreaterThanOrEqual(20);
  });
});
