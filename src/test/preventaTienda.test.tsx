import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { enPreventa, fechaDeLlegada, textoPreventa, topeDeCompra, unidadesEnPreventa } from "@/lib/preventa";
import { rebuildStoreCart } from "@/lib/storeCartSync";

const m = vi.hoisted(() => ({ addToCart: vi.fn() }));
vi.mock("@/storefront/storeContext", () => ({
  useStore: () => ({
    priceOf: (p: { sale_price_ars: number }) => p.sale_price_ars,
    fmt: (n: number) => `$${n}`,
    addToCart: m.addToCart,
    reviewsByProduct: {},
    variantsByProduct: {},
    basePath: "/tienda/zz",
  }),
}));
vi.mock("@/storefront/PrecioMayorista", () => ({
  default: () => null,
  PrecioReservado: () => null,
  usePrecioReservado: () => false,
}));
vi.mock("@/storefront/wishlist", () => ({ useWishlist: () => ({ has: () => false, toggle: vi.fn() }) }));

const { default: ProductCard } = await import("@/storefront/ProductCard");

const producto = (extra: Record<string, unknown> = {}) => ({
  id: "zz-consola", name: "ZZ Consola", brand: null, category: null, gender: null, description: null,
  sale_price_ars: 1000, discount_price_ars: null, price_2x_ars: null, payment_base_price: null, promo_price: null,
  stock: 0, image_url: null, image_urls: null, content_ml: null, featured: null, total_sold: null,
  created_at: "2026-10-01T00:00:00Z", ...extra,
});

describe("preventa en la tienda", () => {
  it("el tope de compra con preventa es lo vendible; sin preventa, el stock", () => {
    expect(topeDeCompra(2, { llega: "2026-11-20", vendible: 7 })).toBe(7);
    expect(topeDeCompra(2, null)).toBe(2);
    expect(topeDeCompra(-3, null)).toBe(0);
    expect(enPreventa({ llega: "2026-11-20", vendible: 0 })).toBe(false);
    expect(enPreventa({ llega: "", vendible: 3 })).toBe(false);
    expect(enPreventa({ llega: "2026-11-20", vendible: 3 })).toBe(true);
  });

  it("con stock se vende primero lo que hay; el resto es preventa", () => {
    expect(unidadesEnPreventa(4, 2)).toBe(2);
    expect(unidadesEnPreventa(1, 2)).toBe(0);
    expect(unidadesEnPreventa(3, -2)).toBe(3);
  });

  it("le dice al comprador cuándo llega y qué parte es de preventa", () => {
    expect(fechaDeLlegada("2026-11-20")).toBe("20/11");
    expect(textoPreventa(0, "2026-11-20")).toBe("Preventa: llega aprox. el 20/11.");
    expect(textoPreventa(1, "2026-11-20")).toBe("1 unidad es de preventa: se despacha cuando llegue la mercadería (aprox. el 20/11).");
    expect(textoPreventa(3, "2026-11-20")).toBe("3 unidades son de preventa: se despachan cuando llegue la mercadería (aprox. el 20/11).");
  });

  it("al recuperar el carrito, una preventa no se da por agotada y conserva qué parte llega después", () => {
    const rebuilt = rebuildStoreCart(
      [{ product_id: "zz-consola", variant_id: null, quantity: 9 }],
      [{ id: "zz-consola", name: "ZZ Consola", brand: null, stock: 2, image_url: null, preventa: { llega: "2026-11-20", vendible: 7 } }],
      {},
      () => 1000,
    );
    expect(rebuilt.unavailableCount).toBe(0);
    expect(rebuilt.lines[0]).toMatchObject({ qty: 7, stock: 7, preventa: { llega: "2026-11-20", enStock: 2 } });
  });

  it("la tarjeta ofrece comprar en preventa en vez de «Sin stock»", () => {
    render(<MemoryRouter><ProductCard p={{ ...producto(), preventa: { llega: "2026-11-20", vendible: 5 } }} /></MemoryRouter>);
    expect(screen.getByText("Preventa")).toBeVisible();
    expect(screen.getByText("Preventa: llega aprox. el 20/11")).toBeVisible();
    expect(screen.queryByText("Sin stock")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Comprar en preventa" }).click();
    expect(m.addToCart).toHaveBeenCalled();
  });

  it("sin preventa, la tarjeta sigue diciendo «Sin stock»", () => {
    render(<MemoryRouter><ProductCard p={producto()} /></MemoryRouter>);
    expect(screen.getByText("Sin stock")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Comprar en preventa" })).not.toBeInTheDocument();
  });

  it("la tienda lee las preventas, la ficha, el carrito, el checkout y el pedido las muestran", () => {
    expect(readFileSync("src/storefront/storeContext.tsx", "utf8")).toContain('supabase.rpc("get_store_preventas" as never');
    expect(readFileSync("src/storefront/StoreProduct.tsx", "utf8")).toContain("onClick={() => setQty(q => Math.min(topeEfectivo, q + 1))}");
    expect(readFileSync("src/storefront/StoreCart.tsx", "utf8")).toContain("textoPreventa(unidadesEnPreventa(l.qty, l.preventa.enStock), l.preventa.llega)");
    expect(readFileSync("src/storefront/StoreCheckout.tsx", "utf8")).toContain("Tu pedido incluye preventa");
    expect(readFileSync("src/storefront/StoreOrder.tsx", "utf8")).toContain("textoPreventa(Number(it.preventa.cantidad), String(it.preventa.llega))");
  });
});
