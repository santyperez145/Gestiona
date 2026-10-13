import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Una función de pantalla con login no tiene por qué ser llamable sin sesión.
// `ia_consumo_del_mes` y `stock_disponible` lo eran y filtraban datos de
// cualquier negocio (2026-10-13). La prueba viva contra la base es
// `scripts/funciones-anonimas-probar.mjs`; esto cuida que la migración siga
// cubriendo a las dos que filtraban y no le saque a la tienda lo que usa.
const MIGRACION = "supabase/migrations/20261013000100_funciones_privadas_sin_anon.sql";

describe("funciones privadas sin acceso anónimo", () => {
  const sql = fs.readFileSync(MIGRACION, "utf8");

  it("saca anon de las dos que filtraban datos", () => {
    expect(sql).toContain("'ia_consumo_del_mes'");
    expect(sql).toContain("'stock_disponible'");
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon/);
  });

  it("stock_disponible tampoco queda para authenticated: sólo la usan funciones SECURITY DEFINER", () => {
    expect(sql).toMatch(/f\.proname = 'stock_disponible'[\s\S]*FROM authenticated/);
  });

  it("no toca funciones públicas de la tienda ni del portal por token", () => {
    const lista = sql.slice(sql.indexOf("p.proname IN ("), sql.indexOf("LOOP"));
    expect(lista).not.toMatch(/get_store_|stock_en_vitrina|create_store_order|get_influencer_|confirm_payment_link_transfer/);
  });

  it("ningún front llama directo a stock_disponible", () => {
    const usos = fs.readdirSync("src", { recursive: true })
      .filter((f): f is string => typeof f === "string" && /\.(ts|tsx)$/.test(f) && !/test|integrations/.test(f))
      .filter(f => fs.readFileSync(`src/${f}`, "utf8").includes('"stock_disponible"'));
    expect(usos).toEqual([]);
  });
});
