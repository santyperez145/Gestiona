import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkoutDebeIntentarCuenta } from "@/lib/storeCheckoutAccount";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("el catálogo no compite con la tienda que cobra", () => {
  it("el panel arma el link canónico con enlaceCanonicoDeVitrina", () => {
    const page = leer("src/pages/CatalogPage.tsx");
    expect(page).toContain("enlaceCanonicoDeVitrina");
    expect(page).toContain("ecommerce_stores");
    expect(page).toContain("kind === \"tienda\"");
  });

  it("el catálogo público manda a la tienda si hay slug publicado", () => {
    const page = leer("src/pages/PublicCatalogPage.tsx");
    const ds = leer("src/lib/publicDataSource.ts");
    expect(ds).toContain("get_published_store_slug");
    expect(page).toContain("fetchPublishedStoreSlugForOrg");
    expect(page).toContain("/tienda/");
    expect(page).toContain("Pedir por WhatsApp");
  });
});

describe("cuenta opcional en checkout", () => {
  it("el invitado no está obligado y una cuenta tonta no se intenta", () => {
    expect(checkoutDebeIntentarCuenta({
      yaTieneCuenta: false, quiereCuenta: false, password: "",
    })).toEqual({ intentar: false });
    expect(checkoutDebeIntentarCuenta({
      yaTieneCuenta: true, quiereCuenta: true, password: "abcdef",
    })).toEqual({ intentar: false });
    const corta = checkoutDebeIntentarCuenta({
      yaTieneCuenta: false, quiereCuenta: true, password: "123",
    });
    expect("error" in corta && corta.error).toMatch(/6 caracteres/);
    expect(checkoutDebeIntentarCuenta({
      yaTieneCuenta: false, quiereCuenta: true, password: "secret1",
    })).toEqual({ intentar: true });
  });

  it("el checkout llama signUp después de crear la orden y conserva el invitado", () => {
    const checkout = leer("src/storefront/StoreCheckout.tsx");
    expect(checkout).toContain("Comprás como invitado");
    expect(checkout).toContain("checkoutDebeIntentarCuenta");
    expect(checkout).toContain("signUp");
    expect(checkout).toContain("Crear cuenta");
  });
});

describe("influencer no manda al catálogo WhatsApp si hay tienda", () => {
  it("Influencers copia enlaceInfluencerConRef y captura ?ref= en la tienda", () => {
    const page = leer("src/pages/InfluencersPage.tsx");
    const layout = leer("src/storefront/StoreLayout.tsx");
    const checkout = leer("src/storefront/StoreCheckout.tsx");
    const mig = leer("supabase/migrations/20260903000040_referral_orden_tienda.sql");
    expect(page).toContain("enlaceInfluencerConRef");
    expect(page).not.toMatch(/\/catalogo\/\$\{user/);
    expect(layout).toContain("captureStoreReferral");
    expect(checkout).toContain("notesWithStoreReferral");
    expect(mig).toContain("ecommerce_orders");
    expect(mig).toContain("referral_code");
    expect(mig).toContain("trg_sales_referral_from_store_order");
  });
});
