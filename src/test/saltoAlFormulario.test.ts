import { describe, expect, it } from "vitest";
import { storeShouldJumpToIdentityForm } from "@/lib/storeFirstPublish";

/**
 * Del asistente sin tienda se va directo al formulario, pero sólo si la lista
 * de tiendas ya se leyó y está vacía (E2E del primer día, 2026-11-03).
 */
describe("salto al formulario de la tienda", () => {
  const base = { fromWizard: true, tab: "overview", storesLoaded: true, storesLoading: false, storeCount: 0 };

  it("salta cuando el asistente llega y la organización no tiene tienda", () => {
    expect(storeShouldJumpToIdentityForm(base)).toBe(true);
  });

  it("no salta mientras la lista no se leyó: el primer render parece «sin tienda»", () => {
    expect(storeShouldJumpToIdentityForm({ ...base, storesLoaded: false })).toBe(false);
    expect(storeShouldJumpToIdentityForm({ ...base, storesLoading: true })).toBe(false);
  });

  it("no salta si ya hay tienda, fuera del asistente o en otra pestaña", () => {
    expect(storeShouldJumpToIdentityForm({ ...base, storeCount: 1 })).toBe(false);
    expect(storeShouldJumpToIdentityForm({ ...base, fromWizard: false })).toBe(false);
    expect(storeShouldJumpToIdentityForm({ ...base, tab: "pages" })).toBe(false);
  });
});
