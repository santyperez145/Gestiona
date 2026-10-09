import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FiscalHealthPanel from "@/components/afip/FiscalHealthPanel";
import { saludFiscal, type ComprobanteFiscalSalud, type ConexionFiscal } from "@/lib/fiscalHealth";
import { resumirRechazoArca } from "../../supabase/functions/_shared/arcaRechazos";

const ahora = new Date("2026-10-09T15:00:00Z");
const conexionLista: ConexionFiscal = {
  cuit: "20111111112", razon_social: "ZZ Comercio", punto_venta: 4, domicilio: "Calle 1",
  ingresos_brutos: "No inscripto", inicio_actividades: "2020-01-01", environment: "produccion",
  configured: true, motivo: "listo", delegacion_verificada: true,
};
const autorizada = (fecha: string): ComprobanteFiscalSalud => ({
  status: "draft", cae: "41124599989845", tipo_comprobante: 6, afip_status: "authorized", afip_error: null, issue_date: fecha,
});
const estado = (salud: ReturnType<typeof saludFiscal>, id: string) => salud.controles.find(c => c.id === id)?.estado;

describe("salud fiscal", () => {
  it("da 100 con conexión verificada en producción y CAE reciente", () => {
    const salud = saludFiscal(conexionLista, [autorizada("2026-10-08")], ahora);
    expect(salud.puntaje).toBe(100);
    expect(salud.controles.every(c => c.estado === "ok")).toBe(true);
    expect(salud.controles.find(c => c.id === "cae_reciente")?.detalle).toBe("Último CAE hace 1 día.");
  });

  it("sin datos no inventa salud: conexión y datos fallan", () => {
    const salud = saludFiscal(null, [], ahora);
    expect(estado(salud, "datos")).toBe("falla");
    expect(estado(salud, "conexion")).toBe("falla");
    expect(estado(salud, "delegacion")).toBe("falla");
    expect(salud.puntaje).toBeLessThan(40);
  });

  it("exige Ingresos Brutos e inicio de actividades sólo en producción", () => {
    const parcial = { ...conexionLista, ingresos_brutos: "", inicio_actividades: null };
    expect(saludFiscal(parcial, [], ahora).controles[0]).toMatchObject({ estado: "atencion", detalle: "Falta: Ingresos Brutos, inicio de actividades." });
    const homologacion = saludFiscal({ ...parcial, environment: "homologacion" }, [], ahora);
    expect(estado(homologacion, "datos")).toBe("ok");
    expect(estado(homologacion, "ambiente")).toBe("atencion");
  });

  it("cuenta rechazos y pendientes con la misma regla de la bandeja", () => {
    const salud = saludFiscal(conexionLista, [
      { ...autorizada("2026-10-01"), cae: null, afip_status: "rejected", afip_error: resumirRechazoArca([], [{ code: 10013, msg: "" }]).mensaje },
      { ...autorizada("2026-10-01"), cae: null, afip_status: "processing" },
      { ...autorizada("2026-10-01"), cae: null, afip_status: null },
    ], ahora);
    expect(salud.controles.find(c => c.id === "rechazos")).toMatchObject({ estado: "falla", detalle: "1 comprobante necesita una acción." });
    expect(salud.controles.find(c => c.id === "pendientes")?.detalle).toBe("1 sin autorizar · 1 en verificación.");
  });

  it("marca atención si el último CAE es viejo", () => {
    expect(estado(saludFiscal(conexionLista, [autorizada("2026-08-01")], ahora), "cae_reciente")).toBe("atencion");
  });

  it("la activación en revisión es atención, no falla", () => {
    expect(estado(saludFiscal({ ...conexionLista, delegacion_verificada: false, motivo: "esperando_plataforma" }, [], ahora), "delegacion")).toBe("atencion");
  });
});

describe("panel de salud fiscal", () => {
  it("muestra puntaje, controles y el acceso a pendientes", () => {
    const salud = saludFiscal(conexionLista, [{ ...autorizada("2026-10-01"), cae: null, afip_status: "config_error", afip_error: "x" }], ahora);
    render(<MemoryRouter><FiscalHealthPanel salud={salud} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Salud fiscal" })).toBeInTheDocument();
    expect(screen.getByLabelText(`Puntaje ${salud.puntaje} de 100`)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Ver pendientes" })).toHaveAttribute("href", "/facturas");
  });
});
