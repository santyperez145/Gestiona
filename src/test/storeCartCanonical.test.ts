import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeStoreCartReferences,
  parseStoreCartReferences,
  rebuildStoreCart,
  storeCartReferencesFromLines,
} from "@/lib/storeCartSync";

const products = [
  {
    id: "product-1",
    name: "Producto",
    brand: "Marca",
    stock: 4,
    image_url: "/product.jpg",
    price: 100,
  },
];

describe("carrito canónico de tienda", () => {
  it("normaliza referencias y nunca suma carritos al unir dispositivos", () => {
    const device = parseStoreCartReferences([
      { product_id: "product-1", quantity: 2, unit_price: 1 },
      { product_id: "product-1", quantity: 3, unit_price: 999999 },
      { product_id: "", quantity: 1 },
    ]);
    const account = parseStoreCartReferences([
      { product_id: "product-1", quantity: 2 },
      { product_id: "product-2", variant_id: "variant-2", quantity: 1 },
    ]);

    expect(device).toEqual([{ product_id: "product-1", variant_id: null, quantity: 3 }]);
    expect(mergeStoreCartReferences(device, account)).toEqual([
      { product_id: "product-1", variant_id: null, quantity: 3 },
      { product_id: "product-2", variant_id: "variant-2", quantity: 1 },
    ]);
  });

  it("rearma nombre, precio, variante y stock desde el catálogo vigente", () => {
    const rebuilt = rebuildStoreCart(
      [
        { product_id: "product-1", variant_id: "variant-1", quantity: 8 },
        { product_id: "deleted", variant_id: null, quantity: 1 },
      ],
      products,
      {
        "product-1": [{
          id: "variant-1",
          variant_name: "Grande",
          stock: 2,
          price_override: 150,
          image_url: "/variant.jpg",
        }],
      },
      (product) => product.price,
    );

    expect(rebuilt.lines).toEqual([{
      productId: "product-1",
      variantId: "variant-1",
      name: "Producto — Grande",
      brand: "Marca",
      price: 150,
      qty: 2,
      image: "/variant.jpg",
      stock: 2,
    }]);
    expect(rebuilt.adjustedCount).toBe(1);
    expect(rebuilt.unavailableCount).toBe(1);
  });

  it("serializa sólo ids, variante y cantidad", () => {
    expect(storeCartReferencesFromLines([{
      productId: "product-1",
      variantId: "variant-1",
      qty: 2,
    }])).toEqual([{
      product_id: "product-1",
      variant_id: "variant-1",
      quantity: 2,
    }]);
  });

  it("la base resuelve líneas, vincula comprador y convierte con la orden", () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      "supabase/migrations/20260903000060_carrito_canonico.sql",
    ), "utf8");

    expect(migration).toContain("store_customer_id uuid");
    expect(migration).toContain("cart_sessions_one_active_customer");
    expect(migration).toContain("normalize_store_cart_items");
    expect(migration).toContain("public.resolve_store_line(");
    expect(migration).toContain("public.get_store_cart");
    expect(migration).toContain("public.save_store_cart_v2");
    expect(migration).toContain("public.create_store_order_idem(");
    expect(migration).toContain("SET cart_session_id = v_cart");
    expect(migration).toContain("status = 'converted'");
    expect(migration).toContain("lower(cs.customer_email) = lower");
    expect(migration).not.toContain("UPDATE public.products");
  });

  it("el cliente hidrata antes de guardar y el checkout entrega el token", () => {
    const context = readFileSync(resolve(process.cwd(), "src/storefront/storeContext.tsx"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    const recovery = readFileSync(resolve(process.cwd(), "src/storefront/StoreCartRecovery.tsx"), "utf8");
    const auth = readFileSync(resolve(process.cwd(), "src/storefront/storeAuth.tsx"), "utf8");
    const storefront = readFileSync(resolve(process.cwd(), "src/pages/StorefrontPage.tsx"), "utf8");

    expect(context).toContain("getActiveStoreCart");
    expect(context).toContain("if (!cartHydrated");
    expect(context).toContain("legacyLocalNeedsMerge");
    expect(context).toContain("saveActiveStoreCart");
    expect(context).toContain("console.error");
    expect(checkout).toContain("p_cart_token: cartToken || null");
    expect(checkout).toContain("cartLinked");
    expect(recovery).toContain("restoreCart(items)");
    expect(recovery).not.toContain("for (const it of items)");
    expect(auth).toContain('.eq("id", customerId)');
    expect(storefront.indexOf("<StoreAuthProvider")).toBeLessThan(storefront.indexOf("<StoreProvider"));
  });
});
