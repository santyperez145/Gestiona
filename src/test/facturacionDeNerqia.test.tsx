import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FacturacionDeNerqia, { type EstadoFacturacion } from "@/components/platform/FacturacionDeNerqia";
import { formatearCuit } from "@/lib/facturacionDeNerqia";

const m = vi.hoisted(() => ({ rpc: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => m.rpc(...a) } }));

const base = (parte: Partial<EstadoFacturacion> = {}): EstadoFacturacion => ({
  activa: false, cuit_esperado: "20446484436", org_emisora_id: null, org_emisora: null, emisor_cuit: null, emisor_tipo: null,
  punto_venta: null, ambiente: null, resumen: { pendiente_emisor: 2 }, cobros_sin_registro: 0, candidatas: [], ultimas: [], ...parte,
});

beforeEach(() => { m.rpc.mockReset(); m.toast.success.mockReset(); m.toast.error.mockReset(); });

describe("facturación de Nerqia a los comercios", () => {
  it("formatea el CUIT de Nerqia", () => {
    expect(formatearCuit("20446484436")).toBe("20-44648443-6");
    expect(formatearCuit("123")).toBe("123");
  });

  it("sin organización con el certificado de Nerqia, explica qué falta y no deja activar", async () => {
    m.rpc.mockResolvedValue({ data: base(), error: null });
    render(<FacturacionDeNerqia />);
    expect(await screen.findByText(/Ninguna organización tiene en ARCA el CUIT 20-44648443-6/)).toBeVisible();
    expect(screen.getByTestId("resumen-facturacion-nerqia").textContent).toBe("0 emitidas · 2 por facturar");
    expect(screen.queryByRole("button", { name: "Activar" })).toBeNull();
  });

  it("con la organización de Nerqia, activa con ella y muestra cada factura con su CAE", async () => {
    const conEmisora = base({
      candidatas: [{ id: "org-nerqia", nombre: "Nerqia", tipo: "monotributo", ambiente: "produccion", punto_venta: 3 }],
      ultimas: [{ id: "f1", estado: "emitida", motivo: null, intentos: 1, created_at: "2026-11-01T12:00:00Z", monto: 19900,
        periodo_desde: "2026-11-01T15:00:00Z", periodo_hasta: "2026-12-01T15:00:00Z", comercio: "ZZ Ferretería", numero: "C-0003-00000001",
        afip_status: "authorized", cae: "76123456789012" }],
    });
    m.rpc.mockImplementation(async (fn: string) => ({ data: fn === "platform_configurar_facturacion" ? { ...conEmisora, activa: true } : conEmisora, error: null }));
    render(<FacturacionDeNerqia />);
    fireEvent.click(await screen.findByRole("button", { name: "Activar" }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("platform_configurar_facturacion", { p_org_emisora: "org-nerqia", p_activa: true }));
    expect(m.toast.success).toHaveBeenCalledWith("Facturación de Nerqia activa: los cobros se facturan solos.");
    expect(screen.getByText("ZZ Ferretería")).toBeVisible();
    expect(screen.getByText(/CAE 76123456789012/)).toBeVisible();
  });

  it("sin la migración aplicada no se muestra", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const { container } = render(<FacturacionDeNerqia />);
    await waitFor(() => expect(m.rpc).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("la base factura cada cobro aprobado sin frenar el pago, y está en Negocio", () => {
    const sql = readFileSync("supabase/migrations/20261101000100_facturar_suscripciones.sql", "utf8");
    expect(sql).toContain("cuit_esperado text NOT NULL DEFAULT '20446484436'");
    expect(sql).toContain("'concepto', '2'");
    expect(sql).toContain("RAISE WARNING 'facturar_cobro_de_suscripcion(%): %', NEW.id, SQLERRM;");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8")).toContain("'20261101000100': 'scripts/facturar-suscripciones-matrix.sql'");
    expect(readFileSync("src/pages/PlatformBusinessPage.tsx", "utf8")).toContain("<FacturacionDeNerqia />");
  });
});
