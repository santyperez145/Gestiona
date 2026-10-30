import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { destinoDespuesDelLogin, enlaceDeInvitacion, guardarInvitacionPendiente, olvidarInvitacionPendiente } from "@/lib/estudio";

const { llamadas, archivosZip, usuario } = vi.hoisted(() => ({
  llamadas: [] as { fn: string; args: Record<string, unknown> }[],
  archivosZip: new Map<string, unknown>(),
  usuario: { actual: { id: "zz-contador", email: "estudio@invalid.test" } as { id: string; email: string } | null },
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: usuario.actual, loading: false }) }));
vi.mock("xlsx", () => ({
  utils: { book_new: () => ({}), aoa_to_sheet: (f: unknown) => f, book_append_sheet: () => undefined },
  write: () => new Uint8Array([1]),
}));
vi.mock("jszip", () => ({
  default: class { file(n: string, c: unknown) { archivosZip.set(n, c); } generateAsync() { return Promise.resolve(new Blob(["zz"])); } },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      if (fn === "estudio_clientes") {
        return Promise.resolve({ data: [{ org_id: "zz-org", negocio: "ZZ Ferretería", razon_social: "ZZ SRL", cuit: "20123456786",
          tipo_emisor: "responsable_inscripto", facturas: 1, total_facturado: 121, compras: 0, cierres_z: 0, cierres_z_borrador: 1, retenciones: 0 }], error: null });
      }
      if (fn === "estudio_datos_mes") {
        return Promise.resolve({ data: { razon_social: "ZZ SRL", cuit: "20123456786", monotributo: false, homologacion: 0,
          comprobantes: [{ id: "f1", issue_date: "2026-09-10", tipo_comprobante: 6, punto_venta: 3, numero_afip: 1, subtotal: 100,
            tax_amount: 21, tax_pct: 21, total: 121, invoice_items: [] }],
          compras: [], retenciones: [], inscripciones: [], cierres: [], borradores_z: 1, tiques_a: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  },
}));

import EstudioPage from "@/pages/EstudioPage";

beforeEach(() => { llamadas.length = 0; archivosZip.clear(); olvidarInvitacionPendiente(); usuario.actual = { id: "zz-contador", email: "estudio@invalid.test" }; });

describe("portal del contador", () => {
  it("quien viene de una invitación vuelve al portal después de entrar", () => {
    expect(destinoDespuesDelLogin()).toBe("/");
    guardarInvitacionPendiente("zz-token");
    expect(destinoDespuesDelLogin()).toBe("/estudio");
    expect(enlaceDeInvitacion("a b", "https://nerqia.app")).toBe("https://nerqia.app/estudio?invitacion=a%20b");
  });

  it("muestra a sus clientes y arma el paquete del mes, que queda registrado", async () => {
    URL.createObjectURL = vi.fn(() => "blob:zz");
    URL.revokeObjectURL = vi.fn();
    render(<MemoryRouter initialEntries={["/estudio"]}><EstudioPage /></MemoryRouter>);
    expect(await screen.findByText("ZZ SRL")).toBeVisible();
    expect(screen.getByText("1 sin confirmar")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Paquete del mes de ZZ SRL/ }));
    await waitFor(() => expect(llamadas.some(l => l.fn === "estudio_registrar_descarga")).toBe(true));
    expect([...archivosZip.keys()]).toContain("LEAME.txt");
    expect(String(archivosZip.get("LEAME.txt"))).toContain("Hay 1 cierre(s) Z en borrador");
  });

  it("acepta la invitación del enlace con la sesión puesta", async () => {
    render(<MemoryRouter initialEntries={["/estudio?invitacion=zz-token"]}><EstudioPage /></MemoryRouter>);
    await waitFor(() => expect(llamadas).toContainEqual({ fn: "aceptar_invitacion_contador", args: { p_token: "zz-token" } }));
  });

  it("sin sesión guarda la invitación y pide entrar", async () => {
    usuario.actual = null;
    render(<MemoryRouter initialEntries={["/estudio?invitacion=zz-token"]}><EstudioPage /></MemoryRouter>);
    expect(await screen.findByText(/Entrá con el email al que te llegó la invitación/)).toBeVisible();
    expect(destinoDespuesDelLogin()).toBe("/estudio");
  });
});
