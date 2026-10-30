import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogMigrationRows } from "@/lib/catalogMigration";
import { prepareProductColumnMapping } from "@/lib/productImportColumnMapping";
import { recorteSeo, SEO_TITULO_VISIBLE } from "@/lib/productSeo";

describe("SEO de producto al migrar y en la tienda", () => {
  it("toma el SEO del export de Tiendanube con la clave de identidad del producto", () => {
    const r = parseCatalogMigrationRows([
      { "Identificador de URL": "remera-lisa", Nombre: "Remera lisa", "Valor de propiedad 1": "S", "Nombre de propiedad 1": "Talle", "Título para SEO": "Remera lisa de algodón | Mi Tienda", "Descripción para SEO": "  Remera   100% algodón.  " },
      { "Identificador de URL": "remera-lisa", Nombre: "", "Valor de propiedad 1": "M", "Título para SEO": "", "Descripción para SEO": "" },
      { "Identificador de URL": "buzo", Nombre: "Buzo", "Título para SEO": "", "Descripción para SEO": "" },
    ], "tiendanube.csv");
    expect(r.seo).toEqual([{ external_key: "remera-lisa", titulo: "Remera lisa de algodón | Mi Tienda", descripcion: "Remera 100% algodón." }]);
    expect(r.products.find(p => p.external_key === "remera-lisa")).toBeDefined();
  });

  it("toma el SEO del export de Shopify", () => {
    const r = parseCatalogMigrationRows([
      { Handle: "gorra", Title: "Gorra", "SEO Title": "Gorra trucker", "SEO Description": "Gorra con red" },
    ], "shopify.csv");
    expect(r.seo).toEqual([{ external_key: "gorra", titulo: "Gorra trucker", descripcion: "Gorra con red" }]);
  });

  it("el mapeo de columnas sugiere las columnas SEO de cada plataforma", () => {
    const tn = prepareProductColumnMapping(["Identificador de URL", "Nombre", "Título para SEO", "Descripción para SEO"], [], "tiendanube");
    expect(Object.values(tn.suggested)).toEqual(expect.arrayContaining(["seo_title", "seo_description"]));
  });

  it("el recorte de la vista previa es el de Google", () => {
    expect(recorteSeo("a".repeat(70), SEO_TITULO_VISIBLE)).toHaveLength(SEO_TITULO_VISIBLE);
    expect(recorteSeo("  corto  ", SEO_TITULO_VISIBLE)).toBe("corto");
  });

  it("la base no pisa lo manual y sólo lo muestra para productos publicados", () => {
    const sql = readFileSync("supabase/migrations/20261030000600_seo_de_producto.sql", "utf8");
    expect(sql).toContain("WHERE public.product_seo.origen = 'importado';");
    expect(sql).toContain("AND COALESCE(publication.visibility, 'published') = 'published'");
    const og = readFileSync("api/og.ts", "utf8");
    expect(og).toContain('"get_store_product_seo", { p_slug: ruta.slug, p_product_id: ruta.productId }');
  });
});
