import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canQueryStoreInstallments, installmentResponseSchema } from "@/lib/installments";
import { useInstallments } from "@/storefront/useInstallments";

const state = vi.hoisted(() => ({ invoke: vi.fn(), counter: 0 }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke } } }));
function quote(amount = 1200.25) {
  const option = { cuotas: 3, monto: amount / 3, total: amount, sinInteres: true };
  return { opciones: [option], mejorSinInteres: option, maxCuotas: 3 };
}
let slug: string;
beforeEach(() => {
  slug = `zz-installments-${++state.counter}`;
  state.invoke.mockReset().mockImplementation((_name, args) => Promise.resolve({ error: null, data: quote(args.body.amount) }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("store installment source", () => {
  it.each([
    [null, false], [{ payment_methods: ["transferencia"], currency: "ARS" }, false],
    [{ payment_methods: ["mercadopago"], currency: "USD" }, false],
    [{ payment_methods: ["mercadopago"], currency: "ARS" }, true],
    [{ payment_methods: ["gestiona_pay"], currency: "ARS" }, true],
    [{ payment_methods: ["mercadopago"], currency: null }, true],
  ] as const)("only queries an eligible ARS store %j", (store, expected) => {
    expect(canQueryStoreInstallments(store as Parameters<typeof canQueryStoreInstallments>[0])).toBe(expected);
  });
  it("never invokes an unavailable payment provider", () => {
    const { result } = renderHook(() => useInstallments(slug, 1200.25, false));
    expect(state.invoke).not.toHaveBeenCalled(); expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(false);
  });
  it("never queries missing store or ineligible amounts", () => {
    renderHook(() => useInstallments(undefined, 1200.25, true));
    renderHook(() => useInstallments(slug, Number.NaN, true));
    renderHook(() => useInstallments(slug, 999.99, true));
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("preserves cents and clears the previous quote immediately on amount change", async () => {
    const { result, rerender } = renderHook(amount => useInstallments(slug, amount, true), { initialProps: 1200.25 });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(state.invoke).toHaveBeenCalledWith("mp-installments", { body: { slug, amount: 1200.25 } });
    rerender(1200.75); expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.opciones[0].total).toBe(1200.75));
  });
  it("hides the quote when the provider is disabled", async () => {
    const { result, rerender } = renderHook(enabled => useInstallments(slug, 1200.25, enabled), { initialProps: true });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender(false); expect(result.current.data).toBeNull(); expect(result.current.error).toBeNull();
  });
  it("ignores late quotes from another store", async () => {
    let resolve: (value: unknown) => void;
    state.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(store => useInstallments(store, 1200.25, true), { initialProps: slug });
    const next = `${slug}-next`; rerender(next);
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => resolve({ error: null, data: quote(9000) }));
    expect(result.current.data.opciones[0].total).toBe(1200.25);
  });
  it("deduplicates simultaneous readers and reuses an unexpired quote", async () => {
    const first = renderHook(() => useInstallments(slug, 1200.25, true));
    const second = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(second.result.current.data).not.toBeNull());
    expect(first.result.current.data).not.toBeNull(); expect(state.invoke).toHaveBeenCalledTimes(1);
    first.unmount(); second.unmount();
    const third = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(third.result.current.data).not.toBeNull()); expect(state.invoke).toHaveBeenCalledTimes(1);
  });
  it("expires cached quotes without background polling or focus reloads", async () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    const first = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(first.result.current.data).not.toBeNull()); first.unmount();
    now += 15 * 60 * 1000 + 1;
    const second = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(second.result.current.data).not.toBeNull()); expect(state.invoke).toHaveBeenCalledTimes(2);
  });
  it.each([
    { data: null, error: { name: "FunctionsFetchError" } },
    { data: null, error: { name: "FunctionsHttpError" }, response: new Response(null, { status: 503 }) },
  ])("recovers a transient failure with a bounded read retry %j", async failure => {
    state.invoke.mockResolvedValueOnce(failure);
    const { result } = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(result.current.data).not.toBeNull()); expect(state.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not retry a permission failure and permits explicit recovery", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError" }, response: new Response(null, { status: 403 }) });
    const { result } = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull(); expect(state.invoke).toHaveBeenCalledTimes(1);
    act(() => result.current.retry()); await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull(); expect(state.invoke).toHaveBeenCalledTimes(2);
  });
  it("never caches a degraded source as an empty financing offer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.invoke.mockResolvedValueOnce({ data: { opciones: [], motivo: "mp_sin_respuesta" }, error: null });
    const first = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(first.result.current.error).toBeTruthy()); first.unmount();
    const second = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(second.result.current.data).not.toBeNull()); expect(state.invoke).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed financing instead of promising an invented installment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.invoke.mockResolvedValueOnce({ data: { ...quote(), maxCuotas: 12 }, error: null });
    const { result } = renderHook(() => useInstallments(slug, 1200.25, true));
    await waitFor(() => expect(result.current.error).toBeTruthy()); expect(result.current.data).toBeNull();
    expect(installmentResponseSchema.safeParse({ ...quote(), opciones: [{ ...quote().opciones[0], monto: Infinity }] }).success).toBe(false);
  });
});
