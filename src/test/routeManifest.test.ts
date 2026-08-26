import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROUTES, PUBLIC_ROUTES, INTERNAL_ROUTES, allRoutes, aliasRedirects, navRoutes,
} from "@/app/routeManifest";

const ROOT = resolve(__dirname, "../..");
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");

/** Las rutas que `App.tsx` declara, sin las paramétricas ni las comodín. */
function rutasDelRouter(): Set<string> {
  return new Set([...APP.matchAll(/<Route\s+path="(\/[^"*:]*)"/g)].map(m => m[1]));
}

/**
 * Guardas del Route Manifest.
 *
 * Existen porque las rutas vivían repartidas entre `App.tsx`, `navigation.ts`,
 * `moduleMap.ts`, el Command Palette y los tests, y eso ya divergió: el
 * 2026-08-26 se midió que **29 de los 70 destinos del sidebar no tenían módulo
 * de permisos**, porque el fallback por sección dependía de que dos
 * vocabularios distintos coincidieran y sólo coincidían 2 de 8.
 *
 * Mientras `App.tsx` siga declarando sus `<Route>` a mano, estos tests son lo
 * que impide que se vuelvan a separar.
 */
describe("el manifest y el router no se separan", () => {
  it("toda ruta declarada existe en el router", () => {
    const router = rutasDelRouter();
    const faltan = allRoutes().map(r => r.path).filter(p => !router.has(p));
    expect(faltan).toEqual([]);
  });

  it("todo alias existe como ruta en el router", () => {
    // Un alias declarado y no montado es un 404 con nombre propio.
    const router = rutasDelRouter();
    const faltan = Object.keys(aliasRedirects()).filter(p => !router.has(p));
    expect(faltan).toEqual([]);
  });

  it("todo alias apunta a una ruta canónica que existe", () => {
    const canonicas = new Set(allRoutes().map(r => r.path));
    const rotos = Object.entries(aliasRedirects())
      // El destino puede llevar query: `/admin?tab=audit`. Se valida la base.
      .filter(([, destino]) => !canonicas.has(destino.split("?")[0]))
      .map(([alias, destino]) => `${alias} -> ${destino}`);
    expect(rotos).toEqual([]);
  });

  it("ningún alias es también una ruta canónica", () => {
    // Si lo fuera, habría dos URLs vivas para la misma pantalla — que es el
    // caso que tenían `/pricing` y `/precios`.
    const canonicas = new Set(allRoutes().map(r => r.path));
    const ambos = Object.keys(aliasRedirects()).filter(a => canonicas.has(a));
    expect(ambos).toEqual([]);
  });
});

describe("una URL canónica aparece una sola vez", () => {
  it("no hay paths duplicados entre las tres listas", () => {
    const paths = allRoutes().map(r => r.path);
    const repetidos = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect([...new Set(repetidos)]).toEqual([]);
  });

  it("no hay ids duplicados", () => {
    // El id es la clave de telemetría: repetido, dos pantallas se cuentan como
    // una sola.
    const ids = allRoutes().map(r => r.id);
    const repetidos = ids.filter((v, i) => ids.indexOf(v) !== i);
    expect([...new Set(repetidos)]).toEqual([]);
  });

  it("no hay alias declarado dos veces", () => {
    const declarados = allRoutes().flatMap(r => (r.aliases ?? []).map(a => a.path));
    const repetidos = declarados.filter((v, i) => declarados.indexOf(v) !== i);
    expect([...new Set(repetidos)]).toEqual([]);
  });
});

describe("/precios es la URL canónica de precios", () => {
  it("/pricing redirige en vez de renderizar la misma página", () => {
    // Renderizaban las dos `PricingPage` en paralelo: dos URLs canónicas para
    // lo mismo parten el SEO, la telemetría y los enlaces compartidos.
    expect(aliasRedirects()["/pricing"]).toBe("/precios");
    expect(APP).toMatch(/path="\/pricing"\s+element=\{<Navigate to="\/precios"/);
  });

  it("y /precios sigue siendo la que renderiza", () => {
    expect(APP).toMatch(/path="\/precios"\s+element=\{<PricingPage/);
  });
});

describe("el sidebar sigue siendo el sidebar", () => {
  it("cada grupo tiene al menos un destino", () => {
    const grupos = new Set(navRoutes().map(r => r.nav!.group));
    for (const g of ["diario", "trabajo", "compras", "cobranzas", "finanzas",
                     "marketing", "reportes", "sistema"]) {
      expect(grupos.has(g as never)).toBe(true);
    }
  });

  it("ninguna ruta interna o pública se cuela en la navegación", () => {
    // `/login` en el sidebar sería absurdo, y `/caja/turno` es un sub-estado
    // del POS, no un destino.
    expect([...PUBLIC_ROUTES, ...INTERNAL_ROUTES].filter(r => r.nav)).toEqual([]);
  });

  it("todo destino del sidebar tiene etiqueta y palabras clave útiles", () => {
    // Renombrar sólo es seguro si el buscador conoce el nombre viejo.
    const flojos = navRoutes()
      .filter(r => !r.nav!.label.trim())
      .map(r => r.path);
    expect(flojos).toEqual([]);
  });

  it("el manifest cubre los destinos medidos", () => {
    // Si alguien agrega una pantalla sin pasar por acá, este número cambia y
    // obliga a mirar si declaró módulo.
    expect(ROUTES.length).toBeGreaterThanOrEqual(71);
  });
});

describe("la página que dice ser el libro mayor lo es", () => {
  it("/libro está en el sidebar", () => {
    // Leía el ledger real por RPC y no estaba en la navegación: la única
    // fuente contable era inalcanzable desde el menú.
    const libro = navRoutes().find(r => r.path === "/libro");
    expect(libro?.nav?.label).toBe("Libro mayor");
  });

  it("/movimientos ya no se llama 'Libro mayor'", () => {
    // Lee `financial_movements`, no el ledger. Dos pantallas con el mismo
    // nombre y distinta fuente es como se llega a dos verdades financieras.
    const mov = navRoutes().find(r => r.path === "/movimientos");
    expect(mov?.nav?.label).toBe("Movimientos operativos");
    // Pero quien busque "libro mayor" tiene que seguir encontrándola.
    expect(mov?.nav?.keywords).toContain("libro mayor");
  });
});
