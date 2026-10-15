import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: borrar un producto se llevaba en cascada transferencias, lotes y
// conteos. Ahora lo que tiene operaciones se archiva y el resto se borra
// (scripts/productos-con-historia-matrix.sql prueba la base).
describe("productos con historia se archivan", () => {
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
  const pagina = fs.readFileSync("src/pages/ProductsPage.tsx", "utf8");
  it("el borrado pasa por eliminar_productos y no borra directo", () => {
    expect(store).toContain("supabase.rpc('eliminar_productos'");
    expect(store).not.toMatch(/from\('products'\)\.delete\(\)\.in\('id', lote\)/);
  });
  it("Productos oculta los archivados y los muestra en su filtro", () => {
    expect(pagina).toContain('<SelectItem value="archived">Archivados</SelectItem>');
    expect(pagina).toContain("else if (p.is_active === false) return false;");
  });
});
