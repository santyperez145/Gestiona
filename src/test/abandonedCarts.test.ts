import { describe, expect, it } from "vitest";
import {
  abandonedCartItemCount,
  abandonedCartRecoveryChannelCopy,
  abandonedCartRecoveryHref,
  abandonedCartRecoveryLabel,
  abandonedCartRecoveryState,
  abandonedCartsQueueHref,
  filterAbandonedCartsForQueue,
  isRecoverableAbandonedCart,
  ABANDONED_CART_IDLE_MS,
} from "@/lib/abandonedCarts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("abandonedCarts", () => {
  it("cuenta cantidades reales de ítems", () => {
    expect(abandonedCartItemCount([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
    expect(abandonedCartItemCount([{ name: "x" }])).toBe(1);
    expect(abandonedCartItemCount(null)).toBe(0);
  });

  it("distingue enviado, pendiente y sin email", () => {
    expect(abandonedCartRecoveryState({ abandoned_email_sent: true, customer_email: "a@b.c" }))
      .toBe("enviado");
    expect(abandonedCartRecoveryState({ abandoned_email_sent: false, customer_email: "a@b.c" }))
      .toBe("pendiente");
    expect(abandonedCartRecoveryState({ abandoned_email_sent: false, customer_email: null }))
      .toBe("sin_email");
    expect(abandonedCartRecoveryLabel("pendiente")).toContain("Pendiente");
  });

  it("la cola incluye active idle con email (como el cron), no sólo abandoned", () => {
    const now = Date.parse("2026-09-03T15:00:00Z");
    const rows = filterAbandonedCartsForQueue([
      {
        id: "1", status: "abandoned", customer_email: "a@b.c", items: [{ quantity: 1 }],
        subtotal: 10, total: 10, abandoned_email_sent: false,
        updated_at: "2026-09-02T12:00:00Z", created_at: "2026-09-02T11:00:00Z",
      },
      {
        id: "2", status: "abandoned", customer_email: null, items: [],
        subtotal: 0, total: 0, abandoned_email_sent: false,
        updated_at: "2026-09-02T13:00:00Z", created_at: "2026-09-02T13:00:00Z",
      },
      {
        id: "3", status: "active", customer_email: "c@d.e", items: [{ quantity: 2 }],
        subtotal: 20, total: 20, abandoned_email_sent: false,
        updated_at: "2026-09-03T13:00:00Z", created_at: "2026-09-03T12:00:00Z",
      },
      {
        id: "4", status: "active", customer_email: "fresh@d.e", items: [{ quantity: 1 }],
        subtotal: 5, total: 5, abandoned_email_sent: false,
        updated_at: "2026-09-03T14:30:00Z", created_at: "2026-09-03T14:30:00Z",
      },
    ], now);
    expect(rows.map((r) => r.id)).toEqual(["3", "1"]);
    expect(isRecoverableAbandonedCart({
      status: "active",
      customer_email: "x@y.z",
      items: [{ quantity: 1 }],
      updated_at: new Date(now - ABANDONED_CART_IDLE_MS - 1).toISOString(),
    }, now)).toBe(true);
    expect(isRecoverableAbandonedCart({
      status: "active",
      customer_email: "x@y.z",
      items: [{ quantity: 1 }],
      updated_at: new Date(now - 1000).toISOString(),
    }, now)).toBe(false);
  });

  it("el deep-link y Commerce exponen la cola", () => {
    expect(abandonedCartsQueueHref()).toBe("/tienda-online?tab=carritos");
    const page = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(page).toContain('"carritos"');
    expect(page).toContain("AbandonedCartsPanel");
    expect(page).toContain("recovery_token");
    expect(page).toContain("storeSlug={store?.slug");
    const focus = readFileSync(resolve(process.cwd(), "src/lib/dashboardFocus.ts"), "utf8");
    expect(focus).toContain("carritosAbandonados");
    expect(focus).toContain("/tienda-online?tab=carritos");
  });

  it("arma el deep-link de recuperación con slug y token", () => {
    expect(abandonedCartRecoveryHref("mi-tienda", "tok-1")).toBe("/tienda/mi-tienda/carrito/tok-1");
    expect(abandonedCartRecoveryHref("", "tok-1")).toBeNull();
    expect(abandonedCartRecoveryHref("mi-tienda", null)).toBeNull();
    expect(abandonedCartRecoveryChannelCopy({ hasStoreSlug: false }).title).toMatch(/slug/i);
    expect(abandonedCartRecoveryChannelCopy({ hasStoreSlug: true }).body).toMatch(/SMTP|mensajer|WhatsApp/i);
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/AbandonedCartsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("abandonedCartRecoveryHref");
    expect(panel).toContain("abandonedCartRecoveryChannelCopy");
    expect(panel).toContain("Copiar");
    expect(panel).toContain("Abrir");
  });

  it("el checkout manda el email a save_store_cart (Shopify recovery)", () => {
    const ctx = readFileSync(resolve(process.cwd(), "src/storefront/storeContext.tsx"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    expect(ctx).toContain("rememberCartEmail");
    expect(ctx).toContain("p_email: cartEmail");
    expect(ctx).not.toContain("p_email: null");
    expect(checkout).toContain("rememberCartEmail(form.email)");
    const cron = readFileSync(
      resolve(process.cwd(), "supabase/functions/recover-abandoned-carts/index.ts"),
      "utf8",
    );
    expect(cron).toContain("falta PUBLIC_BASE_URL");
    expect(cron).not.toMatch(/\$\{link \? `/);
  });
});
