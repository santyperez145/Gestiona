import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderTracking from "@/storefront/OrderTracking";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

const lecturaLista = {
  data: {
    found: true,
    fulfillment_status: "processing",
    carrier: "andreani",
    tracking_number: null,
    ordered_at: "2026-09-04T12:00:00Z",
  },
  error: null,
};

describe("seguimiento resiliente del pedido", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("reserva el espacio mientras consulta el estado", () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<OrderTracking orderNumber="NQ-10" email="buyer@example.com" />);

    expect(screen.getByRole("status")).toHaveTextContent("Actualizando seguimiento");
    expect(container.querySelector('[data-storefront-state="tracking-loading"]')).not.toBeNull();
  });

  it("muestra un error recuperable y reintenta sin borrar el pedido", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "network down" } })
      .mockResolvedValueOnce(lecturaLista);

    const { container } = render(<OrderTracking orderNumber="NQ-10" email="buyer@example.com" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Tu pedido sigue guardado");
    expect(screen.queryByText("network down")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar seguimiento" }));

    await waitFor(() => {
      expect(container.querySelector('[data-storefront-state="tracking-ready"]')).not.toBeNull();
    });
    expect(screen.getByText("Preparando el envío")).toBeVisible();
    expect(rpc).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("no convierte una lectura inconsistente en una sección ausente", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { found: false }, error: null });

    render(<OrderTracking orderNumber="NQ-10" email="buyer@example.com" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos actualizar el seguimiento");
    expect(screen.getByRole("button", { name: "Reintentar seguimiento" })).toBeVisible();
    consoleError.mockRestore();
  });
});
