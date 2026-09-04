import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Un producto puede no llevar stock, y la autoridad tiene que respetarlo.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `products.stock` es `NOT NULL DEFAULT 0` y hasta el 2026-08-27 no había
 * ninguna noción de «esto no se stockea». Una peluquería que carga «Corte de
 * pelo» y lo vende diez veces lo veía en **−10**: el trigger de ventas dispara
 * y `record_stock_movement` descuenta. La vista `stock_negativo` —que según
 * CONTRIBUTING.md tiene que estar vacía— se llenaría de servicios.
 *
 * ⚠️ La guarda vive dentro de `record_stock_movement` porque es la ÚNICA
 * autoridad sobre el stock: cubre venta, compra, ajuste manual, cierre de
 * conteo y transferencia de una sola vez. Repartirla entre los triggers sería
 * la misma decisión escrita en cinco lugares — y en este repo eso ya divergió
 * dos veces, la segunda descontando el doble durante meses.
 *
 * Este test cubre el agujero de tiempo: una migración futura que regenere la
 * autoridad desde `pg_get_functiondef` —que es el procedimiento recomendado— y
 * se lleve puesta la guarda sin que nadie lo note.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRACIONES = resolve(ROOT, "supabase/migrations");
// El catálogo se lee una vez. Tres barridos completos independientes hacían
// timeout bajo la suite paralela aunque cada aserción fuera determinista.
const MIGRATION_SOURCES = readdirSync(MIGRACIONES)
  .filter(f => f.endsWith(".sql"))
  .sort()
  .map(archivo => ({ archivo, texto: readFileSync(resolve(MIGRACIONES, archivo), "utf8") }));

/**
 * La última migración que define la función, y **sólo el cuerpo de la
 * función**.
 *
 * ⚠️ Devolver el archivo entero hacía inútil el test: `maneja_stock` también
 * aparece en el `ALTER TABLE` y en los comentarios, así que borrar la guarda
 * de adentro de la función pasaba igual. Se probó en rojo y por eso se acotó.
 */
function ultimaDefinicion(fn: string): { archivo: string; texto: string } | null {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "i");
  for (let i = MIGRATION_SOURCES.length - 1; i >= 0; i--) {
    const { archivo, texto: completo } = MIGRATION_SOURCES[i];
    const m = re.exec(completo);
    if (!m) continue;
    // Del CREATE hasta el cierre del cuerpo (`$function$` de cierre).
    const desde = m.index;
    const abre = completo.indexOf("$function$", desde);
    const cierra = abre === -1 ? -1 : completo.indexOf("$function$", abre + 10);
    const texto = completo.slice(desde, cierra === -1 ? undefined : cierra);
    return { archivo, texto };
  }
  return null;
}

describe("lo que no lleva stock no se descuenta", () => {
  it("la autoridad del stock respeta maneja_stock", () => {
    const def = ultimaDefinicion("record_stock_movement");
    expect(def, "ninguna migración define record_stock_movement").not.toBeNull();

    expect(def!.texto, [
      `${def!.archivo} redefine record_stock_movement SIN mirar maneja_stock.`,
      "",
      "Sin esa guarda, cada venta de un servicio lo empuja a −1, −2, −3 y",
      "`stock_negativo` —que tiene que estar vacía— se llena de servicios.",
      "",
      "Va al principio del cuerpo, antes de tocar nada:",
      "  IF p_product_id IS NOT NULL AND EXISTS (",
      "    SELECT 1 FROM public.products p",
      "     WHERE p.id = p_product_id AND p.maneja_stock IS FALSE",
      "  ) THEN RETURN NULL; END IF;",
    ].join("\n")).toContain("maneja_stock");
  });

  it("la guarda va ANTES de escribir el movimiento", () => {
    // Chequear después de haber insertado en `stock_movements` dejaría el
    // Kardex con filas que nadie puede conciliar.
    const def = ultimaDefinicion("record_stock_movement")!;
    const cuerpo = def.texto;
    const guarda = cuerpo.indexOf("maneja_stock");
    const insert = cuerpo.indexOf("INSERT INTO public.stock_movements");
    expect(guarda, "la guarda no está en el cuerpo").toBeGreaterThan(-1);
    expect(insert, "no encontré el INSERT del Kardex").toBeGreaterThan(-1);
    expect(guarda, "la guarda quedó DESPUÉS del INSERT del Kardex")
      .toBeLessThan(insert);
  });

  it("la lista de reposición no pide comprar servicios", () => {
    // `run_abc_analysis` clasifica por VENTAS, y un servicio se vende: sin el
    // filtro aparecía como «quebrado» pidiendo comprar unidades de algo que no
    // se compra.
    let ultima: { archivo: string; texto: string } | null = null;
    for (let i = MIGRATION_SOURCES.length - 1; i >= 0; i--) {
      const { archivo, texto } = MIGRATION_SOURCES[i];
      if (/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.stock_a_reponer/i.test(texto)) {
        ultima = { archivo, texto };
        break;
      }
    }
    expect(ultima, "ninguna migración define stock_a_reponer").not.toBeNull();
    expect(ultima!.texto, `${ultima!.archivo}: stock_a_reponer volvió a incluir servicios`)
      .toContain("maneja_stock");
  });

  it("la ficha de producto deja elegirlo y lo persiste", () => {
    // ⚠️ Una capacidad que sólo se puede activar desde la base es una
    // capacidad que nadie va a usar. La medición de adopción existe justamente
    // porque «está construido» y «se puede usar» se leen igual en un README.
    const page = readFileSync(resolve(ROOT, "src/pages/ProductsPage.tsx"), "utf8");
    expect(page, "el formulario no ofrece elegir si el producto lleva stock")
      .toContain("setManejaStock");
    expect(page, "el formulario elige `maneja_stock` pero no lo guarda")
      .toMatch(/maneja_stock:\s*manejaStock/);
  });

  it("un rubro sin stock no marca sin stock TODO lo que vende", () => {
    // ⚠️ Un restaurante NO es un negocio sin stock: el plato no se descuenta
    // —se prepara— pero la harina, la bebida y el descartable sí. Un preset
    // que marcara todo como «sin stock» le rompe el inventario al día
    // siguiente, y es el error fácil de cometer al agregar el rubro.
    const preset = MIGRATION_SOURCES
      .map(({ texto }) => texto)
      .find(t => t.includes("'gastronomia'") && t.includes("industry_presets"));
    expect(preset, "ningún preset de gastronomía").toBeTruthy();

    expect(preset!, "el plato quedó marcado como que lleva stock")
      .toMatch(/"slug":\s*"plato"[\s\S]{0,200}?"maneja_stock":\s*false/);
    expect(preset!, "el insumo quedó SIN stock: un restaurante sí stockea mercadería")
      .toMatch(/"slug":\s*"insumo"[\s\S]{0,200}?"maneja_stock":\s*true/);
  });

  it("la ficha toma el default del tipo de producto, y sólo al crear", () => {
    // Sin esto el comercio marca veinte prestaciones una por una, y la que se
    // le pasa vuelve a bajar a −1 con cada venta.
    //
    // ⚠️ `!product &&` importa: en un producto que YA existe, cambiar el tipo
    // no puede reescribir una decisión que el comercio ya tomó.
    const page = readFileSync(resolve(ROOT, "src/pages/ProductsPage.tsx"), "utf8");
    expect(page, "la ficha no toma el default del tipo")
      .toMatch(/!product\s*&&[\s\S]{0,300}?setManejaStock\(tipo\.maneja_stock/);
  });

  it("los KPI de stock de Productos excluyen lo que no lleva stock", () => {
    // Un servicio se queda en el valor con el que se cargó —0 por default— así
    // que aparecía como agotado para siempre, inflando la alerta que el
    // comercio sí tiene que mirar.
    const page = readFileSync(resolve(ROOT, "src/pages/ProductsPage.tsx"), "utf8");
    expect(page, "ProductsPage cuenta agotados sin filtrar los servicios")
      .toMatch(/maneja_stock[\s\S]{0,400}?outOfStockCount/);
  });
});
