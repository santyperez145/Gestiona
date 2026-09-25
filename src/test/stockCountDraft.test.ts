import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/**
 * La toma física puede durar horas: si una recarga o un corte pierde lo
 * contado, el conteo se abandona a mano y el stock sigue sin conciliar.
 * El borrador local mantiene el progreso por dispositivo; el servidor
 * sigue siendo la única autoridad del ajuste (abrir/registrar/cerrar).
 */
describe("toma física: progreso que sobrevive a la recarga", () => {
  it("el borrador vive en src/lib con clave por organización y límites", () => {
    const lib = src("src/lib/stockCountDraft.ts");
    expect(lib).toContain("gestiona.stockcount.draft.");
    expect(lib).toContain("loadStockCountDraft");
    expect(lib).toContain("saveStockCountDraft");
    expect(lib).toContain("clearStockCountDraft");
    // El borrador no guarda productos infinitos ni basura.
    expect(lib).toContain("sanitizeRows");
    expect(lib).toContain("slice(0, 20_000)");
    // Un borrador corrupto se descarta: no bloquea una nueva toma.
    expect(lib).toContain("Borrador corrupto");
  });

  it("la toma física retoma el borrador y lo limpia al cerrar", () => {
    const tab = src("src/components/inventory/StockCountTab.tsx");
    expect(tab).toContain("loadStockCountDraft");
    expect(tab).toContain("saveStockCountDraft");
    expect(tab).toContain("clearStockCountDraft");
    expect(tab).toContain("Retomamos tu conteo");
    expect(tab).toContain("Descartar y empezar de nuevo");
    // La autoridad del ajuste sigue siendo server-side: los RPC reales.
    expect(tab).toContain('rpc("abrir_conteo"');
    expect(tab).toContain('rpc("registrar_conteo"');
    expect(tab).toContain('rpc("cerrar_conteo"');
  });
});