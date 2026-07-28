import { describe, it, expect } from "vitest";
import { moduleForRoute, SECTION_MODULE, ROUTE_MODULE } from "@/lib/moduleMap";

describe("moduleForRoute", () => {
  it("usa la coincidencia exacta de ruta por encima de la sección", () => {
    // /productos está en la sección `inventario`, pero tiene su propio módulo.
    expect(moduleForRoute("/productos", "inventario")).toBe("products");
    expect(moduleForRoute("/clientes", "ventas")).toBe("customers");
    expect(moduleForRoute("/caja", "principal")).toBe("pos");
  });

  it("cae al módulo de la sección cuando la ruta no tiene override", () => {
    expect(moduleForRoute("/kardex", "inventario")).toBe("inventory");
    expect(moduleForRoute("/devoluciones", "ventas")).toBe("sales");
    expect(moduleForRoute("/cheques", "finanzas")).toBe("finance");
  });

  it("deja sin restricción la sección principal (dashboard y tareas del día)", () => {
    expect(moduleForRoute("/", "principal")).toBe("");
    expect(moduleForRoute("/tareas", "principal")).toBe("");
  });

  it("no restringe rutas desconocidas sin sección", () => {
    expect(moduleForRoute("/ruta-que-no-existe")).toBe("");
  });

  it("resuelve sin sección usando solo el mapa de rutas", () => {
    expect(moduleForRoute("/configuracion")).toBe("settings");
    expect(moduleForRoute("/equipo")).toBe("team");
  });

  it("todo módulo referenciado existe en la lista de módulos de permisos", () => {
    // Debe coincidir con MODULES de PermissionsTab, si no el toggle no hace nada.
    const known = new Set([
      "sales", "pos", "products", "customers", "crm", "reports", "expenses",
      "purchases", "invoices", "inventory", "analytics", "marketing", "support",
      "settings", "team", "finance",
    ]);
    const used = [...Object.values(ROUTE_MODULE), ...Object.values(SECTION_MODULE)]
      .filter(Boolean);
    const unknown = [...new Set(used)].filter(m => !known.has(m));
    expect(unknown).toEqual([]);
  });
});
