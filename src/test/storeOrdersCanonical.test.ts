import { describe, expect, it } from "vitest";
import {
  abandonedCartsQueueHref,
  parseStoreOrdersCola,
  storeOrdersCanonicalPath,
  storeRecoveryCanonicalPath,
} from "@/lib/storeOrdersCanonical";

describe("storeOrdersCanonicalPath", () => {
  it("arma /pedidos-online sin tab=orders", () => {
    expect(storeOrdersCanonicalPath(null)).toBe("/pedidos-online");
    expect(storeOrdersCanonicalPath("tab=orders&vista=despachar&pedido=abc")).toBe(
      "/pedidos-online?vista=despachar&pedido=abc",
    );
    expect(storeOrdersCanonicalPath("?tab=orders&q=ana")).toBe("/pedidos-online?q=ana");
    expect(storeOrdersCanonicalPath(new URLSearchParams("orden=monto&medio=transferencia"))).toBe(
      "/pedidos-online?orden=monto&medio=transferencia",
    );
  });

  it("bookmarks tab=carritos van a Recuperación", () => {
    expect(abandonedCartsQueueHref()).toBe("/pedidos-online?cola=recuperacion");
    expect(abandonedCartsQueueHref("reposicion")).toBe(
      "/pedidos-online?cola=recuperacion&vista=reposicion",
    );
    expect(storeRecoveryCanonicalPath("tab=carritos")).toBe("/pedidos-online?cola=recuperacion");
    expect(storeRecoveryCanonicalPath("?tab=carritos&vista=reposicion")).toBe(
      "/pedidos-online?cola=recuperacion&vista=reposicion",
    );
    expect(parseStoreOrdersCola("recuperacion")).toBe("recuperacion");
    expect(parseStoreOrdersCola(null)).toBe("pedidos");
  });
});
