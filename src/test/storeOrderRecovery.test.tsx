import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StoreOrder from "@/storefront/StoreOrder";

const mocks = vi.hoisted(() => ({ read: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/publicDataSource", () => ({ getStoreOrderSecure: mocks.read }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@/storefront/storeContext", () => ({ useStore: () => ({
  store: { slug: "demo", currency: "ARS" }, fmt: (value: number) => `$${value}`, basePath: "/tienda/demo",
}) }));
vi.mock("@/storefront/trackingConsent", () => ({ useStoreTrackingRuntimeReady: () => false }));
vi.mock("@/storefront/OrderTracking", () => ({ default: () => null }));
vi.mock("@/storefront/StorePaymentBrick", () => ({ default: () => <div>Formulario de tarjeta</div> }));

const order = (number = "ORD1", paymentMethod = "gestiona_pay") => ({
  order_number: number, customer_name: "Cliente de prueba", customer_email: `${number}@example.test`,
  items: [{ name: "Producto", quantity: 1, unit_price: 100, total: 100 }],
  subtotal: 100, shipping_cost: 0, total: 100, payment_method: paymentMethod,
  payment_status: "pending", fulfillment_status: "pending", shipping_address: {},
  created_at: "2026-09-10T10:00:00Z", access_token: null,
});
const success = (number = "ORD1", method = "gestiona_pay") => ({ data: order(number, method), error: null });

function mount() {
  return render(<MemoryRouter initialEntries={["/orden/ORD1"]}>
    <Link to="/orden/ORD2">Otro pedido</Link>
    <Routes><Route path="/orden/:orderNumber" element={<StoreOrder />} /></Routes>
  </MemoryRouter>);
}

describe("recuperación de la página de pedido", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocks.read.mockResolvedValue(success());
    mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("un rechazo de red inicial permite reintentar sin pedir el email", async () => {
    mocks.read.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mount();
    expect(await screen.findByRole("heading", { name: "No pudimos cargar tu pedido" })).toBeVisible();
    expect(screen.queryByLabelText("Email de la compra")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "¡Gracias por tu compra!" })).toBeVisible();
  });

  it("desbloquea el pago externo fallido y reintenta sobre la misma orden", async () => {
    mount();
    const button = await screen.findByRole("button", { name: "Otros medios" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos abrir el pago");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls.map(call => call[1].body.orderNumber)).toEqual(["ORD1", "ORD1"]);
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("actualiza un pago manual sin recargar la página ni iniciar un cobro", async () => {
    mocks.read.mockResolvedValue(success("ORD1", "transferencia"));
    mount();
    const refresh = await screen.findByRole("button", { name: "Actualizar estado del pedido" });
    mocks.read.mockResolvedValue({ data: { ...order("ORD1", "transferencia"), payment_status: "paid" }, error: null });
    fireEvent.click(refresh);
    expect(await screen.findByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible();
    expect(refresh).toBeEnabled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("desbloquea la tarjeta y no expone mensajes internos del fallback", async () => {
    mount();
    const button = await screen.findByRole("button", { name: /Pagar con tarjeta/ });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos preparar el pago con tarjeta");
    expect(button).toBeEnabled();
    mocks.invoke.mockResolvedValue({ data: { fallback: "redirect", error: "private provider configuration" }, error: null });
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Pagar con Nerqia Pay" })).toBeEnabled();
    expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
  });

  it("no inicia dos preparaciones de pago simultáneas", async () => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount();
    const card = await screen.findByRole("button", { name: /Pagar con tarjeta/ });
    const redirect = screen.getByRole("button", { name: "Otros medios" });
    fireEvent.click(card);
    fireEvent.click(redirect);
    fireEvent.click(card);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(card).toBeDisabled();
    expect(redirect).toBeDisabled();
    await act(async () => finish({ data: { publicKey: "test-public", amount: 100 }, error: null }));
    expect(screen.getByText("Formulario de tarjeta")).toBeVisible();
  });

  it("cambiar de pedido borra la ficha anterior y descarta pagos tardíos", async () => {
    let finishPayment!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finishPayment = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Pagar con tarjeta/ }));
    let finishRead!: (value: unknown) => void;
    mocks.read.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
    fireEvent.click(screen.getByRole("link", { name: "Otro pedido" }));
    expect(screen.queryByText("ORD1@example.test")).not.toBeInTheDocument();
    await act(async () => finishPayment({ data: { publicKey: "old-key", amount: 100 }, error: null }));
    await act(async () => finishRead(success("ORD2")));
    expect(screen.getByText("ORD2@example.test")).toBeVisible();
    expect(screen.queryByText("Formulario de tarjeta")).not.toBeInTheDocument();
  });

  it("espera la consulta anterior antes de volver a consultar y respeta el límite", async () => {
    vi.useFakeTimers();
    await act(async () => { mount(); });
    let finishRead!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => finishRead(success()));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.read).toHaveBeenCalledTimes(6);
  });

  it("conserva el detalle si falla una actualización y no consulta pagos manuales", async () => {
    vi.useFakeTimers();
    await act(async () => { mount(); });
    mocks.read.mockRejectedValueOnce(new TypeError("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText("ORD1@example.test")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos actualizar el pedido");
    cleanup();
    mocks.read.mockClear().mockResolvedValue(success("ORD1", "efectivo"));
    await act(async () => { mount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
