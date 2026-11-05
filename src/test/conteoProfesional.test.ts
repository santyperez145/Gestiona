import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contadoTrasEscanear, esDiferenciaGrande, productoDelCodigo } from "@/components/inventory/StockCountTab";

/**
 * Toma física profesional (2026-11-05). Antes: el escaneo sumaba al stock del
 * sistema (escanear 10 de un producto con 10 dejaba 20), la cámara se cerraba
 * en cada lectura, un código desconocido sumaba al primer nombre parecido, el
 * conteo se abría recién al cerrar (las ventas hechas mientras se contaba
 * volvían como sobrantes) y un error al cerrar cancelaba todo lo contado.
 */
const pantalla = readFileSync("src/components/inventory/StockCountTab.tsx", "utf8");
const fila = (id: string, extra: Partial<{ barcode: string; sku: string; name: string }> = {}, counted = "") =>
  ({ product: { id, name: extra.name ?? `Producto ${id}`, barcode: extra.barcode ?? null, sku: extra.sku ?? null }, counted });

describe("escaneo de la toma física", () => {
  it("cuenta desde cero, con multiplicador", () => {
    expect(contadoTrasEscanear("", 1)).toBe("1");
    expect(contadoTrasEscanear("1", 1)).toBe("2");
    expect(contadoTrasEscanear("", 12)).toBe("12");
    expect(contadoTrasEscanear("3", 6)).toBe("9");
  });

  it("sólo acepta el código exacto: barras, SKU o nombre completo", () => {
    const rows = [fila("a", { barcode: "7790001", name: "Yerba 1kg" }), fila("b", { sku: "YB-500", name: "Yerba 500g" })];
    expect(productoDelCodigo(rows, "7790001")?.product.id).toBe("a");
    expect(productoDelCodigo(rows, " YB-500 ")?.product.id).toBe("b");
    expect(productoDelCodigo(rows, "yerba 500g")?.product.id).toBe("b");
    // Antes «Yerba» sumaba al primer nombre que lo contenía.
    expect(productoDelCodigo(rows, "Yerba")).toBeNull();
    expect(productoDelCodigo(rows, "")).toBeNull();
  });

  it("la cámara queda abierta entre lecturas y no cuenta dos veces la misma etiqueta", () => {
    expect(pantalla).not.toMatch(/onDetected\(result\.getText\(\)\); stop\(\)/);
    expect(pantalla).toContain("ahora - (ultimas.current.get(code) ?? 0) < REPETICION_DEL_MISMO_CODIGO_MS");
    expect(pantalla).toContain("avisarLectura(true)");
    expect(pantalla).toContain("lectorDeCodigos()");
  });

  it("el lector es el mismo en todos los navegadores y su wasm se sirve desde el sitio", () => {
    const lector = readFileSync("src/lib/lectorDeCodigos.ts", "utf8");
    expect(lector).toContain('import lectorWasm from "zxing-wasm/reader/zxing_reader.wasm?url";');
    expect(lector).toContain('path.endsWith(".wasm") ? lectorWasm : prefix + path');
    expect(lector).toContain('await import("barcode-detector/ponyfill")');
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["barcode-detector"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("el conteo vive en la base desde el primer producto", () => {
  it("se abre con lo primero contado, se retoma si ya hay uno abierto y registra a medida", () => {
    expect(pantalla).toContain("const asegurarConteo = async ()");
    expect(pantalla).toContain('.eq("status", "abierto")');
    expect(pantalla).toContain("registrarPendientes().catch(error => registrarError(error))");
  });

  it("un error al cerrar no cancela lo contado", () => {
    const cierre = pantalla.slice(pantalla.indexOf("const handleConfirm"), pantalla.indexOf("const descartarToma"));
    expect(cierre).not.toContain("cancelar_conteo");
    expect(cierre).toContain("Lo contado quedó guardado");
  });

  it("propone el conteo cíclico del día y deja contar sólo esa lista", () => {
    expect(pantalla).toContain('supabase.rpc("productos_para_conteo_ciclico" as never');
    expect(pantalla).toContain("(!soloCiclico || idsCiclico.has(r.product.id))");
    expect(pantalla).toContain("if (!isMissingFunction(errCiclico)) registrarError(errCiclico);");
    const sql = readFileSync("supabase/migrations/20261106000100_conteo_ciclico.sql", "utf8");
    expect(sql).toContain("CASE k.clase WHEN 'A' THEN 7 WHEN 'B' THEN 30 ELSE 90 END AS periodo");
    expect(sql).toContain("public.has_permission(p_org_id, 'inventory', 'view')");
  });

  it("ofrece recontar las diferencias grandes antes de ajustar, una vez por producto", () => {
    expect(esDiferenciaGrande(11, 10)).toBe(false); // una de más: se ajusta
    expect(esDiferenciaGrande(7, 10)).toBe(true);   // 3 y 30 %
    expect(esDiferenciaGrande(90, 100)).toBe(false); // 10 %
    expect(esDiferenciaGrande(0, 5)).toBe(true);     // no se encontró nada
    expect(pantalla).toContain('confirmText: "Recontar ahora"');
    expect(pantalla).toContain("!reconfirmados.current.has(r.product.id)");
  });

  it("en equipo: trae lo contado por otros cada 15 s sin pisar lo que falta guardar", () => {
    expect(pantalla).toContain('.gt("counted_at", ultimoTraido.current)');
    expect(pantalla).toContain("!sucios.current.has(r.product.id)");
    expect(pantalla).toContain("15_000");
    expect(pantalla).toContain("Contando en equipo: {personasContando} personas");
  });

  it("al cerrar explica por qué faltó o sobró cada producto", () => {
    expect(pantalla).toContain('supabase.rpc("explicar_diferencias_de_conteo" as never');
    expect(pantalla).toContain("<DialogTitle>Por qué faltó o sobró</DialogTitle>");
    const sql = readFileSync("supabase/migrations/20261106000200_explicar_diferencias_de_conteo.sql", "utf8");
    // Un movimiento sin referencia también cuenta (NOT (NULL = …) lo dejaba afuera).
    expect(sql).toContain("m.reference_type IS DISTINCT FROM 'stock_count'");
    expect(sql).toContain("public.has_permission(v_org, 'inventory', 'view')");
  });

  it("se cuenta a ciegas por defecto", () => {
    expect(pantalla).toContain("const [aCiegas, setACiegas] = useState(true);");
    expect(pantalla).toContain('aCiegas ? <span className="text-muted-foreground/60">•••</span> : row.product.stock');
  });
});
