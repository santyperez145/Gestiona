import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cotizacionDe, costoArsONull } from "@/lib/exchangeRate";

const pos = readFileSync(resolve(process.cwd(), "src/pages/POSPage.tsx"), "utf8");

describe("costo nativo del catálogo en POS", () => {
  it("mantiene ARS en producto, kit y recomendación del carrito", () => {
    expect(pos.match(/costARS: prod\.cost_ars/g)).toHaveLength(3);
    expect(pos.match(/costCurrency: prod\.cost_currency/g)).toHaveLength(3);
  });
  it("usa la autoridad compartida en margen y ticket offline, sin inventar USD", () => {
    expect(pos.match(/const costARS = costoArsONull\(/g)).toHaveLength(2);
    expect(pos).not.toMatch(/(?:item|it)\.costUSD\s*\*\s*(?:item|it)\.exchangeRate/);
    expect(pos).toContain("costARS === null ? null : adjustedTotal - costARS * item.quantity");
    expect(pos).toContain("profitARS !== null && item.exchangeRate > 0");
  });
  it("resuelve el costo de ferretería en ARS aunque no haya cotización", () => {
    const product = { costUsd: 0, costArs: 100, costCurrency: "ARS" };
    expect(costoArsONull(product, null)).toBe(100);
    expect(costoArsONull(product, 2000)).toBe(100);
  });
  it("un costo USD sin cotización sigue siendo desconocido, no gratis", () => {
    expect(costoArsONull({ costUsd: 10, costArs: null, costCurrency: "USD" }, cotizacionDe({ exchange_rate: 0 }))).toBeNull();
    expect(costoArsONull({ costUsd: 10 }, 1000)).toBe(10000);
  });
});
