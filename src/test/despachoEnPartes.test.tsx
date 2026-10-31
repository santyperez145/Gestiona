import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cantidadesSugeridas, eventoDelAviso, itemsDeLaParte, problemasDeLaParte, textoDeLaParte, type PendienteDeDespacho,
} from "@/lib/despachoEnPartes";
import DespacharEnPartes from "@/components/ecommerce/DespacharEnPartes";
import OrderTracking from "@/storefront/OrderTracking";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => m.rpc(...a) } }));

const pendiente = (linea: number, nombre: string, pedida: number, despachada = 0): PendienteDeDespacho =>
  ({ linea, product_id: null, variant_id: null, nombre, pedida, despachada, falta: pedida - despachada });

// 3 cables en stock y 2 consolas en preventa que llegan el 20/11.
const renglones = [
  { name: "ZZ Cable", quantity: 3 },
  { name: "ZZ Consola", quantity: 2, preventa: { cantidad: 2, llega: "2026-11-20" } },
];

beforeEach(() => {
  m.rpc.mockReset();
  Object.values(m.toast).forEach(f => f.mockReset());
});

describe("despacho en partes: lo que se sugiere y se manda", () => {
  it("sugiere lo que hay en stock y deja la preventa para cuando llegue", () => {
    const pendientes = [pendiente(0, "ZZ Cable", 3), pendiente(1, "ZZ Consola", 2)];
    expect(cantidadesSugeridas(pendientes, renglones, "2026-10-31")).toEqual({ 0: 3, 1: 0 });
    // Llegó la mercadería: ya se sugiere todo.
    expect(cantidadesSugeridas(pendientes, renglones, "2026-11-20")).toEqual({ 0: 3, 1: 2 });
    // Un renglón con 5, de las que 2 son preventa: salen 3; después de mandarlas, nada.
    const mixto = [{ quantity: 5, preventa: { cantidad: 2, llega: "2026-11-20" } }];
    expect(cantidadesSugeridas([pendiente(0, "ZZ Mixto", 5)], mixto, "2026-10-31")).toEqual({ 0: 3 });
    expect(cantidadesSugeridas([pendiente(0, "ZZ Mixto", 5, 3)], mixto, "2026-10-31")).toEqual({ 0: 0 });
  });

  it("arma la parte con lo que tiene cantidad y avisa lo que la base rechazaría", () => {
    const pendientes = [pendiente(0, "ZZ Cable", 3), pendiente(1, "ZZ Consola", 2)];
    expect(itemsDeLaParte({ 1: "2", 0: "1,5", 2: "" })).toEqual([{ linea: 0, cantidad: 1.5 }, { linea: 1, cantidad: 2 }]);
    expect(problemasDeLaParte(pendientes, { 0: "0", 1: "" })).toEqual(["Elegí qué productos salen en esta parte."]);
    expect(problemasDeLaParte(pendientes, { 0: "4" })).toEqual(["De «ZZ Cable» quedan 3 por despachar."]);
    expect(problemasDeLaParte(pendientes, { 0: "x" })).toEqual(["La cantidad de «ZZ Cable» no es un número."]);
    expect(problemasDeLaParte(pendientes, { 0: "3" })).toEqual([]);
  });

  it("la última parte avisa «en camino»; las otras, su número", () => {
    expect(eventoDelAviso({ completo: false, parte: 1 })).toBe("parte_1");
    expect(eventoDelAviso({ completo: true, parte: 2 })).toBe("shipped");
    expect(textoDeLaParte({ completo: false, parte: 1, quedan: 2 })).toBe("Salió la parte 1. Quedan 2 unidades por despachar.");
    expect(textoDeLaParte({ completo: true, parte: 2 })).toMatch(/sale completo y queda en camino/);
  });
});

describe("despacho en partes: la sección del envío", () => {
  const filas = [
    { linea: 0, product_id: null, variant_id: null, nombre: "ZZ Cable", pedida: 3, despachada: 0, falta: 3 },
    { linea: 1, product_id: null, variant_id: null, nombre: "ZZ Consola", pedida: 2, despachada: 0, falta: 2 },
  ];

  it("despacha lo que hay, avisa al comprador con el número de la parte y recarga", async () => {
    m.rpc.mockImplementation(async (fn: string) => fn === "pendiente_de_despacho"
      ? { data: filas, error: null }
      : { data: { parte: 1, completo: false, quedan: 2, tracking_code: "ENV-1-1" }, error: null });
    const avisar = vi.fn(async () => {});
    const onDespachada = vi.fn();
    render(<DespacharEnPartes orderId="o1" renglones={renglones} carrierInicial="andreani" partes={[]} puedeDespachar
      onDespachada={onDespachada} avisar={avisar} />);
    fireEvent.click(await screen.findByRole("button", { name: "Despachar una parte" }));
    expect(screen.getByLabelText("Cantidad de ZZ Cable")).toHaveValue("3");
    expect(screen.getByLabelText("Cantidad de ZZ Consola")).toHaveValue("0");
    fireEvent.change(screen.getByLabelText("Seguimiento de la parte"), { target: { value: "AND123" } });
    fireEvent.click(screen.getByRole("button", { name: "Despachar esta parte" }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("despachar_parte_del_pedido", {
      p_order_id: "o1", p_items: [{ linea: 0, cantidad: 3 }], p_carrier: "andreani", p_tracking: "AND123",
    }));
    await waitFor(() => expect(avisar).toHaveBeenCalledWith("parte_1"));
    expect(onDespachada).toHaveBeenCalled();
    expect(m.toast.success).toHaveBeenCalledWith("Salió la parte 1. Quedan 2 unidades por despachar.");
  });

  it("lista las partes y lo que falta; sin la función en la base no se muestra", async () => {
    m.rpc.mockResolvedValue({ data: [{ ...filas[0], despachada: 3, falta: 0 }, filas[1]], error: null });
    const { unmount } = render(<DespacharEnPartes orderId="o1" renglones={renglones} carrierInicial="propio" puedeDespachar={false}
      partes={[{ id: "d1", parte: 1, carrier: "andreani", external_tracking: "AND123", status: "in_transit", tracking_code: "ENV-1-1",
        items: [{ linea: 0, nombre: "ZZ Cable", cantidad: 3 }] }]}
      onDespachada={() => {}} avisar={async () => {}} />);
    expect(await screen.findByText(/Parte 1 · En camino · Andreani/)).toBeVisible();
    expect(screen.getByText("3 × ZZ Cable")).toBeVisible();
    expect(screen.getByText("Falta despachar: 2 × ZZ Consola.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Despachar una parte" })).toBeNull();
    unmount();
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const { container } = render(<DespacharEnPartes orderId="o1" renglones={renglones} carrierInicial="propio" partes={[]} puedeDespachar
      onDespachada={() => {}} avisar={async () => {}} />);
    await waitFor(() => expect(m.rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("el comprador ve cada parte con sus productos y su seguimiento", async () => {
    m.rpc.mockResolvedValue({ data: {
      found: true, fulfillment_status: "processing", tracking_number: null, carrier: "andreani",
      envios: [{ parte: 1, carrier: "andreani", tracking: "AND123", estado: "in_transit", salio: "2026-10-31T15:00:00Z",
        productos: [{ nombre: "ZZ Cable", cantidad: 3 }] }],
    }, error: null });
    render(<OrderTracking orderNumber="#1001" email="zz@example.com" esRetiro={false} />);
    const envios = await screen.findByTestId("envios-del-pedido");
    expect(envios.textContent).toMatch(/Tu pedido sale en partes\. Te avisamos cuando salga lo que falta\./);
    expect(envios.textContent).toMatch(/Parte 1 · salió el 31\D/);
    expect(envios.textContent).toMatch(/3 × ZZ Cable/);
    expect(envios.textContent).toMatch(/AND123/);
  });
});

describe("despacho en partes: la base y el aviso", () => {
  const migracion = readFileSync("supabase/migrations/20261031000200_despachos_parciales.sql", "utf8");
  const aviso = readFileSync("supabase/functions/store-order-status-email/index.ts", "utf8");

  it("el pedido entero no pisa las partes y «entregado» alcanza a todas", () => {
    expect(migracion.match(/Este pedido se despacha en partes/g)).toHaveLength(3);
    expect(migracion).toContain("SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()\n     WHERE ecommerce_order_id = p_order_id;");
    expect(migracion).toContain("IF r.cantidad > r.falta THEN");
  });

  it("el aviso por parte es idempotente y el contrato del seguimiento se renueva", () => {
    expect(migracion).toContain("p_event !~ '^parte_[0-9]{1,3}$'");
    expect(migracion).toContain("AND p.proname = 'get_order_tracking';");
    expect(aviso).toContain('.eq("parte", parte)');
    expect(aviso).toContain("Salió una parte de tu pedido");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8")).toContain("'20261031000200': 'scripts/despachos-parciales-matrix.sql'");
  });

  it("está en el envío del pedido", () => {
    const dialogo = readFileSync("src/components/ecommerce/OrderShipmentDialog.tsx", "utf8");
    expect(dialogo).toContain("<DespacharEnPartes orderId={order.id}");
    expect(dialogo).not.toContain(".maybeSingle());");
  });
});
