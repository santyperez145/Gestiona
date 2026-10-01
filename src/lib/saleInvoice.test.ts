import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { loadAssociatedFiscalInvoice, printFiscalInvoiceById, printFiscalInvoiceTicket } from "./saleInvoice";

describe("factura asociada a nota de crédito", () => {
  beforeEach(() => from.mockReset());

  it("no consulta la base para una factura sin asociación", async () => {
    expect(await loadAssociatedFiscalInvoice({ org_id: "org-1", nota_credito_de: null, tipo_comprobante: 1 })).toBeNull();
    expect(from).not.toHaveBeenCalled();
    await expect(loadAssociatedFiscalInvoice({ org_id: "org-1", nota_credito_de: null, tipo_comprobante: 3 }))
      .rejects.toThrow("no tiene una factura fiscal asociada");
  });

  it("carga la factura original dentro de la misma organización", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          tipo_comprobante: 1,
          punto_venta: 12,
          numero_afip: 345,
          issue_date: "2026-09-29",
          cae: "70417054367476",
        },
        error: null,
      }),
    };
    from.mockReturnValue(query);

    expect(await loadAssociatedFiscalInvoice({ org_id: "org-1", nota_credito_de: "invoice-1", tipo_comprobante: 3 }))
      .toEqual({ title: "FACTURA A", number: "00012-00000345", issueDate: "29/09/2026" });
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", "invoice-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "org_id", "org-1");
  });

  it("rechaza una factura original sin CAE o sin número fiscal", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { tipo_comprobante: 1, punto_venta: 12, numero_afip: null, issue_date: "2026-09-29", cae: null },
        error: null,
      }),
    };
    from.mockReturnValue(query);
    await expect(loadAssociatedFiscalInvoice({ org_id: "org-1", nota_credito_de: "invoice-1", tipo_comprobante: 3 }))
      .rejects.toThrow("comprobante fiscal asociado");
  });

  it("no permite enlazar una NC B a una Factura A", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { tipo_comprobante: 1, punto_venta: 12, numero_afip: 345, issue_date: "2026-09-29", cae: "70417054367476" },
        error: null,
      }),
    };
    from.mockReturnValue(query);
    await expect(loadAssociatedFiscalInvoice({ org_id: "org-1", nota_credito_de: "invoice-1", tipo_comprobante: 8 }))
      .rejects.toThrow("comprobante fiscal asociado");
  });
});

describe("impresión después de una consulta asíncrona", () => {
  beforeEach(() => from.mockReset());

  it("abre la ventana antes de esperar la factura y la cierra si la consulta falla", async () => {
    let resolveQuery!: (value: { data: null; error: { message: string } }) => void;
    const pending = new Promise<{ data: null; error: { message: string } }>((resolve) => {
      resolveQuery = resolve;
    });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(pending),
    };
    from.mockReturnValue(query);
    const popup = { close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const print = printFiscalInvoiceById("invoice-1", "Comercio");
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(query.single).toHaveBeenCalled();
    resolveQuery({ data: null, error: { message: "Sin acceso" } });
    await expect(print).rejects.toThrow("No se pudo cargar la factura");
    expect(popup.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it("genera un ticket borrador real en la ventana ya reservada", async () => {
    vi.useFakeTimers();
    const popup = { location: { href: "" }, close: vi.fn() } as unknown as Window;
    try {
      await printFiscalInvoiceTicket({
        id: "invoice-1",
        number: "F-001",
        customer_name: "Cliente de prueba",
        issue_date: "2026-10-01",
        currency: "ARS",
        subtotal: 100,
        tax_pct: 0,
        tax_amount: 0,
        total: 100,
        tipo_comprobante: 11,
        condicion_iva_receptor: 5,
        cae: null,
        cae_vencimiento: null,
        numero_afip: null,
        invoice_items: [{ description: "Producto de prueba", quantity: 1, unit_price: 100, total: 100 }],
      }, "Comercio de prueba", popup);
      expect(popup.location.href).toMatch(/^blob:/);
      expect(popup.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
