import { describe, expect, it } from "vitest";
import { storeOrdersCanonicalPath } from "@/lib/storeOrdersCanonical";

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
});
