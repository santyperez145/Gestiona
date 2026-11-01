import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEntitlements } from "@/lib/useEntitlements";
import NotificationBell from "@/components/shared/NotificationBell";

/**
 * El barrido con datos (2026-10-31) midió en cada pantalla 6 pedidos a
 * `notifications` y 2 a `subscriptions`, `plans` y `org_entitlements`: cada
 * instancia de la campanita y de useEntitlements leía por su cuenta. Ahora
 * comparten una lectura de React Query.
 */
const m = vi.hoisted(() => ({ pedidos: [] as string[] }));
vi.mock("@/lib/orgContext", () => ({ useOrg: () => ({ activeOrg: { id: "zz-org", plan_id: "zz-plan" } }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "zz-user" } }) }));
vi.mock("@/lib/orgRealtime", () => ({ topicUsuario: () => null, useTopicEvent: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    m.pedidos.push(tabla);
    const q: Record<string, unknown> = {};
    for (const f of ["select", "eq", "order", "limit"]) q[f] = () => q;
    const respuesta = tabla === "notifications"
      ? { data: [{ id: "n1", title: "Stock bajo", message: "ZZ", type: "stock_bajo", read: false, created_at: "2026-10-31T12:00:00Z" }], count: 41, error: null }
      : tabla === "subscriptions" ? { data: { plan_id: "zz-plan", status: "active" }, error: null }
      : { data: { id: "zz-plan", code: "pro", name: "Pro" }, error: null };
    q.maybeSingle = () => Promise.resolve(respuesta);
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(respuesta).then(ok);
    return q;
  };
  return {
    supabase: {
      from: consulta,
      rpc: (fn: string) => { m.pedidos.push(`rpc/${fn}`); return Promise.resolve({ data: { vigente: true }, error: null }); },
    },
  };
});

function Uno() { useEntitlements(); return null; }

const conCliente = (hijos: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{hijos}</MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => { m.pedidos.length = 0; });

describe("una lectura compartida por dato del marco común", () => {
  it("tres componentes con useEntitlements: una suscripción, un plan y una decisión del servidor", async () => {
    render(conCliente(<><Uno /><Uno /><Uno /></>));
    await waitFor(() => expect(m.pedidos).toContain("plans"));
    expect(m.pedidos.filter(p => p === "subscriptions")).toHaveLength(1);
    expect(m.pedidos.filter(p => p === "plans")).toHaveLength(1);
    expect(m.pedidos.filter(p => p === "rpc/org_entitlements")).toHaveLength(1);
  });

  it("dos campanitas (barra lateral y teléfono): una sola consulta con lista y total", async () => {
    const { findAllByText } = render(conCliente(<><NotificationBell /><NotificationBell collapsed /></>));
    // El total sale del count (41), no de las filas traídas (1).
    expect((await findAllByText("41")).length).toBeGreaterThan(0);
    expect(m.pedidos.filter(p => p === "notifications")).toHaveLength(1);
  });
});
