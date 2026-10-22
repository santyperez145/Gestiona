import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CertificadosDeComercios from "@/components/platform/CertificadosDeComercios";
import { ordenarPorUrgencia, type CertificadoDeComercio } from "@/lib/certificadosDeComercios";

const { respuesta } = vi.hoisted(() => ({ respuesta: { valor: { data: [] as unknown, error: null as unknown } } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: async () => respuesta.valor }) },
}));

const fila = (org_id: string, estado: string, extra: Partial<CertificadoDeComercio> = {}): CertificadoDeComercio => ({
  org_id, organization_name: `ZZ ${org_id}`, cuit: "20123456786", environment: "produccion", modo: "propio",
  certificado_vence: null, certificado_verificado_motivo: null, pedido_creado_at: null, last_error: null, estado, ...extra,
});

describe("certificados de los comercios para soporte", () => {
  it("lo urgente primero: vencidos, rechazados, por vencer", () => {
    const orden = ordenarPorUrgencia([fila("a", "listo"), fila("b", "por_vencer"), fila("c", "vencido"), fila("d", "rechazado"), fila("e", "sin_certificado")]);
    expect(orden.map(f => f.estado)).toEqual(["vencido", "rechazado", "por_vencer", "sin_certificado", "listo"]);
  });

  it("muestra conteos por estado y filtra", async () => {
    respuesta.valor = { data: [fila("a", "listo"), fila("b", "vencido", { certificado_vence: "2026-10-01T00:00:00Z" }), fila("c", "rechazado", { certificado_verificado_motivo: "Falta asociar" })], error: null };
    render(<CertificadosDeComercios />);
    expect(await screen.findByRole("button", { name: "Vencido (1)" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Rechazado por ARCA (1)" }));
    expect(screen.getByText("Falta asociar")).toBeVisible();
    expect(screen.queryByText("ZZ a")).not.toBeInTheDocument();
  });

  it("sin la migración lo dice, y un error no se confunde con «todo bien»", async () => {
    respuesta.valor = { data: null, error: { code: "PGRST205", message: "zz" } };
    const { unmount } = render(<CertificadosDeComercios />);
    expect(await screen.findByText(/Disponible cuando se aplique la migración/)).toBeVisible();
    unmount();
    vi.spyOn(console, "error").mockImplementation(() => {});
    respuesta.valor = { data: null, error: { code: "42501", message: "zz" } };
    render(<CertificadosDeComercios />);
    expect(await screen.findByRole("alert")).toHaveTextContent("no significa que no haya problemas");
  });
});
