import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/orgContext", () => ({ getActiveOrgId: () => "tenant", requireActiveOrgId: () => "tenant" }));
import { getProductsDB } from "@/lib/supabaseStore";
beforeEach(() => mocks.from.mockReset());
describe("catálogo por encima de PostgREST 1.000 filas", () => {
  it("consulta todas las páginas por id, preservando el tenant", async () => {
    const products = Array.from({ length: 2501 }, (_, i) => ({ id: String(i).padStart(6, "0"), name: "ZZ " + String(i).padStart(6, "0") }));
    const tenants: string[] = []; const cursors: string[] = [];
    mocks.from.mockImplementation(() => {
      let cursor = "";
      const query = { select: () => query, eq: (_: string, org: string) => { tenants.push(org); return query; }, order: () => query, limit: () => query,
        gt: (_: string, id: string) => { cursor = id; cursors.push(id); return query; }, then: (resolve: (v: unknown) => void) => resolve({ data: products.filter(p => p.id > cursor).slice(0,1000), error: null }) };
      return query;
    });
    const data = await getProductsDB("user", "tenant");
    expect(data).toHaveLength(2501); expect(tenants).toEqual(["tenant", "tenant", "tenant"]); expect(cursors).toEqual(["000999", "001999"]);
  });
  it("no devuelve un catálogo parcial como éxito si falla una página", async () => {
    const error = new Error("Forbidden");
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, then: (resolve: (v: unknown) => void) => resolve({ data: null, error }) };
    mocks.from.mockReturnValue(query);
    await expect(getProductsDB("user", "tenant")).rejects.toBe(error);
  });
});
