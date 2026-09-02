import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeBankTransferReady, storeOffersBankTransfer } from "./storeTransfer";

describe("transferencia usable en la tienda", () => {
  it("exige CBU o alias, no el nombre del banco solo", () => {
    expect(storeBankTransferReady({})).toBe(false);
    expect(storeBankTransferReady({ bank_cbu: "  ", bank_alias: "" })).toBe(false);
    expect(storeBankTransferReady({ bank_cbu: "0000003100010000000001" })).toBe(true);
    expect(storeBankTransferReady({ bank_alias: "mi.comercio" })).toBe(true);
  });

  it("sólo pide datos bancarios si la tienda ofrece transferencia", () => {
    expect(storeOffersBankTransfer(["efectivo"])).toBe(false);
    expect(storeOffersBankTransfer(["mercadopago"])).toBe(false);
    expect(storeOffersBankTransfer(["transferencia"])).toBe(true);
    expect(storeOffersBankTransfer(["mercadopago", "transferencia"])).toBe(true);
  });

  it("Commerce, el pedido y el checklist consumen el helper", () => {
    const root = resolve(process.cwd());
    const readiness = readFileSync(resolve(root, "src/lib/storeReadiness.ts"), "utf8");
    const page = readFileSync(resolve(root, "src/pages/EcommerceStorePage.tsx"), "utf8");
    const order = readFileSync(resolve(root, "src/storefront/StoreOrder.tsx"), "utf8");
    const email = readFileSync(resolve(root, "supabase/functions/store-order-email/index.ts"), "utf8");
    expect(readiness).toContain("storeBankTransferReady");
    expect(readiness).toContain("bank-transfer");
    expect(page).toContain("storeBankTransferReady");
    expect(page).toContain("bank_cbu");
    expect(order).toContain("bank_cbu");
    expect(order).toContain("transferencia");
    expect(email).toContain("bank_cbu");
    expect(email).toContain("Datos para transferir");
  });
});
