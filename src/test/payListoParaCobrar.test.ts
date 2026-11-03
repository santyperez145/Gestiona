import { beforeEach, describe, expect, it, vi } from "vitest";

const filas = vi.hoisted(() => ({ vista: null as unknown, medio: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve({ data: tabla === "payment_connection_status" ? filas.vista : filas.medio, error: null });
      return q;
    },
  },
}));

import { fetchPaymentStatus } from "@/lib/paymentStatus";

/**
 * «Puede cobrar» es cuenta conectada y medio habilitado, como gestiona_pay_listo
 * en la base (2026-11-03): con el medio apagado el checklist decía que se podía
 * publicar y la base lo rechazaba.
 */
describe("Nerqia Pay listo para cobrar", () => {
  beforeEach(() => { filas.vista = null; filas.medio = null; });

  it("conectada y habilitada: puede cobrar", async () => {
    filas.vista = { connected: true, nickname: "ZZ" };
    filas.medio = { habilitado: true, conectado_at: "2026-11-01T00:00:00Z" };
    expect(await fetchPaymentStatus("zz-org")).toEqual({ connected: true, nickname: "ZZ", listoParaCobrar: true });
  });

  it("conectada pero con el medio apagado: la cuenta figura vinculada, pero no cobra", async () => {
    filas.vista = { connected: true, nickname: "ZZ" };
    filas.medio = { habilitado: false, conectado_at: "2026-11-01T00:00:00Z" };
    const estado = await fetchPaymentStatus("zz-org");
    expect(estado.connected).toBe(true);
    expect(estado.listoParaCobrar).toBe(false);
  });

  it("sin cuenta conectada no cobra aunque el medio esté marcado", async () => {
    filas.vista = { connected: false, nickname: null };
    filas.medio = { habilitado: true, conectado_at: "2026-11-01T00:00:00Z" };
    expect((await fetchPaymentStatus("zz-org")).listoParaCobrar).toBe(false);
  });
});
