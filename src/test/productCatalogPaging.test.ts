import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/orgContext", () => ({ getActiveOrgId: () => "tenant", requireActiveOrgId: () => "tenant" }));
import { getProductsDB } from "@/lib/supabaseStore";
beforeEach(() => mocks.from.mockReset());

const uuid = (n: number) => {
  const h = (n * 2654435761 % 2 ** 48).toString(16).padStart(12, "0") + n.toString(16).padStart(20, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

describe("catálogo por encima de PostgREST 1.000 filas", () => {
  it("lee todas las filas por rangos de id, preservando el tenant y el orden por nombre", async () => {
    const products = Array.from({ length: 2501 }, (_, i) => ({ id: uuid(i), name: "ZZ " + String(2501 - i).padStart(6, "0") }));
    const tenants = new Set<string>();
    mocks.from.mockImplementation(() => {
      const f = { desde: "", hasta: "", despues: "", limite: 1000 };
      const query = {
        select: () => query, order: () => query,
        eq: (_: string, org: string) => { tenants.add(org); return query; },
        limit: (n: number) => { f.limite = n; return query; },
        gte: (_: string, v: string) => { f.desde = v; return query; },
        lt: (_: string, v: string) => { f.hasta = v; return query; },
        gt: (_: string, v: string) => { f.despues = v; return query; },
        then: (resolve: (v: unknown) => void) => resolve({
          data: [...products].sort((a, b) => a.id.localeCompare(b.id))
            .filter(p => p.id >= f.desde && (!f.hasta || p.id < f.hasta) && (!f.despues || p.id > f.despues))
            .slice(0, f.limite),
          error: null,
        }),
      };
      return query;
    });
    const data = await getProductsDB("user", "tenant");
    expect(data).toHaveLength(2501);
    expect(new Set(data.map(p => p.id)).size).toBe(2501);
    expect([...tenants]).toEqual(["tenant"]);
    expect(data[0].name).toBe("ZZ 000001");
  });

  it("no devuelve un catálogo parcial como éxito si falla una página", async () => {
    const error = new Error("Forbidden");
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, gte: () => query, lt: () => query, gt: () => query,
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error }) };
    mocks.from.mockReturnValue(query);
    await expect(getProductsDB("user", "tenant")).rejects.toBe(error);
  });
});
