import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contarBajoCosto, filtroDeMargenDesdeUrl, seVendeBajoCosto } from "@/lib/guardianDeMargen";

describe("guardián de margen (Profit)", () => {
  it("detecta el precio por debajo del costo en pesos", () => {
    expect(seVendeBajoCosto({ sale_price_ars: 0.1, cost_ars: 776, cost_currency: "ARS" }, null)).toBe(true);
    expect(seVendeBajoCosto({ sale_price_ars: 1255, cost_ars: 15106.5, cost_currency: "ARS" }, null)).toBe(true);
    expect(seVendeBajoCosto({ sale_price_ars: 1000, cost_ars: 1000, cost_currency: "ARS" }, null)).toBe(false);
    expect(seVendeBajoCosto({ sale_price_ars: 1200, cost_ars: 1000, cost_currency: "ARS" }, null)).toBe(false);
  });

  it("sin costo conocido o sin precio no cuenta como pérdida", () => {
    expect(seVendeBajoCosto({ sale_price_ars: 100, cost_ars: 0, cost_currency: "ARS" }, null)).toBe(false);
    expect(seVendeBajoCosto({ sale_price_ars: 0, cost_ars: 500, cost_currency: "ARS" }, null)).toBe(false);
    // En dólares sin cotización el costo es desconocido.
    expect(seVendeBajoCosto({ sale_price_ars: 100, total_cost_usd: 10, cost_currency: "USD" }, null)).toBe(false);
    expect(seVendeBajoCosto({ sale_price_ars: 100, total_cost_usd: 10, cost_currency: "USD" }, 1500)).toBe(true);
  });

  it("cuenta y acepta sólo filtros conocidos desde la URL", () => {
    expect(contarBajoCosto([
      { sale_price_ars: 0.1, cost_ars: 333, cost_currency: "ARS" },
      { sale_price_ars: 500, cost_ars: 100, cost_currency: "ARS" },
    ], null)).toBe(1);
    expect(filtroDeMargenDesdeUrl("negative")).toBe("negative");
    expect(filtroDeMargenDesdeUrl("borrar")).toBeNull();
    expect(filtroDeMargenDesdeUrl(null)).toBeNull();
  });

  it("el Inicio avisa y abre Productos filtrado con la misma regla", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");
    const products = readFileSync(resolve(process.cwd(), "src/pages/ProductsPage.tsx"), "utf8");
    expect(dashboard).toContain("contarBajoCosto(products, cotizacionDe(settings))");
    expect(dashboard).toContain("link: '/productos?margen=negative'");
    expect(products).toContain("filtroDeMargenDesdeUrl(identityParams.get(\"margen\"))");
    expect(products).toContain("if (filterMargin === 'negative' && !seVendeBajoCosto(p, cotizacion)) return false;");
    expect(products).toContain("con precio por debajo del costo.");
  });
});
