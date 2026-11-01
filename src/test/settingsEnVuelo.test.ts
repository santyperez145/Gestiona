import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ lecturas: 0, resolver: [] as Array<() => void> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = () => {
        if (tabla === "settings") m.lecturas += 1;
        return new Promise(ok => m.resolver.push(() => ok({ data: { org_id: "zz-org", exchange_rate: 1000 }, error: null })));
      };
      return q;
    },
    auth: { getUser: async () => ({ data: { user: { id: "zz-user" } }, error: null }) },
  },
}));

describe("la configuración del negocio se lee una vez por carga (2026-10-31)", () => {
  it("pedidos simultáneos comparten la consulta; uno posterior vuelve a la base", async () => {
    const { getSettingsDB } = await import("@/lib/supabaseStore");
    const a = getSettingsDB("zz-user", "zz-org");
    const b = getSettingsDB("zz-user", "zz-org");
    const c = getSettingsDB("zz-user", "zz-org");
    await vi.waitFor(() => expect(m.resolver.length).toBeGreaterThan(0));
    m.resolver.splice(0).forEach(r => r());
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(m.lecturas).toBe(1);
    expect(ra).toEqual({ org_id: "zz-org", exchange_rate: 1000 });
    expect(rb).toBe(ra);
    expect(rc).toBe(ra);

    // Después de responder no queda guardada: un guardado posterior se ve.
    const d = getSettingsDB("zz-user", "zz-org");
    await vi.waitFor(() => expect(m.resolver.length).toBe(1));
    m.resolver.splice(0).forEach(r => r());
    await d;
    expect(m.lecturas).toBe(2);
  });
});
