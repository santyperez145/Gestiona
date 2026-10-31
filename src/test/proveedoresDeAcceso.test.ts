import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleGuardado, googleHabilitado, olvidarProveedoresDeAcceso } from "@/lib/proveedoresDeAcceso";

const respuesta = (cuerpo: unknown, ok = true) => Promise.resolve({ ok, json: async () => cuerpo } as Response);

beforeEach(() => {
  olvidarProveedoresDeAcceso();
  vi.stubEnv("VITE_SUPABASE_URL", "https://zz.supabase.co/");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "zz-clave-publica");
});
afterEach(() => vi.unstubAllEnvs());

describe("el botón de Google sólo aparece si Auth lo tiene habilitado", () => {
  it("pregunta a /auth/v1/settings con la clave pública y recuerda el sí", async () => {
    const fetcher = vi.fn(() => respuesta({ external: { google: true, email: true } }));
    expect(await googleHabilitado(fetcher as unknown as typeof fetch)).toBe(true);
    expect(await googleHabilitado(fetcher as unknown as typeof fetch)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://zz.supabase.co/auth/v1/settings", { headers: { apikey: "zz-clave-publica" } });
  });

  it("deshabilitado, con error o sin red: no se muestra, y se vuelve a preguntar después", async () => {
    expect(await googleHabilitado((() => respuesta({ external: { google: false } })) as unknown as typeof fetch)).toBe(false);
    expect(await googleHabilitado((() => respuesta({}, false)) as unknown as typeof fetch)).toBe(false);
    expect(await googleHabilitado((() => Promise.reject(new Error("sin red"))) as unknown as typeof fetch)).toBe(false);
    expect(await googleHabilitado((() => respuesta({ external: { google: true } })) as unknown as typeof fetch)).toBe(true);
  });

  it("recuerda la respuesta de Auth para arrancar sin corrimiento; un corte de red no la pisa", async () => {
    expect(googleGuardado()).toBe(false);
    await googleHabilitado((() => respuesta({ external: { google: true } })) as unknown as typeof fetch);
    expect(googleGuardado()).toBe(true);
    olvidarProveedoresDeAcceso();
    await googleHabilitado((() => respuesta({ external: { google: true } })) as unknown as typeof fetch);
    await googleHabilitado((() => Promise.reject(new Error("sin red"))) as unknown as typeof fetch);
    expect(googleGuardado()).toBe(true);
  });

  it("sin la URL de Supabase no pregunta", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const fetcher = vi.fn();
    expect(await googleHabilitado(fetcher as unknown as typeof fetch)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("la pantalla de acceso lo usa", () => {
    const pagina = readFileSync("src/pages/AuthPage.tsx", "utf8");
    expect(pagina).toContain("googleHabilitado()");
    expect(pagina).toContain("useState(googleGuardado)");
    expect(pagina).toContain("<div className=\"auth-provider-slot\">");
    expect(pagina).toContain("{conGoogle ? (");
  });
});
