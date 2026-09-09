import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StoreCheckout from "@/storefront/StoreCheckout";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), access: vi.fn(), invoke: vi.fn(), rpc: vi.fn(), clear: vi.fn(),
  remember: vi.fn(), signup: vi.fn(), start: vi.fn(),
  store: {
    slug: "checkout-test", currency: "ARS", payment_methods: ["efectivo"],
    pickup_enabled: true, pickup_address: "Local de prueba", shipping_mode: "flat",
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke }, rpc: mocks.rpc },
}));
vi.mock("@/storefront/storeContext", () => ({ useStore: () => ({
  store: mocks.store, products: [],
  cart: [{ productId: "product-1", name: "Producto", price: 100, qty: 1, stock: 10 }],
  subtotal: 100, promo2x: 0, shippingCost: 0, fmt: (n: number) => `$${n}`,
  clearCart: mocks.clear, rememberCartEmail: mocks.remember,
  cartToken: "cart-test", visitToken: "visit-test", basePath: "/tienda/checkout-test",
}) }));
vi.mock("@/storefront/storeAuth", () => ({ useStoreAuth: () => ({ customer: null, signUp: mocks.signup }) }));
vi.mock("@/storefront/trackingConsent", () => ({ useStoreTrackingRuntimeReady: () => false }));
vi.mock("@/storefront/tracking", () => ({ trackBeginCheckout: vi.fn() }));
vi.mock("@/lib/publicDataSource", () => ({
  createStoreOrder: mocks.create, getStoreOrderSecure: mocks.access,
  startStoreCheckout: mocks.start, isTransientPublicError: () => true,
  quoteStoreShipping: async () => [{ option_id: "pickup", carrier: "retiro", label: "Retiro", price: 0 }],
}));

function Destination() {
  const location = useLocation();
  return <div data-testid="order-destination">{location.pathname} {location.state?.checkoutPaymentError}</div>;
}

async function openCheckout() {
  const result = render(<MemoryRouter initialEntries={["/checkout"]}>
    <Routes>
      <Route path="/checkout" element={<StoreCheckout />} />
      <Route path="/tienda/checkout-test/orden/:number" element={<Destination />} />
    </Routes>
  </MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Finalizar compra|Pagar con Nerqia Pay/ })[0]).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Nombre y apellido *"), { target: { value: "Cliente Test" } });
  fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "checkout@example.test" } });
  const form = result.container.querySelector("form")!;
  return { ...result, submit: () => fireEvent.submit(form) };
}

describe("checkout con fallos reales de promesas", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("crypto", webcrypto);
    localStorage.clear();
    sessionStorage.clear();
    mocks.store.payment_methods = ["efectivo"];
    mocks.create.mockResolvedValue({ data: { order_number: "ORD1" }, error: null, cartLinked: true });
    mocks.access.mockResolvedValue({ data: { access_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, error: null });
    mocks.invoke.mockResolvedValue({ data: null, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("un doble submit crea una sola orden y mantiene el carrito mientras espera", async () => {
    let resolveOrder!: (value: unknown) => void;
    mocks.create.mockImplementation(() => new Promise(resolve => { resolveOrder = resolve; }));
    const checkout = await openCheckout();
    checkout.submit();
    checkout.submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Estamos confirmando tu pedido")).toBeVisible();
    expect(mocks.clear).not.toHaveBeenCalled();
    await act(async () => resolveOrder({ data: { order_number: "ORD1" }, error: null, cartLinked: true }));
    expect(await screen.findByTestId("order-destination")).toHaveTextContent("ORD1");
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it("reintenta después de un corte y una recarga con la misma clave", async () => {
    mocks.create.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = await openCheckout();
    first.submit();
    await waitFor(() => expect(screen.getAllByText(/No pudimos confirmar la respuesta/).length).toBeGreaterThan(0));
    const key = mocks.create.mock.calls[0][0].p_idempotency_key;
    expect(mocks.clear).not.toHaveBeenCalled();
    first.unmount();
    const retry = await openCheckout();
    retry.submit();
    expect(await screen.findByTestId("order-destination")).toHaveTextContent("ORD1");
    expect(mocks.create.mock.calls[1][0].p_idempotency_key).toBe(key);
  });

  it("abre el pedido, no otra compra, si falla el pago después de crear la orden", async () => {
    mocks.store.payment_methods = ["gestiona_pay"];
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === "store-pay") throw new TypeError("Failed to fetch");
      return { data: null, error: null };
    });
    const checkout = await openCheckout();
    checkout.submit();
    expect(await screen.findByTestId("order-destination")).toHaveTextContent("Tu pedido quedó registrado");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it("no borra el carrito ante una respuesta inválida", async () => {
    mocks.create.mockResolvedValue({ data: { total: 100 }, error: null });
    const checkout = await openCheckout();
    checkout.submit();
    await waitFor(() => expect(screen.getAllByText(/no recibimos su número/).length).toBeGreaterThan(0));
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("con storage bloqueado conserva al menos la clave en memoria", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mocks.create.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const checkout = await openCheckout();
    checkout.submit();
    await waitFor(() => expect(screen.getAllByText(/No pudimos confirmar la respuesta/).length).toBeGreaterThan(0));
    const key = mocks.create.mock.calls[0][0].p_idempotency_key;
    checkout.submit();
    await screen.findByTestId("order-destination");
    expect(mocks.create.mock.calls[1][0].p_idempotency_key).toBe(key);
  });

  it("la siguiente compra idéntica recibe otra clave", async () => {
    const first = await openCheckout();
    first.submit();
    await screen.findByTestId("order-destination");
    const key = mocks.create.mock.calls[0][0].p_idempotency_key;
    first.unmount();
    mocks.create.mockResolvedValue({ data: { order_number: "ORD2" }, error: null, cartLinked: true });
    const next = await openCheckout();
    next.submit();
    expect(await screen.findByTestId("order-destination")).toHaveTextContent("ORD2");
    expect(mocks.create.mock.calls[1][0].p_idempotency_key).not.toBe(key);
  });
});
