import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * «Al ingresar hay como 4 recargas» (el dueño, 2026-11-01). Causas: la primera
 * organización se trataba como un cambio de organización (caché borrada y app
 * remontada), y cada etapa del arranque tenía su propio cargador.
 */
const html = readFileSync("index.html", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('getElementById("arranque")')) ?? "";

function arrancar(opciones: { host: string; ruta: string; sesion: boolean; tema?: string }) {
  const almacen = new Map<string, string>();
  if (opciones.sesion) almacen.set("sb-zzref-auth-token", "{}");
  if (opciones.tema) almacen.set("gestiona-theme", opciones.tema);
  const claves = [...almacen.keys()];
  const localStorage = { getItem: (k: string) => almacen.get(k) ?? null, key: (i: number) => claves[i] ?? null, get length() { return claves.length; } };
  const arranque = { style: { display: "none" } };
  const clases: string[] = [];
  const document = { getElementById: () => arranque, documentElement: { classList: { add: (c: string) => clases.push(c) } } };
  const window = { matchMedia: () => ({ matches: false }) };
  new Function("location", "localStorage", "document", "window", script)({ hostname: opciones.host, pathname: opciones.ruta }, localStorage, document, window);
  return { visible: arranque.style.display === "", clases };
}

describe("una sola pantalla de carga al entrar", () => {
  it("el HTML trae la pantalla de arranque oculta, igual a AppLoader", () => {
    expect(script).not.toBe("");
    expect(html).toContain('<div id="arranque" class="app-boot-shell min-h-screen flex items-center justify-center" style="display:none"');
    expect(html).toContain("Cargando Nerqia...");
    expect(readFileSync("src/components/shared/AppLoader.tsx", "utf8")).toContain('label = "Cargando Nerqia..."');
  });

  it("se ve en el panel con sesión; nunca en una tienda, su dominio, la landing o sin sesión", () => {
    expect(arrancar({ host: "nerqia.app", ruta: "/productos", sesion: true }).visible).toBe(true);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true }).visible).toBe(true);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: false }).visible).toBe(false);
    expect(arrancar({ host: "nerqia.app", ruta: "/tienda/zz-e2e/", sesion: true }).visible).toBe(false);
    expect(arrancar({ host: "www.ferreteriazz.com.ar", ruta: "/productos", sesion: true }).visible).toBe(false);
    expect(arrancar({ host: "nerqia.app", ruta: "/precios", sesion: true }).visible).toBe(false);
  });

  it("aplica el tema antes del primer dibujo", () => {
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true, tema: "dark" }).clases).toEqual(["dark"]);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true }).clases).toEqual(["light"]);
  });

  it("entrar no es cambiar de organización, y el cargador es uno solo", () => {
    expect(app).toContain('const ambitoDe = (orgId: string | undefined) => (!orgId || orgId === primeraOrg.current ? "inicial" : orgId);');
    expect(app).toContain("<Suspense fallback={<AppLoader />}>\n              <OrganizationScope />");
    expect(app).not.toMatch(/<AppLoader label="Verificando acceso/);
    expect(readFileSync("src/components/auth/MfaGate.tsx", "utf8")).toContain('if (state === "checking") return <AppLoader />;');
  });
});
