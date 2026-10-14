import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// 2026-10-14 (funciones incoherentes): Presupuestos tenía «Link MP», que
// cobraba con la referencia `quote:<id>` que el webhook no reconoce (el pago
// no registraba la venta), y «Link pago», que creaba un link nuevo en cada
// sesión. Ahora hay uno solo, reutilizable, con referencia `link:<id>`.
const db = vi.hoisted(() => ({
  existente: null as null | Record<string, unknown>,
  insertado: null as null | Record<string, unknown>,
  mpConectado: false,
  invocado: null as null | Record<string, unknown>,
}));
vi.mock("@/lib/paymentStatus", () => ({ fetchPaymentStatus: async () => ({ connected: db.mpConectado }) }));
vi.mock("@/integrations/supabase/client", () => {
  const cadena = (fila: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: fila(), error: null });
    c.single = async () => ({ data: fila(), error: null });
    return c;
  };
  return {
    supabase: {
      from: () => ({
        select: () => cadena(() => db.existente),
        insert: (fila: Record<string, unknown>) => { db.insertado = fila; return cadena(() => ({ ...fila, mp_link: null })); },
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
      functions: { invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => { db.invocado = opts.body; return { data: { url: "https://mp/abc" }, error: null }; } },
    },
  };
});

import { linkDePagoDePresupuesto } from "@/lib/linksDePago";

const q = { id: "q1", quote_number: "PRE-0007", customer_name: "Ana", items: [], total: 1000 };

describe("link de pago de un presupuesto", () => {
  beforeEach(() => { db.existente = null; db.insertado = null; db.mpConectado = false; db.invocado = null; });

  it("reutiliza el link pendiente del presupuesto en vez de crear otro", async () => {
    db.existente = { id: "l1", mp_link: "https://mp/ya", external_ref: "link:l1", total_ars: 1000 };
    const r = await linkDePagoDePresupuesto("o1", q, "Ferretería");
    expect(r.nuevo).toBe(false);
    expect(r.url).toMatch(/\/pagar\/l1$/);
    expect(db.insertado).toBeNull();
  });

  it("si el presupuesto cambió de total, arma uno nuevo con referencia link:<id>", async () => {
    db.existente = { id: "l1", mp_link: null, external_ref: "link:l1", total_ars: 900 };
    const r = await linkDePagoDePresupuesto("o1", q, "Ferretería");
    expect(r.nuevo).toBe(true);
    expect(db.insertado?.external_ref).toBe(`link:${db.insertado?.id}`);
    expect(db.insertado?.quote_id).toBe("q1");
  });

  it("con Mercado Pago conectado genera el cobro sobre el link, nunca con quote:<id>", async () => {
    db.mpConectado = true;
    const r = await linkDePagoDePresupuesto("o1", q, "Ferretería");
    expect(r.conMercadoPago).toBe(true);
    expect(String(db.invocado?.externalRef)).toMatch(/^link:/);
    expect(db.invocado?.paymentLinkId).toBe(db.insertado?.id);
  });

  it("la pantalla tiene un solo botón de link y ya no arma cobros quote:<id>", () => {
    const pagina = fs.readFileSync("src/pages/PresupuestosPage.tsx", "utf8");
    expect(pagina).not.toContain("generateMpLink");
    expect(pagina).not.toContain("externalRef: `quote:");
    expect(pagina).toContain("linkDePagoDePresupuesto(activeOrg.id, q, orgName)");
  });
});
