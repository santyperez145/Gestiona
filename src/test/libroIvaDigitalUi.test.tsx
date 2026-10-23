import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import LibroIvaDigital from "@/components/afip/LibroIvaDigital";
const { errorAviso } = vi.hoisted(() => ({ errorAviso: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: errorAviso, success: vi.fn(), info: vi.fn() } }));

const { respuestas, compras, retenciones, llamadas } = vi.hoisted(() => ({ respuestas: [] as unknown[], compras: [] as unknown[], retenciones: [] as unknown[], llamadas: [] as string[][] }));
const { hojas, escribir } = vi.hoisted(() => ({ hojas: [] as string[], escribir: vi.fn() }));
vi.mock("xlsx", () => ({
  utils: { book_new: () => ({}), aoa_to_sheet: (filas: unknown[][]) => filas, book_append_sheet: (_wb: unknown, _hoja: unknown, nombre: string) => { hojas.push(nombre); } },
  writeFile: escribir,
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "lte", "order"]) q[m] = (...a: unknown[]) => { llamadas.push([tabla, m, ...a.map(String)]); return q; };
    q.range = async () => (tabla === "invoices" ? respuestas.shift() : compras.shift()) ?? { data: [], error: null };
    q.limit = async () => retenciones.shift() ?? { data: [], error: null };
    return q;
  };
  return { supabase: { from: (tabla: string) => consulta(tabla) } };
});

const factura = (id: string, extra: Record<string, unknown> = {}) => ({
  id, number: id, issue_date: "2026-09-10", tipo_comprobante: 6, punto_venta: 3, numero_afip: Number(id.replace(/\D/g, "")) || 1,
  customer_tax_id: "", customer_name: "", subtotal: 100, tax_amount: 21, tax_pct: 21, total: 121, afip_environment: "produccion", invoice_items: [], ...extra,
});

beforeEach(() => { respuestas.length = 0; compras.length = 0; retenciones.length = 0; llamadas.length = 0; });

describe("Libro IVA Digital en la pantalla de ARCA", () => {
  it("resume el mes, deja afuera homologación y avisa lo que no entra", async () => {
    respuestas.push({ data: [factura("zz1"), factura("zz2", { afip_environment: "homologacion" }), factura("zz3", { total: 999 })], error: null });
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    expect(await screen.findByText("IVA débito fiscal")).toBeVisible();
    expect(screen.getByText(/1 comprobante no entra en el libro/)).toBeVisible();
    expect(screen.getByText(/1 comprobantes de homologación/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Comprobantes \(\.txt\)/ })).toBeEnabled();
    expect(llamadas).toContainEqual(["invoices", "eq", "afip_status", "authorized"]);
    expect(llamadas).toContainEqual(["invoices", "not", "cae", "is", "null"]);
  });

  it("un error de lectura se ve y se puede reintentar, nunca como libro vacío", async () => {
    respuestas.push({ data: null, error: { message: "zz" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo canEdit={false} /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron leer las facturas del período");
    expect(screen.queryByText("No hay facturas con CAE en este período.")).not.toBeInTheDocument();
    respuestas.push({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("No hay facturas con CAE en este período.")).toBeVisible());
    expect(screen.getByText(/monotributistas no presentan Libro IVA/)).toBeVisible();
  });

  it("con compras cargadas muestra la posición de IVA del período", async () => {
    respuestas.push({ data: [factura("zz1", { subtotal: 10000, tax_amount: 2100, total: 12100 })], error: null });
    compras.push({ data: [{
      id: "c1", fecha: "2026-09-02", tipo_comprobante: 1, punto_venta: 2, numero: 10, cuit_emisor: "30712345671", razon_social_emisor: "ZZ Proveedor",
      alicuotas: [{ tasa: 21, neto: 5000, iva: 1050 }], no_gravado: 0, exento: 0, percepcion_iva: 50, percepcion_nacionales: 0,
      percepcion_iibb: 0, percepcion_municipal: 0, impuestos_internos: 0, otros_tributos: 0, total: 6100,
    }], error: null });
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    const posicion = await screen.findByLabelText("Posición de IVA del período");
    expect(posicion).toHaveTextContent("Saldo a pagar");
    expect(posicion).toHaveTextContent(/1\.000,00/);
    expect(screen.getByRole("button", { name: /Compras \(\.txt\)/ })).toBeEnabled();
  });

  it("si el registro de compras no existe todavía lo dice, no muestra un libro vacío", async () => {
    respuestas.push({ data: [], error: null });
    compras.push({ data: null, error: { code: "PGRST205", message: "zz" } });
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    expect(await screen.findByText("El registro de compras todavía no está activo en tu cuenta.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cargar comprobante de compra/ })).not.toBeInTheDocument();
  });

  it("el Excel para el contador trae ventas, compras y posición", async () => {
    hojas.length = 0;
    respuestas.push({ data: [factura("zz1", { subtotal: 10000, tax_amount: 2100, total: 12100 })], error: null });
    compras.push({ data: [], error: null });
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    // Espera a que compras y retenciones terminen de leerse: un clic antes
    // armaba el archivo sin la posición (falló así en la puerta, 2026-10-23).
    const boton = await screen.findByRole("button", { name: /Excel para tu contador/ });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    await waitFor(() => expect(escribir).toHaveBeenCalled());
    expect(hojas).toEqual(["Ventas", "Compras", "Posición"]);
    expect(escribir.mock.calls[0][1]).toMatch(/^subdiario-iva-\d{4}-\d{2}\.xlsx$/);
  });

  it("si las compras no se pudieron leer, no arma un Excel incompleto", async () => {
    hojas.length = 0;
    escribir.mockClear();
    respuestas.push({ data: [factura("zz1", { subtotal: 10000, tax_amount: 2100, total: 12100 })], error: null });
    compras.push({ data: null, error: { message: "zz" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    const boton = await screen.findByRole("button", { name: /Excel para tu contador/ });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    await waitFor(() => expect(errorAviso).toHaveBeenCalledWith(expect.stringMatching(/no sale incompleto/)));
    expect(escribir).not.toHaveBeenCalled();
  });

  it("una retención de IVA sufrida resta en la posición", async () => {
    respuestas.push({ data: [factura("zz1", { subtotal: 10000, tax_amount: 2100, total: 12100 })], error: null });
    compras.push({ data: [], error: null });
    retenciones.push({ data: [{ id: "r1", fecha: "2026-09-10", impuesto: "iva", agente_cuit: "30712345671", agente_nombre: "ZZ Agente",
      numero_certificado: "0001-1", jurisdiccion: null, importe: 600 }], error: null });
    render(<MemoryRouter><LibroIvaDigital orgId="zz-org" monotributo={false} canEdit /></MemoryRouter>);
    const posicion = await screen.findByLabelText("Posición de IVA del período");
    await waitFor(() => expect(posicion).toHaveTextContent(/1\.500,00/));
    expect(posicion).toHaveTextContent("Retenciones de IVA sufridas");
    expect(screen.getByText("ZZ Agente")).toBeVisible();
  });
});
