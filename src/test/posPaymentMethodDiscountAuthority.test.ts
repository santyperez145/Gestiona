import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260829000040_pos_payment_method_discounts.sql"),
  "utf8",
);
const pos = readFileSync(resolve("src/pages/POSPage.tsx"), "utf8");
const settings = readFileSync(resolve("src/pages/SettingsPage.tsx"), "utf8");
const store = readFileSync(resolve("src/lib/supabaseStore.ts"), "utf8");

describe("autoridad del descuento por medio de pago en Caja", () => {
  it("lee las cuatro configuraciones del tenant en servidor", () => {
    expect(migration).toContain("v_settings.discount_cash_percent");
    expect(migration).toContain("v_settings.discount_transfer_percent");
    expect(migration).toContain("v_settings.discount_debit_percent");
    expect(migration).toContain("v_settings.discount_credit_percent");
    expect(migration).toContain("WHERE settings.org_id = p_org_id");
  });

  it("hace competir oferta y medio sin acumularlos", () => {
    expect(migration).toContain("v_precio := LEAST(v_precio, v_precio_medio)");
    expect(pos).toContain("posPriceForPayment(");
  });

  it("un cliente viejo no puede borrar el descuento enviando lista", () => {
    expect(migration).toContain("v_payment_pct > 0 AND v_pedido > v_precio");
    expect(migration).toContain("'client_price_ignored', true");
  });

  it("conserva evidencia histórica en la venta", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS payment_discount_percent");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS payment_discount_ars");
    expect(migration).toContain("'payment_discount_ars', v_payment_discount_ars");
  });

  it("el split no pondera porcentajes de forma circular", () => {
    expect(migration).toContain("WHEN v_split THEN 0");
    expect(pos).toContain("no combina descuentos automáticos de dos medios");
  });

  it("Ajustes acota el porcentaje igual que la base", () => {
    expect(settings).toContain("buildPricingSettingsUpdate({");
    expect(settings.match(/max="90"/g)?.length).toBe(4);
  });

  it("la sección Precios conserva una acción de guardado alcanzable y rotulada", () => {
    expect(settings).toContain("onClick={handleSavePricing}");
    expect(settings).toContain("Guardar precios y descuentos");
    expect(settings.match(/htmlFor="discount-[^"]+-percent"/g)?.length).toBe(4);
  });

  it("actualiza la fila existente de la organización y no reasigna su creador", () => {
    const saveSettings = store.slice(
      store.indexOf("export async function saveSettingsDB"),
      store.indexOf("// ========= MARKETING ========="),
    );
    expect(saveSettings).toContain(".update(settings as SettingsUpdate)");
    expect(saveSettings).toContain(".eq('org_id', orgId)");
    expect(saveSettings).toContain(".select('id')");
    expect(saveSettings).not.toContain(".upsert(");
    expect(saveSettings).not.toContain("user_id: userId");
  });
});
