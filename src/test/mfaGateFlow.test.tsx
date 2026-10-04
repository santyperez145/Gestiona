import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MfaGate from "@/components/auth/MfaGate";

const mocks = vi.hoisted(() => ({
  aal: vi.fn(),
  factors: vi.fn(),
  verify: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.aal,
        listFactors: mocks.factors,
        challengeAndVerify: mocks.verify,
        enroll: mocks.enroll,
        unenroll: mocks.unenroll,
      },
      signOut: mocks.signOut,
    },
  },
}));
vi.mock("@/components/shared/BrandLogo", () => ({
  default: () => <div>Nerqia</div>,
}));

const gate = () => render(
  <MfaGate isAdmin orgRequiresMfa>
    <div data-testid="protected-app">Panel protegido</div>
  </MfaGate>,
);

describe("MfaGate de la plataforma", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.factors.mockResolvedValue({ data: { totp: [{ id: "factor-1", status: "verified" }] }, error: null });
    mocks.verify.mockResolvedValue({ error: null });
    mocks.enroll.mockResolvedValue({
      data: { id: "factor-2", totp: { uri: "otpauth://totp/Nerqia?secret=ABC", secret: "ABC" } },
      error: null,
    });
    mocks.unenroll.mockResolvedValue({ error: null });
  });
  afterEach(cleanup);

  it("restaura sin nuevo OTP una sesión que ya está en AAL2", async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    gate();
    expect(await screen.findByTestId("protected-app")).toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("exige el código en una sesión nueva AAL1", async () => {
    mocks.aal
      .mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })
      .mockResolvedValueOnce({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    gate();
    expect(await screen.findByText("Verificación en dos pasos")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-app")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" }));
    expect(await screen.findByTestId("protected-app")).toBeInTheDocument();
  });

  it("nunca abre el panel si la comprobación falla", async () => {
    mocks.aal.mockRejectedValue(new Error("network"));
    gate();
    expect(await screen.findByText("No pudimos verificar tu acceso")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-app")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar verificación" })).toBeInTheDocument();
  });

  it("activa el factor obligatorio dentro del gate antes de abrir el panel", async () => {
    mocks.aal
      .mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null })
      .mockResolvedValueOnce({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    mocks.factors
      .mockResolvedValueOnce({ data: { totp: [] }, error: null })
      .mockResolvedValueOnce({ data: { totp: [] }, error: null })
      .mockResolvedValueOnce({ data: { totp: [{ id: "factor-2", status: "verified" }] }, error: null });
    gate();
    expect(await screen.findByText("2FA obligatorio")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-app")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configurar ahora" }));
    fireEvent.change(await screen.findByPlaceholderText("Código de 6 dígitos"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Activar verificación" }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ factorId: "factor-2", code: "654321" }));
    expect(await screen.findByTestId("protected-app")).toBeInTheDocument();
  });
});
