import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: cada visita a la tienda pedía la ficha del comprador hasta 4 veces.
describe("la ficha del comprador se pide una vez por usuario", () => {
  const src = fs.readFileSync("src/storefront/storeAuth.tsx", "utf8");
  it("la renovación del token o el evento inicial no la vuelven a pedir", () => {
    expect(src).toContain('if (s.user.id !== usuarioCargado.current || event === "USER_UPDATED")');
  });
  it("dos pedidos a la vez comparten el mismo", () => {
    expect(src).toContain("if (!forzar && enCurso.current?.clave === clave) return enCurso.current.promesa;");
  });
});
