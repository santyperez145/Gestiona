import { describe, expect, it } from "vitest";
import { ESTA_PESTANA, esDeEstaPestana } from "@/lib/broadcastSync";

/**
 * Guardar un producto mostraba «Producto actualizado en otra pestaña» en la
 * misma pestaña (recorrido del primer día, 2026-11-02).
 */
describe("sincronización entre pestañas", () => {
  it("reconoce los mensajes que mandó esta misma pestaña", () => {
    expect(esDeEstaPestana({ type: "product_saved", pestana: ESTA_PESTANA })).toBe(true);
    expect(esDeEstaPestana({ type: "product_saved", pestana: "otra" })).toBe(false);
    expect(esDeEstaPestana({ type: "product_saved" })).toBe(false);
    expect(esDeEstaPestana(null)).toBe(false);
  });
});
