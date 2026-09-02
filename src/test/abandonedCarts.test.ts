import { describe, expect, it } from "vitest";
import {
  abandonedCartItemCount,
  abandonedCartRecoveryLabel,
  abandonedCartRecoveryState,
  abandonedCartsQueueHref,
  filterAbandonedCartsForQueue,
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

  it("la cola ignora vacíos y no-abandonados", () => {
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
        updated_at: "2026-09-02T14:00:00Z", created_at: "2026-09-02T14:00:00Z",
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("el deep-link y Commerce exponen la cola", () => {
    expect(abandonedCartsQueueHref()).toBe("/tienda-online?tab=carritos");
    const page = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(page).toContain('"carritos"');
    expect(page).toContain("AbandonedCartsPanel");
    const focus = readFileSync(resolve(process.cwd(), "src/lib/dashboardFocus.ts"), "utf8");
    expect(focus).toContain("carritosAbandonados");
    expect(focus).toContain("/tienda-online?tab=carritos");
  });
});
