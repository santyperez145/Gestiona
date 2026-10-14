import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14: con 5.486 productos (Famatina) la casilla de la tabla marcaba
// sólo el grupo visible (60): borrar todo el catálogo eran ~92 selecciones.
// El borrado ya iba por lotes de 200 con avance; faltaba poder elegir todo lo
// filtrado, con una confirmación a la altura.
describe("borrado masivo de productos", () => {
  const pagina = fs.readFileSync("src/pages/ProductsPage.tsx", "utf8");
  const dialogo = fs.readFileSync("src/components/shared/ConfirmDialog.tsx", "utf8");
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");

  it("se pueden elegir todos los productos del filtro, no sólo los visibles", () => {
    expect(pagina).toContain("onClick={() => setSelectedIds(new Set(filtered.map(p => p.id)))}");
    expect(pagina).toContain('data-testid="productos-seleccionar-filtro"');
  });

  it("más de 100 productos pide escribir ELIMINAR", () => {
    expect(pagina).toContain('requireText={selectedIds.size > 100 ? "ELIMINAR" : undefined}');
    expect(dialogo).toContain("disabled={!listo}");
  });

  it("el borrado sigue siendo por lotes de 200 y verifica qué quedó", () => {
    expect(store).toContain("for (let i = 0; i < ids.length; i += 200) {");
    expect(store).toContain("const { data: siguen, error: readError }");
  });
});
