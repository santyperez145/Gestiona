import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profitPeriodSchema, profitSourceError } from "@/lib/profitPeriod";
import { useProfitPeriod } from "@/hooks/useProfitPeriod";
import ChannelMarginTab from "@/components/analytics/ChannelMarginTab";

const state = vi.hoisted(() => ({ org: "org-one", allowed: true, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ orgId: state.org }) }));
vi.mock("@/lib/permissionsContext", () => ({ useModulePerms: () => ({ canView: state.allowed, loading: false }) }));

export function fixture() {
  return {
    version: 1, currency: "ARS", timeZone: "America/Argentina/Buenos_Aires", from: null, to: null,
    pageSize: 25, productCount: 1, operationCount: 1006, productPage: 1, operationPage: 1,
    filters: { storeId: null, channel: null, groupBy: "product" },
    stores: [{ id: "00000000-0000-4000-8000-000000000010", name: "Tienda propia", active: true }],
    coverage: { lines: 1007, explainableLines: 1, revenueARS: 10110.05, explainableRevenueARS: 10,
      explainableRevenuePct: 0.1, averageCoveragePct: 75, cogsKnownLines: 1006, paymentFeeKnownLines: 1007,
      shippingKnownLines: 1007, taxKnownLines: 1, measuredContributionARS: 4, contributionMarginARS: null },
    products: [{ productId: "product-one", productName: "Producto de prueba", channel: "pos", lines: 1007,
      units: 1007, revenueARS: 10110.05, cogsARS: null, paymentFeeARS: 0, shippingCostARS: 0, taxARS: null,
      contributionMarginARS: null, coveragePct: 75, pendingCodes: ["iva", "devolucion_neta"],
      variantId: null, sku: null, variantName: null, skuSource: null }], operations: [],
  };
}
const props = { orgId: "org-one", enabled: true, productPage: 1, operationPage: 1 };
beforeEach(() => { state.org = "org-one"; state.allowed = true;
  state.rpc.mockReset().mockImplementation((_name, args) => Promise.resolve({ data: { ...fixture(), filters: args.p_filters }, error: null }));
  localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Profit Foundation: period authority and recovery", () => {
  it("preserves unknown amounts and measured zero without recomputing totals", () => {
    const data = profitPeriodSchema.parse(fixture());
    expect(data.coverage.contributionMarginARS).toBeNull();
    expect(data.products[0].paymentFeeARS).toBe(0);
    expect(data.coverage.lines).toBe(1007);
  });
  it.each([undefined, { ...fixture(), version: 2 }, { ...fixture(), pageSize: 101 },
    { ...fixture(), operationPage: 42 }, { ...fixture(), coverage: {} },
    { ...fixture(), products: Array(26).fill(fixture().products[0]) }])("rejects incompatible or incomplete contract %j", invalid => {
    expect(profitPeriodSchema.safeParse(invalid).success).toBe(false);
  });
  it("fetches one atomic RPC with civil dates and bounded detail", async () => {
    const { result } = renderHook(() => useProfitPeriod(props));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(state.rpc).toHaveBeenCalledWith("get_profit_period_dimensions", {
      p_org_id: "org-one", p_from: null, p_to: null, p_product_page: 1, p_operation_page: 1, p_page_size: 25,
      p_filters: { storeId: null, channel: null, groupBy: "product" },
    });
    expect(result.current.data.coverage.lines).toBe(1007);
  });
  it("never requests private data without permission or context", () => {
    renderHook(() => useProfitPeriod({ ...props, enabled: false }));
    renderHook(() => useProfitPeriod({ ...props, orgId: null }));
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["response", "rejection"])("recovers from a %s without false zero", async kind => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (kind === "response") state.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    else state.rpc.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useProfitPeriod(props));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data?.coverage.lines).toBe(1007));
    expect(result.current.error).toBeNull();
  });
  it("retains an honestly stale snapshot on refresh failure and clears it on denial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useProfitPeriod(props));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    state.rpc.mockRejectedValueOnce(new Error("offline")); act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data.coverage.revenueARS).toBe(10110.05);
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }); act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBeNull());
  });
  it("hides old tenant/period immediately and ignores late responses", async () => {
    let resolveOld: (response: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(input => useProfitPeriod(input), { initialProps: props });
    rerender({ ...props, orgId: "org-two" });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => resolveOld({ data: { ...fixture(), productCount: 999 }, error: null }));
    expect(result.current.data.productCount).toBe(1);
  });
  it("rejects a response from another civil period", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValue({ data: { ...fixture(), from: "2026-01-01" }, error: null });
    const { result } = renderHook(() => useProfitPeriod(props));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });
  it("missing migration is unavailable, not silently truncated fallback", () => {
    expect(profitSourceError({ code: "PGRST202" })).toMatch(/no.*disponible/i);
    expect(profitSourceError({ code: "42501" })).toMatch(/permiso/i);
    expect(profitSourceError({ code: "22023" })).toMatch(/fechas/i);
  });
  it("shows full population, partial contribution and paged operations", async () => {
    render(<ChannelMarginTab enabled />);
    await screen.findByText("1006 operaciones · 1007 líneas");
    expect(screen.getByText("1006 operaciones · 1007 líneas")).toBeInTheDocument();
    expect(screen.getByText("Rentabilidad parcial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Operaciones" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Operaciones" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Ir a la página siguiente" }));
    await waitFor(() => expect(state.rpc).toHaveBeenLastCalledWith("get_profit_period_dimensions", expect.objectContaining({ p_operation_page: 2 })));
    expect(localStorage.getItem("gestiona.view.profit.mode.v1.org-one")).toContain("operations");
  });
  it("does not confuse missing permission with an empty period", () => {
    state.allowed = false; render(<ChannelMarginTab enabled />);
    expect(screen.getByText("Rentabilidad sin acceso")).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("keeps pending reasons in an accessible detail without expanding every row", async () => {
    render(<ChannelMarginTab enabled />);
    const details = await screen.findByRole("button", { name: "Ver fuentes pendientes de Producto de prueba" });
    expect(screen.queryByRole("dialog", { name: "Fuentes pendientes" })).not.toBeInTheDocument();
    fireEvent.click(details);
    await screen.findByRole("dialog", { name: "Fuentes pendientes" });
    expect(screen.getByText("IVA", { selector: "li" })).toBeInTheDocument();
    expect(screen.getByText("neteo de devolución", { selector: "li" })).toBeInTheDocument();
  });
  it("exposes measured costs and zero contribution in the complete row detail", async () => {
    state.rpc.mockResolvedValue({ data: { ...fixture(), products: [{ ...fixture().products[0], cogsARS: 100, taxARS: 0, contributionMarginARS: 0, pendingCodes: [] }] }, error: null });
    render(<ChannelMarginTab enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver costos de Producto de prueba" }));
    const details = within(await screen.findByRole("dialog", { name: "Desglose de margen" }));
    expect(details.getByText("Comisión de cobro", { selector: "dt" })).toBeInTheDocument();
    expect(details.getByText("Contribución", { selector: "dt" })).toBeInTheDocument();
    expect(details.queryByText("Pendiente")).not.toBeInTheDocument();
    expect(details.getAllByText(/\$\s*0(?:,00)?$/)).toHaveLength(4);
  });
  it("loads SKU groups with exact store/channel scope and hides old results immediately", async () => {
    const { result, rerender } = renderHook(input => useProfitPeriod(input), { initialProps: { ...props, storeId: "", channel: "", groupBy: "product" as "product" | "sku" } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let resolveOld: (response: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    rerender({ ...props, storeId: fixture().stores[0].id, channel: "tienda_online", groupBy: "sku" });
    expect(result.current.data).toBeNull();
    expect(result.current.stores).toHaveLength(1);
    rerender({ ...props, storeId: "", channel: "pos", groupBy: "sku" });
    await waitFor(() => expect(result.current.data?.filters.channel).toBe("pos"));
    await act(async () => resolveOld({ data: { ...fixture(), productCount: 999 }, error: null }));
    expect(result.current.data.productCount).toBe(1);
    expect(state.rpc).toHaveBeenLastCalledWith("get_profit_period_dimensions", expect.objectContaining({ p_filters: { storeId: null, channel: "pos", groupBy: "sku" } }));
    rerender({ ...props, orgId: "org-two", storeId: "", channel: "pos", groupBy: "sku" });
    expect(result.current.stores).toEqual([]);
  });
  it("rejects a response with filters from another request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValue({ data: fixture(), error: null });
    const { result } = renderHook(() => useProfitPeriod({ ...props, groupBy: "sku" }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });
  it("retains filter recovery controls while the selected store is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    const change = vi.fn();
    render(<ChannelMarginTab enabled storeId={fixture().stores[0].id} onFilterChange={change} />);
    await screen.findByText("No pudimos cargar rentabilidad");
    fireEvent.click(screen.getByRole("combobox", { name: "Tienda" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "Todas las tiendas" }));
    expect(change).toHaveBeenCalledWith("store", "");
    expect(screen.queryByText(fixture().stores[0].id)).not.toBeInTheDocument();
  });
  it("keeps keyboard tabs mounted during SKU requests and identifies duplicate SKUs by variant", async () => {
    state.rpc.mockImplementation((_name, args) => Promise.resolve({ data: { ...fixture(), filters: args.p_filters,
      productCount: 2, products: ["Talle S", "Talle M"].map((name, index) => ({ ...fixture().products[0], variantId: `variant-${index}`, variantName: name, sku: "REPETIDO", skuSource: "current_catalog" })) }, error: null }));
    render(<ChannelMarginTab enabled />);
    await screen.findByText("1006 operaciones · 1007 líneas");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Producto y canal" }), { key: "ArrowRight" });
    const skuTab = screen.getByRole("tab", { name: "SKU y canal" });
    expect(skuTab).toHaveFocus();
    await screen.findByRole("table", { name: "Margen por SKU y canal" });
    expect(screen.getByText("Talle S · REPETIDO")).toBeInTheDocument();
    expect(screen.getByText("Talle M · REPETIDO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver fuentes pendientes de Producto de prueba · Talle S · REPETIDO" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver fuentes pendientes de Producto de prueba · Talle M · REPETIDO" })).toBeInTheDocument();
    fireEvent.keyDown(skuTab, { key: "End" });
    expect(screen.getByRole("tab", { name: "Operaciones" })).toHaveFocus();
  });
});
