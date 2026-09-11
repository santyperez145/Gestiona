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
  parseRecoveryEmailChannel,
  summarizeRecovery,
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

  it("distingue enviado, pendiente, sin email y canal no listo", () => {
    expect(abandonedCartRecoveryState({ abandoned_email_sent: true, customer_email: "a@b.c" }))
      .toBe("enviado");
    expect(abandonedCartRecoveryState({ abandoned_email_sent: false, customer_email: "a@b.c" }))
      .toBe("pendiente");
    expect(abandonedCartRecoveryState({ abandoned_email_sent: false, customer_email: null }))
      .toBe("sin_email");
    expect(abandonedCartRecoveryState(
      { abandoned_email_sent: false, customer_email: "a@b.c" },
      { ready: false },
    )).toBe("canal_no_listo");
    expect(abandonedCartRecoveryState(
      { abandoned_email_sent: false, customer_email: "a@b.c" },
      { ready: true },
    )).toBe("pendiente");
    expect(abandonedCartRecoveryLabel("pendiente")).toContain("Pendiente");
    expect(abandonedCartRecoveryLabel("canal_no_listo")).toMatch(/no configurado/i);
  });

  it("la cola incluye active idle con email (como el cron), no sólo abandoned", () => {
    const now = Date.parse("2026-09-03T15:00:00Z");
    const rows = filterAbandonedCartsForQueue([
      {
        id: "1", status: "abandoned", customer_email: "a@b.c", items: [{ quantity: 1 }],
        subtotal: 10, total: 10, abandoned_email_sent: false,
        expires_at: "2026-10-02T12:00:00Z", updated_at: "2026-09-02T12:00:00Z", created_at: "2026-09-02T11:00:00Z",
      },
      {
        id: "2", status: "abandoned", customer_email: null, items: [],
        subtotal: 0, total: 0, abandoned_email_sent: false,
        expires_at: "2026-10-02T13:00:00Z", updated_at: "2026-09-02T13:00:00Z", created_at: "2026-09-02T13:00:00Z",
      },
      {
        id: "3", status: "active", customer_email: "c@d.e", items: [{ quantity: 2 }],
        subtotal: 20, total: 20, abandoned_email_sent: false,
        expires_at: "2026-10-03T13:00:00Z", updated_at: "2026-09-03T13:00:00Z", created_at: "2026-09-03T12:00:00Z",
      },
      {
        id: "4", status: "active", customer_email: "fresh@d.e", items: [{ quantity: 1 }],
        subtotal: 5, total: 5, abandoned_email_sent: false,
        expires_at: "2026-10-03T14:30:00Z", updated_at: "2026-09-03T14:30:00Z", created_at: "2026-09-03T14:30:00Z",
      },
    ], now);
    expect(rows.map((r) => r.id)).toEqual(["3", "1"]);
    expect(isRecoverableAbandonedCart({
      status: "active",
      customer_email: "x@y.z",
      items: [{ quantity: 1 }],
      expires_at: "2026-10-03T15:00:00Z",
      updated_at: new Date(now - ABANDONED_CART_IDLE_MS - 1).toISOString(),
    }, now)).toBe(true);
    expect(isRecoverableAbandonedCart({
      status: "active",
      customer_email: "x@y.z",
      items: [{ quantity: 1 }],
      expires_at: "2026-10-03T15:00:00Z",
      updated_at: new Date(now - 1000).toISOString(),
    }, now)).toBe(false);
    expect(isRecoverableAbandonedCart({
      status: "active",
      customer_email: "expired@y.z",
      items: [{ quantity: 1 }],
      expires_at: "2026-09-03T14:59:59Z",
      updated_at: "2026-09-03T12:00:00Z",
    }, now)).toBe(false);
  });

  it("el deep-link aterriza en Pedidos → Recuperación", () => {
    expect(abandonedCartsQueueHref()).toBe("/pedidos-online?cola=recuperacion");
    const ordersPage = readFileSync(resolve(process.cwd(), "src/pages/StoreOrdersPage.tsx"), "utf8");
    expect(ordersPage).toContain("StoreRecoveryWorkspace");
    expect(ordersPage).toContain("recuperacion");
    const recovery = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
      "utf8",
    );
    expect(recovery).toContain("AbandonedCartsPanel");
    expect(recovery).toContain("recovery_token");
    expect(recovery).toContain("storeSlug={storeSlug");
    const commerce = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(commerce).toContain("storeRecoveryCanonicalPath");
    expect(commerce).toContain('requestedTab === "carritos"');
    expect(commerce).not.toContain("AbandonedCartsPanel");
    const focus = readFileSync(resolve(process.cwd(), "src/lib/dashboardFocus.ts"), "utf8");
    expect(focus).toContain("carritosAbandonados");
    expect(focus).toContain("/pedidos-online?cola=recuperacion");
  });

  it("arma el deep-link de recuperación con slug y token", () => {
    expect(abandonedCartRecoveryHref("mi-tienda", "tok-1")).toBe("/tienda/mi-tienda/carrito/tok-1");
    expect(abandonedCartRecoveryHref("", "tok-1")).toBeNull();
    expect(abandonedCartRecoveryHref("mi-tienda", null)).toBeNull();
    expect(abandonedCartRecoveryChannelCopy({ hasStoreSlug: false }).title).toMatch(/slug/i);
    expect(abandonedCartRecoveryChannelCopy({ hasStoreSlug: true }).body).toMatch(/SMTP|mensajer|WhatsApp|correo/i);
    expect(abandonedCartRecoveryChannelCopy({
      hasStoreSlug: true,
      channel: { ready: false, merchantSmtp: false, platformEmail: false },
    }).title).toMatch(/no puede salir/i);
    expect(parseRecoveryEmailChannel({
      ready: true, merchant_smtp: false, platform_email: true,
    })).toEqual({ ready: true, merchantSmtp: false, platformEmail: true });
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/AbandonedCartsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("abandonedCartRecoveryHref");
    expect(panel).toContain("abandonedCartRecoveryChannelCopy");
    expect(panel).toContain("emailChannel");
    expect(panel).toContain("Copiar");
    expect(panel).toContain("Abrir");
    const recovery = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
      "utf8",
    );
    expect(recovery).toContain("recovery_email_channel_ready");
    expect(recovery).toContain("parseRecoveryEmailChannel");
    const migracion = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260907000010_recovery_email_channel_ready.sql"),
      "utf8",
    );
    expect(migracion).toContain("recovery_email_channel_ready");
    expect(migracion).toContain("is_org_member");
    expect(migracion).toContain("REVOKE ALL");
    const cron = readFileSync(
      resolve(process.cwd(), "supabase/functions/recover-abandoned-carts/index.ts"),
      "utf8",
    );
    expect(cron).toContain("sin canal de email");
  });

  it("el checkout manda el email a save_store_cart (Shopify recovery)", () => {
    const ctx = readFileSync(resolve(process.cwd(), "src/storefront/storeContext.tsx"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    expect(ctx).toContain("rememberCartEmail");
    expect(ctx).toContain("email: cartEmail");
    expect(ctx).not.toContain("email: null");
    expect(checkout).toContain("rememberCartEmail(form.email)");
    const cron = readFileSync(
      resolve(process.cwd(), "supabase/functions/recover-abandoned-carts/index.ts"),
      "utf8",
    );
    expect(cron).toContain("falta PUBLIC_BASE_URL");
    expect(cron).not.toMatch(/\$\{link \? `/);
  });

  it("resume recuperación con población, resultado y salud sin inventar canal", () => {
    const now = Date.parse("2026-09-11T15:00:00Z");
    const rows = [
      {
        id: "1", status: "active", customer_email: "a@b.c", items: [{ quantity: 1 }],
        subtotal: 100, total: 100, abandoned_email_sent: true,
        expires_at: "2026-10-11T15:00:00Z", updated_at: "2026-09-11T10:00:00Z", created_at: "2026-09-11T09:00:00Z",
      },
      {
        id: "2", status: "converted", customer_email: "c@d.e", items: [{ quantity: 2 }],
        subtotal: 250, total: 250, abandoned_email_sent: true,
        expires_at: "2026-10-11T15:00:00Z", updated_at: "2026-09-10T10:00:00Z", created_at: "2026-09-10T09:00:00Z",
      },
      {
        id: "3", status: "abandoned", customer_email: "e@f.g", items: [{ quantity: 1 }],
        subtotal: 80, total: 80, abandoned_email_sent: false,
        expires_at: "2026-10-11T15:00:00Z", updated_at: "2026-09-10T11:00:00Z", created_at: "2026-09-10T10:00:00Z",
      },
    ] as const;

    const resumen = summarizeRecovery(rows as unknown as never, { ready: true }, { failures_7d: 0, last_invoked_at: "2026-09-11T14:00:00Z" }, now);
    expect(resumen.pendientes).toBe(2);
    expect(resumen.avisosEnviados).toBe(1);
    expect(resumen.convertidos).toBe(1);
    expect(resumen.convertidoTotal).toBe(250);
    expect(resumen.canalListo).toBe(true);
    expect(resumen.automaticoSano).toBe(true);
    expect(resumen.ultimaCorridaAt).toBe("2026-09-11T14:00:00Z");

    const sinCanal = summarizeRecovery(rows as unknown as never, { ready: false }, { failures_7d: 0 }, now);
    expect(sinCanal.canalListo).toBe(false);
    expect(sinCanal.automaticoSano).toBe(true);

    const conFalla = summarizeRecovery(rows as unknown as never, { ready: true }, { failures_7d: 2 }, now);
    expect(conFalla.automaticoSano).toBe(false);
  });

  it("la migración de salud del canal queda revocada a público y verificada", () => {
    const migracion = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260911000020_recovery_channel_health.sql"),
      "utf8",
    );
    expect(migracion).toContain("recovery_channel_health");
    expect(migracion).toContain("edge_invocation_log");
    expect(migracion).toContain("is_org_member");
    expect(migracion).toContain("REVOKE ALL");
    expect(migracion).toContain("ASSERT");
    expect(migracion).not.toMatch(/GRANT EXECUTE.*TO anon/i);
    const workspace = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
      "utf8",
    );
    expect(workspace).toContain("recovery_channel_health");
    expect(workspace).toContain("summarizeRecovery");
    expect(workspace).toContain("recoverySummary");
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/ecommerce/AbandonedCartsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("summary");
    expect(panel).toContain("convertidoTotal");
    expect(panel).toContain("Automático al día");
  });
});
