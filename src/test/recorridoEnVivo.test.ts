import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: lo encontrado recorriendo la app publicada con la sesión del
// dueño (sólo lectura).
describe("recorrido en vivo", () => {
  it("Reposición calcula y pide en pesos con el costo de cada producto en su moneda", () => {
    const r = fs.readFileSync("src/components/inventory/ReposicionView.tsx", "utf8");
    expect(r).toContain('costo: costoSugerido(p, "ARS", cotizacion)');
    expect(r).toContain('currency: "ARS"');
    expect(r).not.toMatch(/\$\{[^}]*\} USD|Costo USD/);
  });
  it("Análisis no llama «neta» a la ganancia bruta ni compara contra un año vacío", () => {
    const a = fs.readFileSync("src/components/analytics/ResumenView.tsx", "utf8");
    expect(a).not.toContain('label="Ganancia Neta"');
    expect(a).not.toContain('label="Revenue Anual"');
    expect(a).toContain("derived.revTieneAnterior ?");
    expect(a).not.toMatch(/[📈🔮🧠👥💰📊💸]/u);
  });
  it("/pedidos lleva a los pedidos online", () => {
    expect(fs.readFileSync("src/app/routeManifest.ts", "utf8")).toContain('{ path: "/pedidos", redirectTo: "/pedidos-online" }');
  });
});
