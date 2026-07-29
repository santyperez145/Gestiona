import { describe, it, expect } from "vitest";
import { shouldAutoReload, LOOP_WINDOW_MS } from "@/lib/swUpdate";

const AHORA = 1_800_000_000_000;

describe("shouldAutoReload", () => {
  it("recarga la primera vez, cuando no hay marca previa", () => {
    expect(shouldAutoReload(null, AHORA)).toBe(true);
  });

  it("NO recarga si acaba de recargar — eso sería un loop", () => {
    expect(shouldAutoReload(AHORA - 200, AHORA)).toBe(false);
    expect(shouldAutoReload(AHORA - (LOOP_WINDOW_MS - 1), AHORA)).toBe(false);
  });

  it("SÍ recarga ante un deploy posterior en la misma sesión", () => {
    // El bug original: un flag sin vencimiento hacía que después de la primera
    // recarga ningún deploy volviera a aplicarse y la app quedaba vieja.
    expect(shouldAutoReload(AHORA - 60_000, AHORA)).toBe(true);
    expect(shouldAutoReload(AHORA - 3_600_000, AHORA)).toBe(true);
  });

  it("el límite exacto de la ventana ya habilita la recarga", () => {
    expect(shouldAutoReload(AHORA - LOOP_WINDOW_MS, AHORA)).toBe(true);
  });

  it("una marca corrupta no bloquea la actualización", () => {
    // sessionStorage devuelve texto: Number('basura') es NaN.
    expect(shouldAutoReload(NaN, AHORA)).toBe(true);
  });
});
