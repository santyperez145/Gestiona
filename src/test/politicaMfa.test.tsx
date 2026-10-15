import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const respuesta = vi.hoisted(() => ({ cola: [] as Array<{ data: unknown; error: unknown } | Error> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => {
      const r = respuesta.cola.shift() ?? { data: null, error: null };
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    } }) }) }),
  },
}));
import { usePoliticaMfa } from "@/hooks/usePoliticaMfa";

// 2026-10-15: el panel fallaba abierto si no podía leer la política.
describe("política de segundo factor", () => {
  beforeEach(() => { respuesta.cola = []; });
  it("mientras no se sabe, espera y no deja pasar sin verificar", () => {
    respuesta.cola = [{ data: { mfa_required: false }, error: null }];
    const { result } = renderHook(() => usePoliticaMfa("org-1"));
    expect(result.current).toEqual({ cargando: true, requerido: true });
  });
  it("lee la política real", async () => {
    respuesta.cola = [{ data: { mfa_required: false }, error: null }];
    const { result } = renderHook(() => usePoliticaMfa("org-1"));
    await waitFor(() => expect(result.current).toEqual({ cargando: false, requerido: false }));
  });
  it("un error pasajero se reintenta; si persiste, exige el segundo factor", async () => {
    respuesta.cola = [{ data: null, error: { message: "fetch failed" } }, { data: { mfa_required: false }, error: null }];
    const a = renderHook(() => usePoliticaMfa("org-1"));
    await waitFor(() => expect(a.result.current).toEqual({ cargando: false, requerido: false }), { timeout: 3000 });
    respuesta.cola = [new Error("red"), new Error("red"), new Error("red")];
    const b = renderHook(() => usePoliticaMfa("org-2"));
    await waitFor(() => expect(b.result.current).toEqual({ cargando: false, requerido: true }), { timeout: 5000 });
  }, 10_000);
  it("las tres entradas usan la misma lectura", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app.match(/usePoliticaMfa\(activeOrg\?\.id\)/g)).toHaveLength(3);
    expect(app).not.toContain("select('mfa_required')");
  });
});
