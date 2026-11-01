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
  .map(m => m[1]).find(s => s.includes('getElementById("plantilla-arranque")')) ?? "";

function arrancar(opciones: { host: string; ruta: string; sesion: boolean; tema?: string }) {
  const almacen = new Map<string, string>();
  if (opciones.sesion) almacen.set("sb-zzref-auth-token", "{}");
  if (opciones.tema) almacen.set("gestiona-theme", opciones.tema);
  const claves = [...almacen.keys()];
  const localStorage = { getItem: (k: string) => almacen.get(k) ?? null, key: (i: number) => claves[i] ?? null, get length() { return claves.length; } };
  let clonada = false;
  const clases: string[] = [];
  const elementos: Record<string, unknown> = {
    "plantilla-arranque": { content: { cloneNode: () => ({ pantalla: true }) } },
    root: { appendChild: () => { clonada = true; } },
  };
  const document = { getElementById: (id: string) => elementos[id], documentElement: { classList: { add: (c: string) => clases.push(c) } } };
  const window = { matchMedia: () => ({ matches: false }) };
  new Function("location", "localStorage", "document", "window", script)({ hostname: opciones.host, pathname: opciones.ruta }, localStorage, document, window);
  return { visible: clonada, clases };
}

describe("una sola pantalla de carga al entrar", () => {
  it("el HTML trae la pantalla de arranque oculta, igual a AppLoader", () => {
    expect(script).not.toBe("");
    // En un <template>: el HTML de una tienda no lleva la marca ni oculta.
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<template id="plantilla-arranque"><div id="arranque" class="app-boot-shell min-h-screen flex items-center justify-center"');
    expect(html).toContain("Cargando Nerqia...");
    expect(readFileSync("src/components/shared/AppLoader.tsx", "utf8")).toContain('label = "Cargando Nerqia..."');
  });

  it("se ve en el panel con sesión; nunca en una tienda, su dominio, la landing o sin sesión", () => {
    expect(arrancar({ host: "nerqia.app", ruta: "/productos", sesion: true }).visible).toBe(true);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true }).visible).toBe(true);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: false }).visible).toBe(false);
    expect(arrancar({ host: "nerqia.app", ruta: "/tienda/zz-e2e/", sesion: true }).visible).toBe(false);
    expect(arrancar({ host: "www.ferreteriazz.com.ar", ruta: "/productos", sesion: true }).visible).toBe(false);
    // La tienda en subdominio es del comercio, aunque el comprador tenga sesión.
    expect(arrancar({ host: "famatina.nerqia.app", ruta: "/", sesion: true }).visible).toBe(false);
    expect(arrancar({ host: "www.nerqia.app", ruta: "/ventas", sesion: true }).visible).toBe(true);
    expect(arrancar({ host: "nerqia.app", ruta: "/precios", sesion: true }).visible).toBe(false);
  });

  it("aplica el tema antes del primer dibujo", () => {
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true, tema: "dark" }).clases).toEqual(["dark"]);
    expect(arrancar({ host: "nerqia.app", ruta: "/", sesion: true }).clases).toEqual(["light"]);
  });

  it("entrar no es cambiar de organización, y el cargador es uno solo", () => {
    expect(app).toContain('const ambitoDe = (orgId: string | undefined) => (!orgId || orgId === primeraOrg.current ? "inicial" : orgId);');
    // En tiendas y páginas públicas el cargador no lleva la marca Nerqia.
    expect(app).toContain("<Suspense fallback={esSuperficiePublica() ? <PageLoader /> : <AppLoader />}>");
    expect(app).toContain("return esRutaPublica(pathname) || Boolean(storeSlugFromHostname(hostname)) || isPotentialCustomStoreHostname(hostname);");
    expect(app).not.toMatch(/<AppLoader label="Verificando acceso/);
    expect(readFileSync("src/components/auth/MfaGate.tsx", "utf8")).toContain('if (state === "checking") return <AppLoader />;');
  });
});
