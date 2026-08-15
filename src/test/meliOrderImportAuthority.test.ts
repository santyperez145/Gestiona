import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260814000014_meli_paid_orders_to_sales.sql"),
  "utf8",
);
const sync = readFileSync(resolve(ROOT, "supabase/functions/meli-sync/index.ts"), "utf8");
const productsPage = readFileSync(resolve(ROOT, "src/pages/ProductsPage.tsx"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("importación de órdenes MercadoLibre", () => {
  it("la base acepta sólo órdenes paid, las bloquea durante la importación y evita duplicados", () => {
    expect(migration).toContain("lower(COALESCE(v_order.status, '')) <> 'paid'");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("IF v_order.imported_at IS NOT NULL THEN");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.meli_order_sale_lines");
    expect(migration).toContain("UNIQUE (meli_order_id, line_number)");
    expect(migration).toContain("REFERENCES public.sales(id) ON DELETE RESTRICT");
  });

  it("la importación resuelve producto, costo y comisión en SQL y deja el stock al trigger", () => {
    expect(migration).toContain("JOIN public.products p ON p.id = ml.product_id");
    expect(migration).toContain("v_order.raw->'order_items'");
    expect(migration).toContain("MercadoLibre no informó una comisión válida");
    expect(migration).toContain("v_line_profit := round(v_line_total - v_cost_ars - v_line_fee, 2)");
    expect(migration).toContain("source, source_id, provider, method, installments");
    expect(migration).toContain("'mercadolibre', v_order.id, 'mercadolibre'");
    expect(migration).not.toContain("UPDATE public.products SET stock");
  });

  it("el navegador sólo puede leer órdenes y el RPC queda exclusivo para service_role", () => {
    expect(migration).toContain('CREATE POLICY "meli_orders_select"');
    expect(migration).toContain('CREATE POLICY "meli_listings_select"');
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.import_meli_order_as_sales");
    expect(migration).toContain("TO service_role;");
  });

  it("la Edge Function exige usuario/admin, conserva sale_fee y no exige OAuth para importar lo ya bajado", () => {
    expect(sync).toContain("auth.getUser");
    expect(sync).toContain('if (action === "import-order")');
    expect(sync).toContain('admin.rpc("import_meli_order_as_sales"');
    expect(sync).toContain("p_actor_id: userId");
    expect(sync).toContain("sale_fee: i.sale_fee ?? null");
    expect(sync.indexOf('if (action === "import-order")')).toBeLessThan(sync.indexOf("const conn = await getToken"));
  });

  it("ninguna pantalla escribe órdenes descargadas directamente", () => {
    const writes = sourceFiles(resolve(ROOT, "src"))
      .filter(file => /\.from\(["']meli_orders["']\)\.(insert|update|delete)/.test(readFileSync(file, "utf8")))
      .map(file => file.replace(ROOT, ""));

    expect(writes, "las órdenes sólo las escribe meli-sync con service_role").toEqual([]);
  });

  it("el predictor usa el producto persistido, ofrece opciones y evita duplicar una publicación real", () => {
    expect(sync).toContain('action === "predict-category" || action === "publish"');
    expect(sync).toContain("/domain_discovery/search?limit=3&q=");
    expect(sync).toContain("[p.brand, p.name]");
    expect(sync).toContain("MercadoLibre no sugirió una categoría");
    expect(sync).toContain("existingListing");
    expect(sync.indexOf("existingListing")).toBeLessThan(sync.indexOf('meli(conn.access_token, "/items"'));
  });

  it("la ficha muestra la sugerencia y exige confirmar una categoría antes de publicar", () => {
    expect(productsPage).toContain("MercadoLibrePublishCard");
    expect(productsPage).toContain('invoke("predict-category")');
    expect(productsPage).toContain("Confirmar y publicar");
    expect(productsPage).toContain("La categoría se sugiere con el título guardado");
    expect(productsPage).toContain("categoryId: selectedCategoryId");
  });

  it("el navegador no escribe publicaciones; sólo puede leer su vínculo", () => {
    const writes = sourceFiles(resolve(ROOT, "src"))
      .filter(file => /\.from\(["']meli_listings["']\)\.(insert|update|delete|upsert)/.test(readFileSync(file, "utf8")))
      .map(file => file.replace(ROOT, ""));

    expect(writes, "las publicaciones sólo las vincula meli-sync con service_role").toEqual([]);
  });
});
