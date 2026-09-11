import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoreOrderQueue } from "@/hooks/useStoreOrderQueue";
import StoreOrdersPanel from "@/components/ecommerce/StoreOrdersPanel";
import DataPagination from "@/components/shared/DataPagination";
import { parseStoreOrderPage, parseStoreOrderQueuePage } from "@/lib/storeOrderQueuePage";
import { countStoreOrdersNeedingAttention, parseStoreOrderAmountQuery } from "@/lib/storeOrderQueue";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
const order = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, order_number: `ZZ-${n}`,
  customer_name: `Cliente ${n}`, customer_email: `zz-${n}@example.test`, customer_phone: null,
  total: 15000, payment_status: "paid", fulfillment_status: "pending", tracking_number: null,
  payment_method: "efectivo", created_at: "2026-09-01T10:00:00+00:00",
});
const response = (page = 1, total = 51, storeTotal = total) => ({
  rows: Array.from({ length: Math.min(50, Math.max(0, total - (page - 1) * 50)) }, (_, i) => order((page - 1) * 50 + i + 1)),
  total, store_total: storeTotal, attention: storeTotal, page, page_size: 50,
  counts: { todas: total, retirar: 0, despachar: total, atrasados: total, pago: 0, enviadas: 0, entregadas: 0, canceladas: 0 },
});
let clients: QueryClient[] = [];
function provider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockImplementation(args => Promise.resolve({ data: response(args.p_page), error: null }));
  mocks.rpc.mockImplementation((_name, args) => ({ abortSignal: (signal: AbortSignal) => mocks.read(args, signal) }));
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; });

describe("contrato paginado de pedidos", () => {
  it("valida filas, totales, duplicados y paginas sin ocultar contratos rotos", () => {
    expect(parseStoreOrderQueuePage(response(2)).rows).toHaveLength(1);
    expect(parseStoreOrderQueuePage(response(1, 0, 251)).store_total).toBe(251);
    expect(() => parseStoreOrderQueuePage({ ...response(), rows: [] })).toThrow();
    expect(() => parseStoreOrderQueuePage({ ...response(), attention: 999 })).toThrow();
    expect(() => parseStoreOrderQueuePage({ ...response(), page_size: 200 })).toThrow();
    expect(() => parseStoreOrderQueuePage({ ...response(), rows: Array(50).fill(order(1)) })).toThrow();
    expect(() => parseStoreOrderQueuePage(response(9))).toThrow();
  });
  it("normaliza montos argentinos y rechaza paginas fuera del contrato SQL", () => {
    expect(parseStoreOrderAmountQuery("$15.000")).toBe(15000);
    expect(parseStoreOrderAmountQuery("15.000,50")).toBe(15000.5);
    expect(parseStoreOrderAmountQuery("15000.50")).toBe(15000.5);
    expect(parseStoreOrderAmountQuery("Cliente 15")).toBeNull();
    for (const invalid of [null, "0", "-1", "1.5", "Infinity", "2147483648"]) expect(parseStoreOrderPage(invalid)).toBe(1);
    expect(parseStoreOrderPage("6")).toBe(6);
    expect(countStoreOrdersNeedingAttention([order(1)])).toBe(1);
  });
});

describe("lectura de todo el historial", () => {
  it("envia tenant, vitrina y filtros al servidor con cancelacion", async () => {
    const { result } = renderHook(() => useStoreOrderQueue("org", "store", new URLSearchParams("q=$15.000&vista=despachar&orden=mayor&medio=efectivo&pagina=2")), { wrapper: provider() });
    await waitFor(() => expect(result.current.data?.page).toBe(2));
    expect(mocks.rpc).toHaveBeenCalledWith("store_order_queue", {
      p_org_id: "org", p_store_id: "store", p_query: "$15.000", p_view: "despachar",
      p_sort: "mayor", p_medio: "efectivo", p_page: 2, p_amount: 15000,
    });
    expect(mocks.read.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });
  it("no consulta sin una organizacion y una vitrina", () => {
    renderHook(() => useStoreOrderQueue(null, null, new URLSearchParams()), { wrapper: provider() });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rechazos de red y contratos invalidos permiten reintentar sin error tecnico visible", async () => {
    mocks.read.mockRejectedValueOnce(new Error("private SQL diagnostics"));
    const { result } = renderHook(() => useStoreOrderQueue("org", "store", new URLSearchParams()), { wrapper: provider() });
    await waitFor(() => expect(result.current.error).toContain("Reintentá"));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toContain("SQL");
    mocks.read.mockResolvedValueOnce({ data: { rows: [] }, error: null });
    await act(() => result.current.reload());
    expect(result.current.error).toContain("Reintentá");
    await act(() => result.current.reload());
    await waitFor(() => expect(result.current.data?.total).toBe(51));
    expect(result.current.error).toBeNull();
  });
  it("una respuesta tardia de otra tienda no reemplaza la activa", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ store }) => useStoreOrderQueue("org", store, new URLSearchParams()), {
      initialProps: { store: "old" }, wrapper: provider(),
    });
    rerender({ store: "new" });
    await waitFor(() => expect(result.current.data?.total).toBe(51));
    expect(mocks.read.mock.calls[0][1].aborted).toBe(true);
    await act(async () => resolveOld({ data: response(1, 1), error: null }));
    expect(result.current.data?.total).toBe(51);
  });
  it("agrupa la escritura de busqueda y oculta filas del filtro anterior", async () => {
    const { result, rerender } = renderHook(({ q }) => useStoreOrderQueue("org", "store", new URLSearchParams({ q })), {
      initialProps: { q: "" }, wrapper: provider(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ q: "j" });
    rerender({ q: "jose" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[1][1].p_query).toBe("jose");
  });
  it("conserva la consulta reciente y no la recarga al volver a la pestaña", async () => {
    const { result, rerender } = renderHook(({ store }) => useStoreOrderQueue("org", store, new URLSearchParams()), {
      initialProps: { store: "one" }, wrapper: provider(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    rerender({ store: "two" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ store: "two" });
    expect(result.current.data?.total).toBe(51);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    focusManager.setFocused(undefined);
  });
});

function QueueHarness() {
  const [params] = useSearchParams();
  const queue = useStoreOrderQueue("org", "store", params);
  return <><div data-testid="params">{params.toString()}</div><StoreOrdersPanel
    queuePage={queue.data} orders={queue.data?.rows ?? []} loading={queue.loading} error={queue.error}
    onRetry={() => { void queue.reload(); }} onInspect={vi.fn()} onPrepare={vi.fn()}
    canBulkEdit={false} bulkBusy={false} bulkResult={null} onDismissBulkResult={vi.fn()} onBulkFulfill={async () => true}
  /></>;
}
describe("interaccion de la cola", () => {
  it("bloquea la paginacion durante un lote sin cambiar el comportamiento por defecto", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<DataPagination page={1} totalPages={3} onPageChange={onPageChange} disabled />);
    expect(screen.getByRole("button", { name: "Ir a la página anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ir a la página siguiente" })).toBeDisabled();
    rerender(<DataPagination page={1} totalPages={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir a la página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
  // Debounce de 300 ms + tres transiciones de paginación: timeout propio
  // acotado para no heredar el default de 5 s en entornos CI más lentos.
  it("pagina por URL, conserva store y reinicia pagina al cambiar una vista", { timeout: 15000 }, async () => {
    const Provider = provider();
    render(<Provider><MemoryRouter initialEntries={["/pedidos-online?store=store&pagina=2"]}><QueueHarness /></MemoryRouter></Provider>);
    expect(await screen.findByText("51–51 de 51 pedidos", undefined, { timeout: 8000 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ir a la página siguiente" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Para despachar/ }));
    await waitFor(() => expect(screen.getByTestId("params")).toHaveTextContent("store=store&vista=despachar"), { timeout: 8000 });
    expect(await screen.findByText("1–50 de 51 pedidos", undefined, { timeout: 8000 })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ir a la página siguiente" }));
    expect(await screen.findByText("51–51 de 51 pedidos", undefined, { timeout: 8000 })).toBeVisible();
    expect(screen.getByTestId("params")).toHaveTextContent("pagina=2");
    expect(screen.getByRole("button", { name: "CSV de esta página" })).toBeEnabled();
  });
  it("distingue una busqueda vacia de una tienda sin ventas", async () => {
    mocks.read.mockResolvedValue({ data: response(1, 0, 251), error: null });
    const Provider = provider();
    render(<Provider><MemoryRouter initialEntries={["/pedidos-online?q=nadie"]}><QueueHarness /></MemoryRouter></Provider>);
    expect(await screen.findByText("Ningún pedido coincide")).toBeVisible();
    expect(screen.getByRole("button", { name: "CSV de esta página" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Copiar enlace de la tienda" })).not.toBeInTheDocument();
  });
});
