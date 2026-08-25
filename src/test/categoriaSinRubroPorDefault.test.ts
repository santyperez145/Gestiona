import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const migracion = leer("supabase/migrations/20260825000002_categoria_sin_rubro.sql");
const categorySelect = leer("src/components/products/CategorySelect.tsx");
const productsPage = leer("src/pages/ProductsPage.tsx");
const brandKnowledge = leer("src/components/marketing/BrandKnowledgeTab.tsx");
const stockCount = leer("src/components/inventory/StockCountTab.tsx");
const aiSuggest = leer("src/hooks/useAIProductSuggest.ts");
const tiendanube = leer("src/components/integrations/TiendanubeExcelImport.tsx");
const invoiceImport = leer("src/components/products/InvoiceImportDialog.tsx");
const storeCategories = leer("src/lib/storeCategories.ts");
const banners = leer("src/components/ecommerce/StoreBannersEditor.tsx");

/**
 * El archivo sin sus comentarios.
 *
 * Los archivos de este repo explican en prosa qué sacaron y por qué, así que
 * buscar el identificador retirado a secas lo encuentra en su propia lápida.
 * Lo que importa es que no quede en el código.
 */
const soloCodigo = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * La categoría del producto no se adivina, y menos con el rubro del negocio
 * original.
 *
 * Continuación de `onboardingSinRubroPorDefault`: ahí el default de perfumería
 * vivía en `settings.industry_code`; acá vivía en `products.category` —con
 * `DEFAULT 'perfume_arabe'` y `NOT NULL`— y en media docena de componentes
 * compartidos que listaban a mano las categorías de una perfumería.
 *
 * Medido el 2026-08-25 contra producción: 60 productos en 3 slugs, todos de
 * **una** organización; las otras 3 no tenían productos, ni categorías, ni
 * tienda — y eran exactamente las que veían el vocabulario ajeno.
 */
describe("la categoría no viene puesta en perfumería", () => {
  it("la base no le pone categoría a un producto que no la eligió", () => {
    expect(migracion).toContain("ALTER COLUMN category DROP DEFAULT");
    // El NOT NULL se va con el default: si no, los bloques de verificación de
    // las migraciones que insertan sin `category` fallan al re-correrse, y en
    // este repo toda migración se corre más de una vez.
    expect(migracion).toContain("ALTER COLUMN category DROP NOT NULL");
  });

  it("y no reescribe las filas que ya existen", () => {
    // Las 60 son de la perfumería de verdad y su categoría es correcta.
    expect(migracion).not.toMatch(/UPDATE\s+public\.products\s+SET\s+category/i);
  });

  it("crear una categoría deja de exigir una tienda", () => {
    // 3 de 4 organizaciones no tenían tienda, así que sin esto el comercio
    // nuevo se quedaba con una lista vacía y ninguna forma de llenarla.
    expect(migracion).toContain("ALTER COLUMN store_id DROP NOT NULL");
    expect(categorySelect).toContain("store_id: tienda?.id ?? null");
  });

  it("el selector no ofrece los rubros heredados como opciones", () => {
    // Sembrarlos hacía lo contrario de un respaldo: una organización sin
    // categorías ni productos elegía entre "Perfume Árabe" y "Vaper".
    expect(soloCodigo(categorySelect)).not.toContain("NOMBRES_HEREDADOS");
  });

  it("pero los nombres heredados siguen vivos como rótulo", () => {
    // Borrarlos haría que quien tiene `perfume_arabe` cargado vea el slug crudo.
    expect(storeCategories).toContain("NOMBRES_HEREDADOS");
  });

  it("la ficha de producto no preselecciona un rubro", () => {
    expect(productsPage).toContain("useState(product?.category || '')");
    expect(productsPage).not.toContain("useState(product?.category || 'perfume_arabe')");
  });

  it("y guarda 'sin categoría' en vez de inventar una", () => {
    // Con el default fuera de la base, mandar '' escribiría una categoría vacía
    // en vez de ninguna.
    expect(productsPage).toContain("category: category || null");
  });

  it("la oferta masiva tampoco arranca con una categoría elegida", () => {
    expect(productsPage).not.toContain("useState('perfume_arabe')");
    // Y si no se eligió ninguna, no se aplica a cero productos en silencio.
    expect(productsPage).toContain('if (!catOfferCategory) { toast.error("Elegí una categoría"); return; }');
  });

  it("la base de conocimiento de marcas usa las categorías del comercio", () => {
    expect(brandKnowledge).toContain("useOrgCategories");
    expect(brandKnowledge).not.toContain("const CATEGORIES");
    expect(brandKnowledge).toContain("useState(editItem?.category || '')");
  });

  it("la toma física rotula con las categorías del comercio", () => {
    expect(stockCount).toContain("useOrgCategoryNames");
    expect(stockCount).not.toContain("CAT_LABELS");
  });

  it("y escapa el CSV, ahora que el nombre de la categoría lo escribe el comercio", () => {
    // Un nombre con coma partía la fila y corría el resto del renglón.
    expect(stockCount).toContain(".map(csvCell)");
  });

  it("la IA sugiere sobre las categorías reales de la organización", () => {
    expect(soloCodigo(aiSuggest)).not.toContain("CATEGORY_MAP");
    expect(aiSuggest).toContain("useOrgCategories");
    // Devolver el texto crudo dejaba el selector en blanco con una categoría
    // que el comercio no tiene.
    expect(aiSuggest).toContain("resolverCategoria");
  });

  it("y su caché no cruza organizaciones", () => {
    // La caché es de módulo: sin el orgId, la categoría sugerida a un comercio
    // se le servía al siguiente.
    expect(aiSuggest).toContain('orgId ?? "sin-org"');
  });

  it("los importadores conservan la heurística pero no caen en un rubro", () => {
    // Quien exporta de Tiendanube ya tiene su taxonomía: gana la del archivo.
    expect(tiendanube).toContain('raw.trim().toLowerCase() || "otro"');
    // La factura sólo trae el nombre; si ninguna pista pega, no se adivina.
    expect(invoiceImport).not.toContain('return "perfume_diseñador";');
  });

  it("el placeholder del banner no propone una categoría de perfumería", () => {
    expect(banners).not.toContain("cat=perfume_arabe");
  });
});

// ── El guardia que impide que vuelva ────────────────────────────────────────
//
// Los slugs del negocio original como literal de string. La allowlist no es
// perdón: es el inventario medido de lo que **todavía** queda, para que un
// archivo nuevo no se sume sin que nadie lo note.

const SLUG_DE_RUBRO = /["'](perfume_[a-z_\u00f1]+|vaper|liquido|electronico|accesorio)["']/;

const CONOCIDOS: Record<string, string> = {
  // Legítimos: el slug es dato del negocio original o una heurística de import.
  "src/lib/seedData.ts": "catálogo sembrado del negocio original",
  "src/lib/storeCategories.ts": "NOMBRES_HEREDADOS, rótulo de un slug ya cargado",
  "src/lib/productImport.ts": "heurística de import; su fallback ya es la categoría del archivo",
  "src/components/integrations/TiendanubeExcelImport.tsx": "heurística de import",
  "src/components/products/InvoiceImportDialog.tsx": "heurística de import",

  // Deuda medida el 2026-08-25, fuera del alcance de este slice.
  "src/pages/ProductsPage.tsx": "colores de badge y el bloque de notas olfativas; BulkPriceAdjust lista 4 categorías a mano",
  "src/pages/PublicCatalogPage.tsx": "hero y agrupación con copy de perfumería",
  "src/pages/SalesPage.tsx": "lista de categorías escrita a mano",
  "src/pages/POSPage.tsx": "lista de categorías escrita a mano",
  "src/pages/SettingsPage.tsx": "markup por categoría sobre los 4 slugs heredados",
  "src/pages/CatalogPage.tsx": "modo vaper del catálogo interno",
  "src/lib/supabaseStore.ts": "getCategoryLabel, el mapa de rótulos anterior a ecommerce_categories",
  "src/lib/types.ts": "ProductCategory, unión cerrada de los 4 slugs",
  "src/lib/weightEstimate.ts": "modelo de peso por ml, específico de perfumería",
  "src/components/marketing/InstagramStoryGenerator.tsx": "plantillas de copy de perfumería",
  "src/components/marketing/MarketingTemplatesTab.tsx": "plantillas de copy de perfumería",
};

function archivosConRubro(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const p = join(dir, entrada);
      if (statSync(p).isDirectory()) { recorrer(p); continue; }
      if (!/\.(ts|tsx)$/.test(p)) continue;
      const rel = p.split("\\").join("/").slice(ROOT.split("\\").join("/").length + 1);
      // Los tipos generados y los propios tests citan los slugs a propósito.
      if (rel.startsWith("src/test/")) continue;
      if (rel === "src/integrations/supabase/types.ts") continue;
      if (SLUG_DE_RUBRO.test(readFileSync(p, "utf8"))) salida.push(rel);
    }
  };
  recorrer(resolve(ROOT, "src"));
  return salida.sort();
}

describe("ningún archivo nuevo hardcodea el rubro", () => {
  it("los que quedan son los medidos, ni uno más", () => {
    const inesperados = archivosConRubro().filter(f => !(f in CONOCIDOS));
    expect(inesperados).toEqual([]);
  });

  it("y la allowlist no acumula entradas muertas", () => {
    // Una entrada que ya no aplica esconde que el archivo se limpió y deja la
    // lista mintiendo sobre cuánta deuda queda.
    const actuales = new Set(archivosConRubro());
    expect(Object.keys(CONOCIDOS).filter(f => !actuales.has(f))).toEqual([]);
  });
});
