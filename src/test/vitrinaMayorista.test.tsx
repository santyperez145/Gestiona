import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { avisoCheckoutMedioPago, etiquetaMedioCheckout } from "@/lib/storeOrderBuyerCopy";

const { estado } = vi.hoisted(() => ({ estado: { actual: {} as Record<string, unknown> } }));
vi.mock("@/storefront/storeContext", () => ({ useStore: () => estado.actual }));

import PrecioMayorista, { PrecioReservado, usePrecioReservado } from "@/storefront/PrecioMayorista";

const fmt = (n: number) => `$ ${n}`;

describe("venta mayorista en la vitrina", () => {
  it("el comprador aprobado ve su precio y los tramos por cantidad", () => {
    estado.actual = { fmt, basePath: "/tienda/zz", tramosMayoristas: { p1: [{ desde: 1, precio: 900 }, { desde: 10, precio: 700 }] } };
    render(<MemoryRouter><PrecioMayorista productId="p1" ficha /></MemoryRouter>);
    expect(screen.getByText("Tu precio: $ 900")).toBeVisible();
    expect(screen.getByText("desde 10 u.: $ 700")).toBeVisible();
  });

  it("sin tramos no muestra nada", () => {
    estado.actual = { fmt, tramosMayoristas: {} };
    const { container } = render(<MemoryRouter><PrecioMayorista productId="p1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it("en una tienda sólo para mayoristas el precio se reserva a los aprobados", () => {
    estado.actual = { mayorista: { modo: "exclusivo", comprador: null } };
    expect(renderHook(() => usePrecioReservado()).result.current).toBe(true);
    estado.actual = { mayorista: { modo: "exclusivo", comprador: { estado: "aprobado" } } };
    expect(renderHook(() => usePrecioReservado()).result.current).toBe(false);
    estado.actual = { mayorista: { modo: "mixto", comprador: null } };
    expect(renderHook(() => usePrecioReservado()).result.current).toBe(false);
    estado.actual = { basePath: "/tienda/zz", mayorista: { modo: "exclusivo" } };
    render(<MemoryRouter><PrecioReservado /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "pedí tu cuenta" })).toHaveAttribute("href", "/tienda/zz/cuenta");
  });

  it("la cuenta corriente tiene su nombre y su explicación en el checkout", () => {
    expect(etiquetaMedioCheckout("cuenta_corriente", false)).toBe("A cuenta corriente");
    expect(avisoCheckoutMedioPago({ metodo: "cuenta_corriente", esRetiro: false })).toMatch(/aprueba el pedido/);
  });
});
