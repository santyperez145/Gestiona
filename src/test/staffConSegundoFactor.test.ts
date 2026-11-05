import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Staff de plataforma con segundo factor (2026-11-05). El panel pedía el
 * código, pero la base y las funciones edge aceptaban una sesión con la
 * contraseña sola: una contraseña de staff filtrada abría todos los comercios.
 */
const leer = (f: string) => readFileSync(f, "utf8");
const migracion = leer("supabase/migrations/20261105000800_staff_con_segundo_factor.sql");

describe("el staff de plataforma opera con segundo factor", () => {
  it("la base no acepta como staff a una sesión aal1 del propio usuario", () => {
    expect(migracion).toContain("FUNCTION public.is_platform_admin(_user_id uuid)");
    expect(migracion).toContain("FUNCTION public.has_platform_role(_roles text[], _user_id uuid DEFAULT auth.uid())");
    expect(migracion.split("AND NOT (_user_id IS NOT DISTINCT FROM auth.uid() AND public.sesion_sin_segundo_factor())").length - 1).toBe(2);
    expect(migracion).toContain("->> 'aal', '') = 'aal1'");
  });

  it("las funciones que verifican el rol con la llave de servicio exigen aal2", () => {
    for (const f of ["platform-admin-action", "afip-platform-cert", "afip-authorize"]) {
      expect(leer(`supabase/functions/${f}/index.ts`), f).toContain("sesionConSegundoFactor(req,");
    }
    expect(leer("supabase/functions/_shared/staffConSegundoFactor.ts")).toContain('claims?.aal === "aal2"');
  });

  it("Plataforma no ofrece ni canjea «recordar este dispositivo»", () => {
    expect(leer("src/App.tsx")).toContain("<MfaGate isAdmin orgRequiresMfa permitirRecordar={false}>");
    const gate = leer("src/components/auth/MfaGate.tsx");
    expect(gate).toContain('decision === "needs_code" && permitirRecordar && canRememberDevice()');
    expect(gate).toContain("const rememberControl = permitirRecordar && canRememberDevice()");
  });
});
