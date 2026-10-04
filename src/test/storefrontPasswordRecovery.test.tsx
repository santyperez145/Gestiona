import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StorePasswordRecovery from "@/storefront/StorePasswordRecovery";

const mocks = vi.hoisted(() => ({
  updatePassword: vi.fn(),
}));

vi.mock("@/storefront/storeContext", () => ({
  useStore: () => ({ basePath: "" }),
}));

vi.mock("@/storefront/storeAuth", () => ({
  useStoreAuth: () => ({
    loading: false,
    session: { user: { id: "customer-1" } },
    passwordRecovery: true,
    updatePassword: mocks.updatePassword,
  }),
}));

describe("recuperación de contraseña de la tienda", () => {
  beforeEach(() => {
    mocks.updatePassword.mockReset();
    mocks.updatePassword.mockResolvedValue({});
  });

  it("valida, actualiza y conserva el estado de éxito al consumir la sesión recovery", async () => {
    render(
      <MemoryRouter initialEntries={["/recuperar-clave#type=recovery"]}>
        <StorePasswordRecovery />
      </MemoryRouter>,
    );

    const inputs = screen.getAllByLabelText(/contraseña/i);
    fireEvent.change(inputs[0], { target: { value: "ClaveTienda1" } });
    fireEvent.change(inputs[1], { target: { value: "ClaveTienda1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith("ClaveTienda1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada");
  });
});
