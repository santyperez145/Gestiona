import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StorefrontStatus from "@/storefront/StorefrontStatus";

const estado = vi.hoisted(() => ({ valor: "disponible" as string }));
vi.mock("@/hooks/useDisponibilidadDelServicio", () => ({
  useDisponibilidadDelServicio: () => ({ estado: estado.valor, reintentar: () => {} }),
}));

// 2026-10-21: con la base caída la tienda decía «La red falló» y el comprador
// creía que era su conexión.
describe("tienda que no carga", () => {
  it("si la caída es de Nerqia lo dice y no culpa a la red del comprador", () => {
    estado.valor = "caido";
    render(<StorefrontStatus kind="error" storeName="Exentry" onRetry={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Exentry no está disponible en este momento");
    expect(screen.getByRole("alert")).toHaveTextContent("se recarga sola");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/red falló/);
  });

  it("cuando el servicio vuelve recarga sola, una vez", () => {
    estado.valor = "caido";
    const onRetry = vi.fn();
    const { rerender } = render(<StorefrontStatus kind="error" onRetry={onRetry} />);
    expect(onRetry).not.toHaveBeenCalled();
    estado.valor = "disponible";
    rerender(<StorefrontStatus kind="error" onRetry={onRetry} />);
    rerender(<StorefrontStatus kind="error" onRetry={onRetry} />);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("si Nerqia anda y la tienda no cargó, ofrece reintentar sin recargar solo", () => {
    estado.valor = "disponible";
    const onRetry = vi.fn();
    render(<StorefrontStatus kind="error" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("El catálogo no respondió");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("una tienda inexistente no consulta ni recarga", () => {
    estado.valor = "caido";
    render(<StorefrontStatus kind="not-found" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Tienda no encontrada");
  });
});
