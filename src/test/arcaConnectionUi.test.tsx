import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConectarAfip from "@/components/afip/ConectarAfip";
import { esCertificadoDePrueba } from "@/components/platform/RenovarCertificadoArca";

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/edgeErrors", () => ({ mensajeDeEdgeFunction: async (_error: unknown, data: { error?: string }) => data.error }));
const props = { orgId: "zz-org", motivo: "falta_delegar" as const, plataformaCuit: "20123456786", plataformaRazonSocial: "ZZ Platform",
  cuitDelComercio: "30712345671", ambiente: "homologacion", canVerify: true, onVerificado: vi.fn() };
const activation = "Ya delegué · solicitar activación";
beforeEach(() => { vi.clearAllMocks(); invoke.mockResolvedValue({ data: { ok: true }, error: null }); rpc.mockResolvedValue({ data: { ok: true }, error: null }); });
describe("ARCA connection recovery and write permissions", () => {
  it("does not query ARCA when editing permission was denied", () => {
    render(<ConectarAfip {...props} canVerify={false} />);
    expect(screen.getByRole("button", { name: activation })).toBeDisabled(); expect(invoke).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not ask for delegation when the selected environment is unavailable", () => {
    render(<ConectarAfip {...props} motivo="falta_ambiente" />);
    expect(screen.getByText("Revisá el ambiente fiscal")).toBeVisible();
    expect(screen.queryByRole("button", { name: activation })).not.toBeInTheDocument();
  });
  it("recovers a rejected invocation without retaining a busy button", async () => {
    rpc.mockRejectedValue(new Error("ZZ secret")); render(<ConectarAfip {...props} />);
    fireEvent.click(screen.getByRole("button", { name: activation }));
    await waitFor(() => expect(screen.getByRole("button", { name: activation })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Tus datos se conservan");
    expect(props.onVerificado).not.toHaveBeenCalled(); expect(screen.queryByText(/ZZ secret/)).not.toBeInTheDocument();
  });
  it("ignores a previous organization response", async () => {
    let finish: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ConectarAfip {...props} />);
    fireEvent.click(screen.getByRole("button", { name: activation }));
    view.rerender(<ConectarAfip {...props} orgId="zz-other" />);
    await act(async () => { finish({ data: { ok: true }, error: null }); });
    expect(props.onVerificado).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: activation })).toBeEnabled();
  });
  it("requests activation without directly calling the provider verification", async () => {
    render(<ConectarAfip {...props} />); fireEvent.click(screen.getByRole("button", { name: activation }));
    await waitFor(() => expect(props.onVerificado).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith("afip_solicitar_revision_delegacion", { p_org: props.orgId }); expect(invoke).not.toHaveBeenCalled();
  });
  it("recovers a verification of its own identity without keeping a busy button", async () => {
    invoke.mockRejectedValue(new Error("ZZ secret")); render(<ConectarAfip {...props} motivo="sin_delegacion_necesaria" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reintentar ahora" })).toBeEnabled());
    expect(screen.getByText(/Tus datos se conservan/)).toBeVisible(); expect(props.onVerificado).not.toHaveBeenCalled();
  });
});

// 2026-10-15: el certificado de Nerqia era de homologación cargado como
// producción y ARCA lo rechazaba; el comercio veía «todo listo».
describe("certificado de Nerqia rechazado por ARCA", () => {
  it("avisa que no es del comercio y deja adelantar la delegación", () => {
    render(<ConectarAfip {...props} motivo="plataforma_rechazada" />);
    expect(screen.getByText("Nerqia está renovando su certificado de ARCA")).toBeVisible();
    expect(screen.getByText(/No es un problema de tu configuración/)).toBeVisible();
    expect(screen.getByRole("button", { name: activation })).toBeEnabled();
  });
  it("no repite la guía si el comercio ya delegó o pidió la activación", () => {
    const view = render(<ConectarAfip {...props} motivo="plataforma_rechazada" delegacionVerificada />);
    expect(screen.getByText(/tu delegación ya está verificada/)).toBeVisible();
    expect(screen.queryByRole("button", { name: activation })).not.toBeInTheDocument();
    view.rerender(<ConectarAfip {...props} motivo="plataforma_rechazada" delegacionSolicitada />);
    expect(screen.getByText(/ya recibimos tu solicitud de activación/)).toBeVisible();
    expect(screen.queryByRole("button", { name: activation })).not.toBeInTheDocument();
  });
  it("reconoce un certificado de homologación cargado como producción", () => {
    expect(esCertificadoDePrueba({ environment: "produccion", certificado_emisor: "CN=Computadores Test, O=AFIP, C=AR" })).toBe(true);
    expect(esCertificadoDePrueba({ environment: "homologacion", certificado_emisor: "CN=Computadores Test, O=AFIP, C=AR" })).toBe(false);
    expect(esCertificadoDePrueba({ environment: "produccion", certificado_emisor: "CN=Computadores, O=AFIP, C=AR" })).toBe(false);
    expect(esCertificadoDePrueba(null)).toBe(false);
  });
});
