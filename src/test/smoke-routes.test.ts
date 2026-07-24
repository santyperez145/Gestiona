import { describe, expect, it } from "vitest";

// ── Smoke test de páginas ────────────────────────────────────────
// Auto-descubre TODAS las páginas bajo src/pages/*.tsx con import.meta.glob.
// Esto garantiza que el test nunca queda desactualizado: cada página nueva
// se incluye sola, y cada página borrada desaparece sin tocar este archivo.
//
// Qué cubre: que cada módulo de página se importe sin lanzar en tiempo de
// import (side-effects a nivel módulo, imports rotos, referencias colgantes)
// y que exponga un componente por default export. Es la red de seguridad más
// barata para 80+ páginas y corre en milisegundos.

const pageModules = import.meta.glob("../pages/*.tsx");

const entries = Object.entries(pageModules).map(([path, importer]) => {
  const name = path.split("/").pop()!.replace(/\.tsx$/, "");
  return { name, importer } as const;
});

describe("smoke: todas las páginas se importan sin romper", () => {
  it("descubre el set completo de páginas", () => {
    // Guardarraíl: si este número cae bruscamente, algo borró páginas sin querer.
    expect(entries.length).toBeGreaterThanOrEqual(75);
  });

  it.each(entries)("importa $name y expone un componente por default", async ({ importer }) => {
    const mod = (await importer()) as { default: unknown };
    expect(mod).toBeDefined();
    expect(mod.default).toBeTypeOf("function");
  });
});
