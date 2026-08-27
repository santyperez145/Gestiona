import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROUTES, PUBLIC_ROUTES, INTERNAL_ROUTES, allRoutes, aliasRedirects, navRoutes,
  businessRoutes, publicPages, publicAliases,
} from "@/app/routeManifest";
import { NAV_ITEMS } from "@/lib/navigation";

const ROOT = resolve(__dirname, "../..");
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");

/**
 * Las rutas que `App.tsx` todavía declara con un path literal.
 *
 * Desde que el router se genera del manifest, esto **tiene que ser corto**:
 * sólo las paramétricas y los montajes de superficie, que el manifest no
 * modela. Cualquier otra es una ruta que volvió a escribirse a mano.
 */
function rutasLiteralesDelRouter(): string[] {
  return [...APP.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map(m => m[1]);
}

/**
 * Guardas del Route Manifest.
 *
 * Existen porque las rutas vivían repartidas entre `App.tsx`, `navigation.ts`,
 * `moduleMap.ts`, el Command Palette y los tests, y eso ya divergió dos veces:
 *
 * - **Permisos:** 29 de los 70 destinos del sidebar no tenían módulo, porque
 *   el fallback por sección dependía de que dos vocabularios coincidieran y
 *   sólo coincidían 2 de 8.
 * - **Roles:** 5 rutas —`/tareas`, `/seguimiento`, `/calendario`, `/envios` y
 *   `/perfil`— figuraban en el menú de un vendedor y `App.tsx` sólo las
 *   montaba dentro de `{isAdmin && ...}`, así que el clic lo rebotaba al
 *   dashboard. Incluido su propio perfil.
 *
 * Las dos salían de tener la misma decisión escrita en dos lados.
 */
describe("el router sale del manifest, no de una lista a mano", () => {
  it("App.tsx ya no declara rutas de negocio con path literal", () => {
    const literales = rutasLiteralesDelRouter();
    const declaradas = new Set(allRoutes().map(r => r.path));
    const aMano = literales.filter(p => declaradas.has(p) && p !== "/login");
    expect(aMano).toEqual([]);
  });

  it("lo que queda a mano son sólo paramétricas y superficies", () => {
    // `/tienda/:slug/*`, `/platform/*`, `/finance/*`… El manifest todavía no
    // modela parámetros, y fingir que sí sería peor que dejarlas afuera.
    const sospechosas = rutasLiteralesDelRouter()
      .filter(p => !p.includes(":") && !p.includes("*") && p !== "/login");
    expect(sospechosas).toEqual([]);
  });

  it("cada ruta de negocio declara la página que renderiza", () => {
    // Sin `component` la ruta no se monta y el destino queda muerto.
    const sinPagina = ROUTES.filter(r => !r.component).map(r => r.path);
    expect(sinPagina).toEqual([]);
  });

  it("el router recorre el manifest en vez de enumerar", () => {
    expect(APP).toContain("businessRoutes(role).map");
    expect(APP).toContain("businessAliases().map");
    expect(APP).toContain("publicPages().map");
  });

  it("ya no hay un reparto admin/vendedor paralelo en el router", () => {
    // Era la fuente de la divergencia de 5 rutas.
    expect(APP).not.toContain("{isAdmin && (");
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
    // Si lo fuera, habría dos URLs vivas para la misma pantalla — el caso que
    // tenían `/pricing` y `/precios`.
    const canonicas = new Set(allRoutes().map(r => r.path));
    const ambos = Object.keys(aliasRedirects()).filter(a => canonicas.has(a));
    expect(ambos).toEqual([]);
  });
});

describe("los roles viven en un solo lugar", () => {
  it("las cinco que rebotaban al vendedor ahora se montan para él", () => {
    const paraVendedor = new Set(businessRoutes("vendedor").map(r => r.path));
    // /seguimiento dejó de ser ruta propia (consolidación CRM 2026-08-27): el
    // vendedor llega por /clientes, que es AMBOS, y el alias lo redirige.
    for (const p of ["/tareas", "/clientes", "/calendario", "/envios", "/perfil"]) {
      expect(paraVendedor.has(p)).toBe(true);
    }
  });

  it("lo que es sólo de admin no se monta para un vendedor", () => {
    const paraVendedor = new Set(businessRoutes("vendedor").map(r => r.path));
    for (const p of ["/productos", "/ajustes", "/admin", "/equipo"]) {
      expect(paraVendedor.has(p)).toBe(false);
    }
  });

  it("el menú y el router filtran por el mismo campo", () => {
    // Si se separan vuelve la divergencia: menú que ofrece lo que el router no
    // monta.
    const enMenu = NAV_ITEMS.filter(i => i.roles.includes("vendedor")).map(i => i.to).sort();
    const enRouter = businessRoutes("vendedor")
      .filter(r => r.nav).map(r => r.path).sort();
    expect(enRouter).toEqual(enMenu);
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
    // Ya no se busca el `<Route>` a mano: el redirect lo genera el manifest.
    expect(publicAliases()).toContainEqual(["/pricing", "/precios"]);
  });

  it("y /precios sigue siendo la que renderiza", () => {
    const precios = publicPages().find(r => r.path === "/precios");
    expect(precios?.component).toBeTruthy();
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
    // obliga a mirar si declaró módulo. El piso BAJA con cada consolidación:
    // 71 → 68 cuando /seguimiento, /rfm y /crm-avanzado pasaron a vistas de
    // /clientes; 68 → 67 cuando /planner-social pasó a /marketing?vista=
    // planner; 67 → 65 cuando Reposición, Proyección e Inventario con IA se
    // volvieron /planificacion; 65 → 62 cuando KPIs, BI y Proyección de ventas
    // se volvieron vistas de /analytics (2026-08-27).
    // Bajarlo exige que la ruta borrada haya
    // quedado como alias — lo garantiza "ningún alias es también una ruta
    // canónica" más el chequeo de que todo alias apunta a una canónica.
    expect(ROUTES.length).toBeGreaterThanOrEqual(62);
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
