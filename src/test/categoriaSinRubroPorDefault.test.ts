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
const types = leer("src/lib/types.ts");
const supaStore = leer("src/lib/supabaseStore.ts");
const settingsPage = leer("src/pages/SettingsPage.tsx");
const posPage = leer("src/pages/POSPage.tsx");
const salesPage = leer("src/pages/SalesPage.tsx");
const publicCatalog = leer("src/pages/PublicCatalogPage.tsx");

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

  it("⚠️ y el rubro que ya estaba escrito se corrigió, no sólo el default", () => {
    // Sacar el `DEFAULT 'perfumes'` de la columna arregla lo que viene; no
    // toca lo ya escrito. Medido el 2026-08-27: `pruebas Workspace` —0
    // productos, 0 tipos, sin perfil aplicado— seguía diciendo «perfumes».
    // El rubro siembra tipos y atributos, así que ese comercio arrancaba con
    // perfumería puesta sin haberlo pedido.
    //
    // 📌 Sacar un default y no corregir las filas es media corrección, y la
    // mitad que falta es la que el comercio ve.
    const dir = resolve(__dirname, "../../supabase/migrations");
    const archivo = readdirSync(dir).find(f => f.includes("el_rubro_que_nadie_eligio"));
    expect(archivo, "no existe la migración que corrige el rubro heredado").toBeTruthy();

    const texto = readFileSync(resolve(dir, archivo!), "utf8");
    expect(texto, "la corrección no exige que NO haya perfil aplicado")
      .toContain("organization_business_profiles");
    // ⚠️ Y es conservadora: sólo donde no hay NINGÚN rastro de elección.
    expect(texto, "la corrección borraría el rubro de un comercio con productos")
      .toMatch(/NOT EXISTS[\s\S]{0,120}?public\.products/);
    expect(texto, "falta la vista guardia").toContain("audit_rubro_adivinado");
  });

  it("crear una categoría deja de exigir una tienda", () => {
    // 3 de 4 organizaciones no tenían tienda, así que sin esto el comercio
    // nuevo se quedaba con una lista vacía y ninguna forma de llenarla.
    expect(migracion).toContain("ALTER COLUMN store_id DROP NOT NULL");
    expect(categorySelect).toContain("store_id: null");
    expect(soloCodigo(categorySelect)).not.toContain('from("ecommerce_stores")');
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

  it("el placeholder del producto no es un perfume", () => {
    expect(productsPage).not.toContain("LATTAFA KHAMRAH");
    expect(productsPage).toContain('placeholder="Ej: Nombre del producto"');
  });

  it("el género y el contenido no se adivinan como de perfumería", () => {
    expect(productsPage).not.toContain("useState(product?.gender || 'masculino')");
    expect(productsPage).not.toContain("content_ml: parseInt(contentMl) || 100");
    expect(productsPage).not.toContain("else setContentMl('100')");
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

/**
 * La segunda mitad, 2026-08-26.
 *
 * El primer slice sacó el rubro de la base y de los componentes que **eligen**
 * una categoría. Éste saca las listas que la **enumeraban**: seis pantallas que
 * tenían escritos a mano los mismos cuatro slugs, cada una con su propia copia.
 *
 * Lo caro no era el rótulo feo: era que el markup por categoría —el número con
 * el que se calcula el precio de venta— sólo se podía configurar para esos
 * cuatro. Un comercio de otro rubro no podía tocar el suyo.
 */
describe("las listas de categorías salen del comercio, no del código", () => {
  it("ProductCategory deja de ser una unión cerrada de cuatro slugs", () => {
    expect(soloCodigo(types)).toContain("export type ProductCategory = string");
    expect(soloCodigo(types)).not.toContain("'perfume_arabe' |");
  });

  it("getCategoryLabel deja de tener su propio mapa duplicado", () => {
    // Era copia letra por letra de NOMBRES_HEREDADOS. Ahora delega, así que un
    // slug desconocido sale legible en vez de crudo.
    expect(soloCodigo(supaStore)).not.toContain("Perfume Árabe");
    expect(supaStore).toContain("return nombreDeCategoria(cat);");
  });

  it("el markup por categoría se configura sobre las categorías del comercio", () => {
    // El de mayor impacto: sin esto, un comercio de otro rubro no podía poner
    // markup a ninguna de sus categorías.
    expect(settingsPage).toContain("categoriasDePrecio");
    expect(soloCodigo(settingsPage)).not.toContain("['perfume_arabe', 'perfume_diseñador', 'vaper', 'electronico']");
  });

  it("y no esconde un markup guardado de una categoría que ya no existe", () => {
    // `settings.category_pricing` lo sigue aplicando `getCategoryMarkup`; si la
    // fila no se muestra, cobra sin que nadie pueda verla ni sacarla.
    expect(settingsPage).toContain("Object.keys(categoryPricing)");
  });

  it("el POS arma sus pastillas con los productos que tiene a la vista", () => {
    expect(soloCodigo(posPage)).not.toContain("const CATS");
    expect(posPage).toContain("useOrgCategoryNames");
  });

  it("y el filtro de Ventas hace lo mismo", () => {
    expect(salesPage).toContain("categoriasFiltro");
    expect(soloCodigo(salesPage)).not.toContain("const CATEGORIES");
  });

  it("el ajuste masivo recibe las categorías en vez de listarlas", () => {
    // Por prop y no con otro hook: la página ya las tiene cargadas.
    expect(productsPage).toContain("categorias: OpcionCategoria[]");
  });

  it("el badge de categoría tiene color para todas, no para cuatro", () => {
    expect(soloCodigo(productsPage)).not.toContain("CATEGORY_COLORS");
    expect(productsPage).toContain("colorDeCategoria(p.category)");
  });

  it("el catálogo por WhatsApp deja de publicar slugs crudos", () => {
    expect(soloCodigo(publicCatalog)).not.toContain("CATEGORY_LABELS");
    expect(publicCatalog).toContain("nombreDeCategoria(p.category)");
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
  "src/lib/catalogIndustry.ts": "P0.1: decide si el workspace muestra chrome de perfumería o vapers; no es una lista de categorías a elegir",
  "src/lib/catalogIndustry.test.ts": "P0.1: prueba el helper; cita las categorías de perfume a propósito",
  "src/lib/productImport.ts": "heurística de import; su fallback ya es la categoría del archivo",
  "src/components/integrations/TiendanubeExcelImport.tsx": "heurística de import",
  "src/components/products/InvoiceImportDialog.tsx": "heurística de import",

  // Lo que queda al 2026-08-26 **no son listas de categorías**: son features
  // atadas a un rubro, que es un problema distinto y de otro slice. La forma
  // correcta de sacarlas es el catálogo polimórfico (P0.1, `product_types` y
  // sus atributos), no reemplazar el slug por otro slug.
  "src/pages/ProductsPage.tsx": "ficha de perfume (product_perfume_details), subtipos de vaper y campos de electrónica en el formulario",
  "src/pages/PublicCatalogPage.tsx": "decants, badges de género y cross-sell vaper→perfume; el hero por categoría es opcional y cae a uno genérico",
  "src/pages/CatalogPage.tsx": "modo vaper del PDF del catálogo interno",
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
