import { describe, expect, it } from "vitest";
import { afipIvaId } from "../../supabase/functions/_shared/afipIva";

describe("alicuotas enviadas a WSFE", () => {
  it.each([
    [0, 3], [2.5, 9], [5, 8], [10.5, 4], [21, 5], [27, 6],
  ])("convierte %s%% al Id %i", (rate, id) => {
    expect(afipIvaId(rate)).toBe(id);
  });

  it("rechaza porcentajes no soportados en vez de declararlos como IVA cero", () => {
    expect(() => afipIvaId(17)).toThrow("no esta admitida");
    expect(() => afipIvaId(Number.NaN)).toThrow("no esta admitida");
  });
});
