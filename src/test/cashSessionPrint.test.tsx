import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CashSessionPage from "@/pages/CashSessionPage";

const fixtures = vi.hoisted(() => ({
  org: { id: "zz-org", name: "Ferretería & Hermanos" },
  user: { id: "zz-user" },
  session: {
    id: "zz-session", location_id: "zz-location", opened_at: "2026-10-08T12:00:00Z",
    closed_at: "2026-10-08T20:00:00Z", opening_amount: 100, closing_amount: 350,
    expected_cash: 350, difference: 0, notes: "Cierre revisado", status: "closed",
  },
  entry: {
    id: "zz-entry", entry_type: "sale_in", payment_method: "efectivo", amount_ars: 250,
    reference_type: null, reference_id: null, sale_transaction_id: null, seller_name: null,
    description: "Venta de tornillos", created_at: "2026-10-08T13:00:00Z",
  },
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fixtures.from } }));
vi.mock("@/lib/orgContext", () => ({ useOrg: () => ({ activeOrg: fixtures.org }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: fixtures.user }) }));
vi.mock("@/lib/useUserRole", () => ({ useUserRole: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/lib/supabaseStore", () => ({ formatARS: (value: number) => `$ ${value.toFixed(2)}` }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fixtures.org.name = "Ferretería & Hermanos";
  fixtures.session.notes = "Cierre revisado";
  fixtures.entry.description = "Venta de tornillos";
  fixtures.entry.entry_type = "sale_in";
  fixtures.entry.payment_method = "efectivo";
  fixtures.from.mockImplementation((table: string) => {
    const data = table === "locations"
      ? [{ id: "zz-location", name: "Casa central", is_main: true, active: true }]
      : table === "cash_sessions" ? [fixtures.session] : [fixtures.entry];
    const result = { data, error: null };
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of [query.select, query.eq, query.order, query.limit]) method.mockReturnValue(query);
    return query;
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function printClosedSession() {
  const write = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn(),
  } as unknown as Window);
  render(<MemoryRouter><CashSessionPage /></MemoryRouter>);
  const historyButton = await screen.findByRole("button", { name: /→/ });
  fireEvent.click(historyButton);
  await waitFor(() => expect(fixtures.from).toHaveBeenCalledWith("cash_entries"));
  await waitFor(() => expect(fixtures.from.mock.results.at(-1)?.value.order).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Imprimir / PDF" }));
  expect(write).toHaveBeenCalledOnce();
  return String(write.mock.calls[0][0]);
}

describe("cash session print safety", () => {
  it("prints persisted names, descriptions, notes and payment labels as text, not active HTML", async () => {
    fixtures.org.name = '</title><script>window.opener.pwned=1</script><title>';
    fixtures.session.notes = '<img src=x onerror="window.opener.pwned=1">';
    fixtures.entry.description = '<svg onload="window.opener.pwned=1"></svg>';
    fixtures.entry.entry_type = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
    fixtures.entry.payment_method = '<input autofocus onfocus="window.opener.pwned=1">';

    const html = await printClosedSession();
    const report = new DOMParser().parseFromString(html, "text/html");
    expect(report.querySelector("script, img, svg, iframe, input, [onerror], [onload], [onfocus]")).toBeNull();
    expect(report.title).toContain(fixtures.org.name);
    expect(report.body.textContent).toContain(fixtures.session.notes);
    expect(report.body.textContent).toContain(fixtures.entry.description);
    expect(report.body.textContent).toContain(fixtures.entry.entry_type);
    expect(report.body.textContent?.split(fixtures.entry.payment_method)).toHaveLength(3);
  });

  it("keeps legitimate business text and report amounts readable", async () => {
    const html = await printClosedSession();
    const report = new DOMParser().parseFromString(html, "text/html");
    expect(report.title).toBe("Cierre de Caja — Ferretería & Hermanos");
    expect(report.body.textContent).toContain("Venta de tornillos");
    expect(report.body.textContent).toContain("Notas: Cierre revisado");
    expect(report.body.textContent).toContain("$ 350.00");
    expect(report.body.textContent).toContain("Total ingresos");
  });
});
