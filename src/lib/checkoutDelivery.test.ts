import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decisionEntregaCheckout,
  puedeConfirmarEntrega,
  requiereDireccionDeEntrega,
} from "./checkoutDelivery";

describe("requiereDireccionDeEntrega", () => {
  it("no pide domicilio al retiro en tienda", () => {
    expect(requiereDireccionDeEntrega({ carrier: "retiro" }, true)).toBe(false);
  });

  it("pide domicilio para cualquier envío", () => {
    expect(requiereDireccionDeEntrega({ carrier: "andreani" }, true)).toBe(true);
    expect(requiereDireccionDeEntrega({ carrier: "propio" }, false)).toBe(true);
  });

  it("antes de cotizar sólo omite la dirección si existe retiro", () => {
    expect(requiereDireccionDeEntrega(null, true)).toBe(false);
    expect(requiereDireccionDeEntrega(null, false)).toBe(true);
  });
});

describe("decisionEntregaCheckout", () => {
  const retiro = { option_id: "retiro", carrier: "retiro" };
  const caba = { option_id: "correo_argentino:domicilio", carrier: "correo_argentino" };

  it("Córdoba + retiro informa y deja confirmar — no apaga el botón", () => {
    const d = decisionEntregaCheckout({
      quoting: false,
      options: [retiro],
      selectedId: "retiro",
      province: "AR-X",
      zonesMode: true,
    });
    expect(d.info).toMatch(/retirar en tienda/i);
    expect(d.bloqueo).toBeNull();
    expect(puedeConfirmarEntrega({
      quoting: false,
      options: [retiro],
      selectedId: "retiro",
      province: "AR-X",
      zonesMode: true,
    })).toBe(true);
  });

  it("provincia sin domicilio ni retiro no confirma", () => {
    const d = decisionEntregaCheckout({
      quoting: false,
      options: [],
      selectedId: null,
      province: "AR-X",
      zonesMode: true,
    });
    expect(d.bloqueo).toMatch(/no hacemos envíos/i);
    expect(puedeConfirmarEntrega({
      quoting: false,
      options: [],
      selectedId: null,
      province: "AR-X",
      zonesMode: true,
    })).toBe(false);
  });

  it("CABA con tarifario confirma el domicilio", () => {
    expect(puedeConfirmarEntrega({
      quoting: false,
      options: [retiro, caba],
      selectedId: "correo_argentino:domicilio",
      province: "AR-C",
      zonesMode: true,
    })).toBe(true);
  });

  it("un domicilio que no está en la cotización no pasa", () => {
    const d = decisionEntregaCheckout({
      quoting: false,
      options: [retiro],
      selectedId: "correo_argentino:domicilio",
      province: "AR-X",
      zonesMode: true,
    });
    expect(d.bloqueo).toMatch(/retiro/i);
  });

  it("sin RPC de cotización no finge un 'no hay envío'", () => {
    expect(puedeConfirmarEntrega({
      quoting: false,
      quoteUnavailable: true,
      options: [],
      selectedId: null,
      province: "AR-X",
      zonesMode: true,
    })).toBe(true);
  });

  it("el checkout usa la decisión, no el aviso como traba", () => {
    const src = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    expect(src).toContain("decisionEntregaCheckout");
    expect(src).toContain("entrega.bloqueo");
    expect(src).not.toContain("envioAviso");
  });
});
