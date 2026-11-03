import { describe, expect, it } from "vitest";
import { pasosDelArmado } from "@/lib/storeFirstPublish";

const blocker = (id: string, done: boolean) => ({ id, done, severity: "blocker" });

describe("pasos del armado de la tienda", () => {
  it("sin tienda, después del primer producto, sólo el producto está hecho", () => {
    const pasos = pasosDelArmado({ storeExists: false, storeActive: false, fromWizard: true, checks: [blocker("products", false)] });
    expect(pasos.map(p => p.done)).toEqual([true, false, false, false, false, false]);
  });

  it("sigue las mismas reglas que deciden si se puede publicar", () => {
    const pasos = pasosDelArmado({
      storeExists: true, storeActive: false, fromWizard: true,
      checks: [blocker("products", true), blocker("payments", true), blocker("bank-transfer", true),
        blocker("pickup-address", false), blocker("legal-pages", false)],
    });
    expect(Object.fromEntries(pasos.map(p => [p.id, p.done]))).toEqual({
      producto: true, link: true, cobro: true, entrega: false, legales: false, publicar: false,
    });
  });

  it("un aviso que no bloquea no deja la entrega pendiente", () => {
    const pasos = pasosDelArmado({
      storeExists: true, storeActive: true, fromWizard: false,
      checks: [blocker("products", true), { id: "shipping-rates", done: false, severity: "warning" }],
    });
    expect(pasos.every(p => p.done)).toBe(true);
  });
});
