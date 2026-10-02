import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryCapitalCsv, inventoryCapitalSchema, capitalSourceError } from "@/lib/inventoryCapital";
import { useInventoryCapital } from "@/hooks/useInventoryCapital";
import InventoryValuationPage from "@/pages/InventoryValuationPage";
import { csvCell } from "@/lib/csv";

const state = vi.hoisted(() => ({ orgId: "00000000-0000-4000-8000-000000000002", allowed: true, write: true, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/lib/orgContext", () => ({ useOrg: () => ({ activeOrg: { id: state.orgId } }) }));
vi.mock("@/lib/permissionsContext", () => ({ useModulePerms: () => ({ canView: state.allowed, canCreate: state.write, canExport: state.write, loading: false }) }));
function fixture() {
  return { version: 1, orgId: state.orgId, currency: "ARS", method: "fifo_movement_snapshot", asOf: "2026-10-02T15:00:00Z", snapshotDate: "2026-10-02",
    search: "", page: 1, pageSize: 25, itemCount: 1, historyCount: 1, historyPage: 1, layerCount: 2, layerPage: 1,
    layers: [
      { product_id: "00000000-0000-4000-8000-000000000003", product_name: "ZZ Producto", variant_id: null, variant_name: null, sku: null,
        movementId: null, receivedAt: null, source: "opening", remainingUnits: 1, unitCostARS: null, valueARS: null },
      { product_id: "00000000-0000-4000-8000-000000000003", product_name: "ZZ Producto", variant_id: null, variant_name: null, sku: null,
        movementId: "00000000-0000-4000-8000-000000000004", receivedAt: "2026-10-01T10:00:00Z", source: "movement_snapshot", remainingUnits: 1, unitCostARS: 10, valueARS: 10 }],
    summary: { stockUnits: 2, positiveUnits: 2, knownUnits: 1, unvaluedUnits: 1, blockedItems: 0, valueARS: null, measuredValueARS: 10, slowCapitalARS: null, coveragePct: 50 },
    items: [{ product_id: "00000000-0000-4000-8000-000000000003", variant_id: null, product_name: "ZZ Producto", variant_name: null, sku: null,
      stock_units: 2, known_units: 1, unvalued_units: 1, measured_value_ars: 10, value_ars: null, coverage_pct: 50, reasons: ["missing_cost"],
      last_sold_at: null, sold_units_90: 0, days_without_sale: null, days_of_stock: null }],
    history: [{ snapshot_date: "2026-10-01", captured_at: "2026-10-01T15:00:00Z", products: 1, verified: false, units: 2, value_ars: null, measured_value_ars: null }] };
}
const props = { orgId: state.orgId, enabled: true, search: "", page: 1, historyPage: 1 };
beforeEach(() => {
  state.allowed = true; state.write = true;
  state.rpc.mockReset().mockImplementation((name, args) => Promise.resolve({ error: null, data: name === "capture_inventory_capital"
    ? { orgId: args.p_org_id, date: args.p_date, status: "recorded" } : { ...fixture(), orgId: args.p_org_id, search: args.p_search } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Inventory capital: source contract and real actions", () => {
  it.each(["\t=HYPERLINK(bad)", "  +SUM(1,2)", "\r\n@bad", "\u0000-123"])("neutralizes spreadsheet formula prefixes including leading whitespace %j", value => {
    expect(csvCell(value)).toMatch(/^"'/);
  });
  it("keeps missing capital and no demand distinct from measured cost", () => {
    const data = inventoryCapitalSchema.parse(fixture());
    expect(data.summary.valueARS).toBeNull(); expect(data.summary.measuredValueARS).toBe(10);
    expect(data.items[0].days_of_stock).toBeNull(); expect(data.history[0].value_ars).toBeNull();
  });
  it.each([undefined, { ...fixture(), method: "average" }, { ...fixture(), pageSize: 101 }, { ...fixture(), page: 9 },
    { ...fixture(), historyPage: 9 }, { ...fixture(), items: Array(26).fill(fixture().items[0]) },
    { ...fixture(), summary: { ...fixture().summary, valueARS: 10 } }, { ...fixture(), summary: { ...fixture().summary, knownUnits: 3 } }])("rejects false or incompatible capital %j", value => {
    expect(inventoryCapitalSchema.safeParse(value).success).toBe(false);
  });
  it("exports the visible page safely, preserving nulls and source labels", () => {
    const data = inventoryCapitalSchema.parse(fixture()); data.items[0].product_name = '=HYPERLINK("bad")';
    const csv = inventoryCapitalCsv(data);
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"2","1","1","","10","50"');
    expect(csv).toContain("Completar evidencia de costo histórico"); expect(csv).not.toContain("missing_cost");
    expect(csv).toContain("1 de 1"); expect(csv).toContain("FIFO sobre costo registrado en Kardex");
  });
  it("loads an atomic bounded source and never reads tables as fallback", async () => {
    const { result } = renderHook(() => useInventoryCapital(props));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(state.rpc).toHaveBeenCalledWith("get_inventory_capital", { p_org_id: state.orgId, p_search: "", p_page: 1, p_page_size: 25, p_history_page: 1, p_layer_page: 1 });
    expect(result.current.data.summary.unvaluedUnits).toBe(1);
  });
  it("exports the selected layers or historical page, not unrelated current stock", () => {
    const data = inventoryCapitalSchema.parse(fixture());
    expect(inventoryCapitalCsv(data, "layers")).toContain("Saldo inicial sin costo");
    expect(inventoryCapitalCsv(data, "layers")).not.toContain("missing_cost");
    expect(inventoryCapitalCsv(data, "history")).toContain('"2026-10-01","1","2","",""');
    expect(inventoryCapitalCsv(data, "history")).not.toContain("ZZ Producto");
  });
  it("does not load without tenant or both view permissions", () => {
    renderHook(() => useInventoryCapital({ ...props, enabled: false })); renderHook(() => useInventoryCapital({ ...props, orgId: null }));
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("recovers a read failure without replacing evidence with zeros", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValueOnce({ error: { code: "XX000" }, data: null });
    const { result } = renderHook(() => useInventoryCapital(props));
    await waitFor(() => expect(result.current.error).toBeTruthy()); expect(result.current.data).toBeNull();
    act(() => result.current.retry()); await waitFor(() => expect(result.current.data).not.toBeNull());
  });
  it("retains stale same-scope data but clears it after permission denial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useInventoryCapital(props)); await waitFor(() => expect(result.current.data).not.toBeNull());
    state.rpc.mockResolvedValueOnce({ error: { code: "XX000" }, data: null }); act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeTruthy()); expect(result.current.data).not.toBeNull();
    state.rpc.mockResolvedValueOnce({ error: { code: "42501" }, data: null }); act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBeNull());
  });
  it("hides old tenant/search data immediately and rejects late responses", async () => {
    let resolve: (value: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(input => useInventoryCapital(input), { initialProps: props });
    rerender({ ...props, orgId: "00000000-0000-4000-8000-000000000012", search: "next" });
    expect(result.current.data).toBeNull(); await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => resolve({ error: null, data: fixture() }));
    expect(result.current.data.search).toBe("next"); expect(result.current.data.orgId).not.toBe(state.orgId);
  });
  it("rejects a mismatched tenant response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValue({ error: null, data: { ...fixture(), orgId: "00000000-0000-4000-8000-000000000012" } });
    const { result } = renderHook(() => useInventoryCapital(props)); await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });
  it("captures the entire organization on a server date and suppresses double click", async () => {
    let resolve: (value: unknown) => void;
    const { result } = renderHook(() => useInventoryCapital(props)); await waitFor(() => expect(result.current.data).not.toBeNull());
    state.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending: Promise<void>; act(() => { pending = result.current.capture(); void result.current.capture(); });
    expect(state.rpc.mock.calls.filter(([name]) => name === "capture_inventory_capital")).toHaveLength(1);
    expect(state.rpc).toHaveBeenLastCalledWith("capture_inventory_capital", { p_org_id: state.orgId, p_date: "2026-10-02" });
    await act(async () => { resolve({ error: null, data: { orgId: state.orgId, date: "2026-10-02", status: "already_recorded" } }); await pending; });
    expect(result.current.captureMessage).toMatch(/ya existe/); expect(result.current.capturing).toBe(false);
  });
  it("does not report success for a failed capture and permits a safe retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useInventoryCapital(props)); await waitFor(() => expect(result.current.data).not.toBeNull());
    state.rpc.mockResolvedValueOnce({ error: { code: "XX000" }, data: null }); await act(() => result.current.capture());
    expect(result.current.captureError).toBeTruthy(); expect(result.current.captureMessage).toBeUndefined();
    await act(() => result.current.capture()); expect(result.current.captureMessage).toMatch(/guardado/);
  });
  it("ignores late capture results after changing tenant, even when returning", async () => {
    let resolve: (value: unknown) => void;
    const { result, rerender } = renderHook(input => useInventoryCapital(input), { initialProps: props });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    state.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending: Promise<void>; act(() => { pending = result.current.capture(); });
    rerender({ ...props, orgId: "00000000-0000-4000-8000-000000000012" });
    await waitFor(() => expect(result.current.data).not.toBeNull()); rerender(props);
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => { resolve({ error: null, data: { orgId: state.orgId, date: "2026-10-02", status: "recorded" } }); await pending; });
    expect(result.current.captureMessage).toBeUndefined();
    expect(result.current.capturing).toBe(false);
  });
  it("shows human pending reasons and unified layers/rotation/history tabs", async () => {
    render(<MemoryRouter><InventoryValuationPage /></MemoryRouter>);
    await screen.findByText("Capital parcialmente explicado");
    expect(screen.queryByText("missing_cost")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Capas de costo" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Saldo inicial sin costo")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rotación" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Sin demanda comprobable")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Registro anterior sin evidencia de costo")).toBeInTheDocument();
  });
  it("hides export and capture actions without write/export permissions", async () => {
    state.write = false; render(<MemoryRouter><InventoryValuationPage /></MemoryRouter>);
    await screen.findByText("Capital parcialmente explicado");
    expect(screen.queryByRole("button", { name: "Exportar página" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cierre del día" })).not.toBeInTheDocument();
  });
  it("distinguishes no permission from empty inventory and missing migration", () => {
    state.allowed = false; render(<MemoryRouter><InventoryValuationPage /></MemoryRouter>);
    expect(screen.getByText("Capital sin acceso")).toBeInTheDocument(); expect(state.rpc).not.toHaveBeenCalled();
    expect(capitalSourceError("PGRST202")).toMatch(/no está disponible/);
    expect(capitalSourceError("42501")).toMatch(/permisos/);
  });
});
