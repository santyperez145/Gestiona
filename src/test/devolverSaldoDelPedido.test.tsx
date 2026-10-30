import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevolverSaldoDelPedido from "@/components/ecommerce/DevolverSaldoDelPedido";

const m = vi.hoisted(() => ({
  movimientos: { data: [] as unknown[], error: null as unknown },
  rpc: vi.fn(),
  error: vi.fn(),
  exito: vi.fn(),
  filtros: [] as string[][],
}));
vi.mock("sonner", () => ({ toast: { error: m.error, success: m.exito } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (columna: string, valor: string) => { m.filtros.push([tabla, columna, valor]); return q; };
      q.then = (resolver: (v: unknown) => unknown) => resolver(m.movimientos);
      return q;
    },
    rpc: m.rpc,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.filtros.length = 0;
  m.movimientos = { data: [{ monto_ars: -40000 }], error: null };
});

describe("devolver el saldo de un pedido con contracargo", () => {
  it("ofrece devolverlo, lo pide a la base y confirma lo devuelto", async () => {
    m.rpc.mockResolvedValue({ data: { ok: true, devuelto: 40000 }, error: null });
    render(<DevolverSaldoDelPedido orderId="zz-pedido" saldoAplicado={40000} />);
    const boton = await screen.findByRole("button", { name: /Devolver .*40\.000.* de saldo/ });
    expect(m.filtros).toEqual([["saldo_a_favor_movimientos", "ecommerce_order_id", "zz-pedido"]]);
    fireEvent.click(boton);
    expect(await screen.findByText(/Le devolviste .*40\.000.* de saldo a favor al cliente/)).toBeVisible();
    expect(m.rpc).toHaveBeenCalledWith("devolver_saldo_del_pedido", { p_order_id: "zz-pedido" });
    expect(m.exito).toHaveBeenCalled();
  });

  it("si ya se devolvió, no lo vuelve a ofrecer", async () => {
    m.movimientos = { data: [{ monto_ars: -40000 }, { monto_ars: 40000 }], error: null };
    render(<DevolverSaldoDelPedido orderId="zz-pedido" saldoAplicado={40000} />);
    expect(await screen.findByText(/Le devolviste/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("un rechazo de la base se muestra y deja reintentar", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "Sólo el dueño o un administrador devuelve el saldo de un pedido" } });
    render(<DevolverSaldoDelPedido orderId="zz-pedido" saldoAplicado={40000} />);
    const boton = await screen.findByRole("button", { name: /Devolver/ });
    fireEvent.click(boton);
    await vi.waitFor(() => expect(m.error).toHaveBeenCalledWith("No se pudo devolver el saldo", {
      description: "Sólo el dueño o un administrador devuelve el saldo de un pedido",
    }));
    expect(boton).toBeEnabled();
  });

  it("si no se pudo leer lo devuelto, no ofrece nada", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    m.movimientos = { data: null as unknown as unknown[], error: { message: "sin red" } };
    const { container } = render(<DevolverSaldoDelPedido orderId="zz-pedido" saldoAplicado={40000} />);
    await vi.waitFor(() => expect(consola).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    consola.mockRestore();
  });
});
