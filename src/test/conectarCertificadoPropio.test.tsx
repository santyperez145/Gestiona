import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConectarCertificadoPropio, { type EstadoConexionPropia } from "@/components/afip/ConectarCertificadoPropio";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/edgeErrors", () => ({ mensajeDeEdgeFunction: async (_e: unknown, data: { error?: string }) => data?.error }));

const base: EstadoConexionPropia = {
  cuit: "23228915599", modo: "propio", environment: "produccion", tipo_emisor: "monotributo", punto_venta: 3,
  motivo: "falta_certificado_propio", delegacion_verificada: false,
};
const onCambio = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
  URL.createObjectURL = vi.fn(() => "blob:zz");
  URL.revokeObjectURL = vi.fn();
});

describe("conectar ARCA con certificado propio", () => {
  it("sin certificado: guía completa, sin pedir la clave fiscal", () => {
    render(<ConectarCertificadoPropio orgId="zz-org" estado={base} canEdit onCambio={onCambio} />);
    expect(screen.getByText("Conectá ARCA con tu certificado")).toBeVisible();
    expect(screen.getByText(/Nerqia nunca te pide la clave fiscal/)).toBeVisible();
    expect(screen.getByText("Creá el certificado en ARCA")).toBeVisible();
    expect(screen.getByText("Asocialo a Facturación Electrónica")).toBeVisible();
    expect(screen.getByText(/Factura Electrónica - Monotributo - Web Services/)).toBeVisible();
    expect(screen.getByText("Primero generá el pedido del paso 1.")).toBeVisible();
  });

  it("generar el pedido lo descarga y no pasa por el navegador ninguna clave", async () => {
    invoke.mockResolvedValue({ data: { ok: true, csr: "-----BEGIN CERTIFICATE REQUEST-----zz" }, error: null });
    render(<ConectarCertificadoPropio orgId="zz-org" estado={base} canEdit onCambio={onCambio} />);
    fireEvent.click(screen.getByRole("button", { name: "Generar pedido" }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("afip-credentials", { body: { org_id: "zz-org", action: "generar_pedido", environment: "produccion" } });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("falta asociar: explica el paso y permite probar de nuevo sin volver a subir nada", async () => {
    const estado = { ...base, motivo: "certificado_rechazado", certificado_vence: "2028-10-22T00:00:00Z",
      certificado_verificado_motivo: "El certificado es válido, pero en ARCA todavía no está asociado a Facturación Electrónica." };
    render(<ConectarCertificadoPropio orgId="zz-org" estado={estado} canEdit onCambio={onCambio} />);
    expect(screen.getByText("Falta un paso en ARCA")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ya lo asocié · probar de nuevo" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("afip-credentials", { body: { org_id: "zz-org", action: "verificar" } }));
  });

  it("con el certificado aceptado verifica solo el punto de venta, una vez", async () => {
    const estado = { ...base, motivo: "falta_verificar", certificado_vence: "2028-10-22T00:00:00Z", certificado_verificado_ok: true };
    const { rerender } = render(<ConectarCertificadoPropio orgId="zz-org" estado={estado} canEdit onCambio={onCambio} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("afip-authorize", { body: { org_id: "zz-org", action: "verificar_delegacion" } }));
    rerender(<ConectarCertificadoPropio orgId="zz-org" estado={estado} canEdit onCambio={onCambio} />);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("vencido: renovación sin repetir la asociación", () => {
    const estado = { ...base, motivo: "certificado_vencido", certificado_vence: "2026-01-01T00:00:00Z" };
    render(<ConectarCertificadoPropio orgId="zz-org" estado={estado} canEdit onCambio={onCambio} />);
    expect(screen.getByText("Tu certificado venció")).toBeVisible();
    expect(screen.getByText(/no hay que repetirla/)).toBeVisible();
  });

  it("listo: muestra CUIT y vencimiento, y sin permiso no ofrece acciones", () => {
    const estado = { ...base, motivo: "listo", delegacion_verificada: true, certificado_vence: "2028-10-22T12:00:00Z", certificado_verificado_ok: true };
    render(<ConectarCertificadoPropio orgId="zz-org" estado={estado} canEdit={false} onCambio={onCambio} />);
    expect(screen.getByText("Facturás con tu propio certificado")).toBeVisible();
    expect(screen.getByText(/CUIT 23228915599/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Probar con ARCA/ })).not.toBeInTheDocument();
  });
});
