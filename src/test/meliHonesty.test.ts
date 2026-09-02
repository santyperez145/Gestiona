import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  meliCopyIsHonest,
  meliDisconnectedSummary,
  meliListingsEmptyState,
  meliOrdersEmptyState,
} from "@/lib/meliHonesty";

const ROOT = process.cwd();

describe("meliHonesty", () => {
  it("el resumen desconectado no promete sync automático de órdenes", () => {
    const summary = meliDisconnectedSummary();
    expect(meliCopyIsHonest(summary)).toBe(true);
    expect(summary.toLowerCase()).toContain("traer");
    expect(summary.toLowerCase()).not.toContain("automáticamente");
  });

  it("empty states llevan a Productos y explican Traer/Importar", () => {
    const listings = meliListingsEmptyState();
    expect(listings.href).toBe("/productos");
    expect(listings.tone).toBe("neutral");
    expect(listings.text.toLowerCase()).toContain("ficha");

    const orders = meliOrdersEmptyState();
    expect(orders.text.toLowerCase()).toContain("traer");
    expect(orders.text.toLowerCase()).toContain("importan");
  });

  it("el panel usa los helpers y deja de mentir con CheckCircle vacío", () => {
    const panel = readFileSync(
      resolve(ROOT, "src/components/integrations/MercadoLibrePanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("meliDisconnectedSummary");
    expect(panel).toContain("meliListingsEmptyState");
    expect(panel).toContain("meliOrdersEmptyState");
    expect(panel).toContain('to={listingsEmpty.href}');
    expect(panel).not.toMatch(/bajá las órdenes automáticamente/i);
    expect(panel).not.toMatch(/Cuenta conectada\. Publicá un producto desde su ficha/);
    // El CheckCircle verde en empty de listings enseñaba que “todo bien” con 0 pubs.
    const emptyListingsBlock = panel.slice(
      panel.indexOf("listings.length === 0"),
      panel.indexOf("orders.length > 0"),
    );
    expect(emptyListingsBlock).not.toContain("CheckCircle2");
    expect(emptyListingsBlock).toContain("listingsEmpty");
  });
});
