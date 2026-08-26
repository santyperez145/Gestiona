import { describe, it, expect } from "vitest";
import { moduleForRoute } from "@/lib/moduleMap";
import { NAV_ITEMS } from "@/lib/navigation";
import { allRoutes, moduleForPath } from "@/app/routeManifest";
import {
  isPermissionModule, PERMISSION_MODULES, PERMISSION_MODULE_LABEL,
} from "@/lib/permissionModules";

/**
 * ⚠️ Por qué este test cambió entero.
 *
 * La versión anterior verificaba el fallback por sección así:
 *
 *     expect(moduleForRoute("/kardex", "inventario")).toBe("inventory");
 *
 * y pasaba en verde. El problema es que **ningún código llamaba con
 * `"inventario"`**: `AppLayout` pasa el grupo de la navegación, que para esa
 * ruta es `"compras"`. El test comprobaba la coherencia del mapa consigo
 * mismo, no con la app, así que el mapa pudo divergir de la navegación durante
 * meses sin que nada fallara.
 *
 * Medido el 2026-08-26 antes de arreglarlo: **29 de los 70 destinos del
 * sidebar resolvían a `""`** —sin restricción—, incluidos `/ventas`,
 * `/ajustes`, `/kardex`, `/deudas` y `/analytics`.
 *
 * Ahora se verifica contra los destinos reales, no contra parámetros
 * inventados.
 */
describe("moduleForRoute", () => {
  it("resuelve el módulo declarado en el manifest", () => {
    expect(moduleForRoute("/productos")).toBe("products");
    expect(moduleForRoute("/clientes")).toBe("customers");
    expect(moduleForRoute("/caja")).toBe("pos");
  });

  it("ya no depende de la sección: el segundo parámetro se ignora", () => {
    // Cualquier valor da lo mismo. Un fallback que dependía de que dos
    // vocabularios no se separaran fue exactamente lo que falló.
    expect(moduleForRoute("/kardex", "inventario")).toBe("inventory");
    expect(moduleForRoute("/kardex", "compras")).toBe("inventory");
    expect(moduleForRoute("/kardex", "cualquier-cosa")).toBe("inventory");
    expect(moduleForRoute("/kardex")).toBe("inventory");
  });

  it("las rutas que estaban sin restringir ahora tienen módulo", () => {
    // Las cinco que más dolían: apagar su módulo no hacía nada.
    expect(moduleForRoute("/ventas")).toBe("sales");
    expect(moduleForRoute("/ajustes")).toBe("settings");
    expect(moduleForRoute("/deudas")).toBe("sales");
    expect(moduleForRoute("/analytics")).toBe("analytics");
    expect(moduleForRoute("/proveedores")).toBe("purchases");
  });

  it("una ruta desconocida no se restringe, pero tampoco se inventa un módulo", () => {
    expect(moduleForRoute("/ruta-que-no-existe")).toBe("");
  });
});

describe("el manifest no deja rutas sin decidir", () => {
  it("todo destino del sidebar está declarado", () => {
    const sinDeclarar = NAV_ITEMS.filter(i => !allRoutes().some(r => r.path === i.to));
    expect(sinDeclarar.map(i => i.to)).toEqual([]);
  });

  it("una ruta abierta tiene que decir por qué", () => {
    // Sin esto, `module: null` es indistinguible de un olvido — y el olvido es
    // justamente lo que dejó 29 destinos sin permiso.
    const abiertasSinMotivo = allRoutes()
      .filter(r => r.module === null && !r.openReason?.trim())
      .map(r => r.path);
    expect(abiertasSinMotivo).toEqual([]);
  });

  it("ningún destino del sidebar quedó sin módulo por accidente", () => {
    const abiertas = NAV_ITEMS
      .filter(i => moduleForPath(i.to) === "")
      .map(i => i.to);
    // Las únicas abiertas son las que lo declaran a propósito.
    expect(abiertas.sort()).toEqual(["/", "/alertas", "/calendario", "/perfil", "/tareas"]);
  });

  it("todo módulo referenciado existe en la lista de permisos", () => {
    // Un módulo inexistente acá es un toggle de Admin → Permisos que no hace
    // nada. Se compara contra la fuente de verdad, nunca contra una copia.
    const usados = allRoutes().map(r => r.module).filter(Boolean) as string[];
    const desconocidos = [...new Set(usados)].filter(m => !isPermissionModule(m));
    expect(desconocidos).toEqual([]);
  });

  it("todo módulo de permisos tiene un nombre visible", () => {
    const sinLabel = PERMISSION_MODULES.filter(m => !PERMISSION_MODULE_LABEL[m]?.trim());
    expect(sinLabel).toEqual([]);
  });
});
