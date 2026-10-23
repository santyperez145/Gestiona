import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrdenDePagoDialog from "@/components/proveedores/OrdenDePagoDialog";
import { avisoDeRetencion, erroresDeOrden, leerMonto, medioDeRetencion, medioVacio, ordenDePagoHtml, ordenParaEnviar, totales, type ImputacionForm } from "@/lib/ordenDePago";
import { etiquetaDeEstado } from "@/lib/cheques";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.order = () => Promise.resolve({ data: [{ id: "ch-1", check_number: "111", bank_name: "ZZ Banco", amount_ars: 800, due_date: "2026-11-10", customer_name: "ZZ Cliente" }], error: null });
  return { supabase: { from: () => q, rpc } };
});
vi.mock("@/hooks/useEmisorDelRemito", () => ({ useEmisorDelRemito: () => ({ nombre: "ZZ Comercio", cuit: "20123456786" }) }));

const imps: ImputacionForm[] = [
  { deudaId: "d1", descripcion: "Factura 1", saldo: 1000, importe: "1000" },
  { deudaId: "d2", descripcion: "Factura 2", saldo: 2000, importe: "1.500,00" },
];

describe("Orden de pago: las cuentas", () => {
  it("suma lo que se paga y con qué, y exige que coincidan", () => {
    expect(leerMonto("1.500,00")).toBe(1500);
    const medios = [medioVacio("efectivo", "200"), { ...medioVacio("cheque_tercero", "800"), chequeId: "ch-1" }, { ...medioVacio("cheque_propio", "1500"), numero: "0001", vencimiento: "2026-11-30" }];
    expect(totales(imps, medios)).toEqual({ imputado: 2500, pagado: 2500, diferencia: 0 });
    expect(erroresDeOrden(imps, medios, [{ id: "ch-1", amount_ars: 800 }])).toEqual([]);
    const faltante = erroresDeOrden(imps, [medioVacio("efectivo", "2000")]);
    expect(faltante).toHaveLength(1);
    expect(faltante[0]).toMatch(/^Falta asignar \$\s500,00 a algún medio de pago\.$/);
    expect(erroresDeOrden([{ ...imps[0], importe: "1200" }], [medioVacio("efectivo", "1200")])[0]).toMatch(/no superar el saldo/);
    expect(erroresDeOrden(imps, [{ ...medioVacio("cheque_tercero", "2500"), chequeId: "ch-1" }], [{ id: "ch-1", amount_ars: 800 }])).toContain("Un cheque de terceros se entrega por su importe completo.");
    expect(erroresDeOrden(imps, [medioVacio("retencion", "2500")])).toContain("La retención necesita el número de certificado.");
  });

  it("arma el pedido de la base y el comprobante con original y duplicado", () => {
    const pedido = ordenParaEnviar({ supplierId: "s1", clave: "clave-123456", notas: "", imputaciones: imps,
      medios: [{ ...medioVacio("cheque_propio", "2500"), banco: "ZZ", numero: "9", vencimiento: "2026-11-30" }] });
    expect(pedido).toEqual({ supplier_id: "s1", idempotency_key: "clave-123456", notas: null,
      imputaciones: [{ deuda_id: "d1", importe: 1000 }, { deuda_id: "d2", importe: 1500 }],
      medios: [{ medio: "cheque_propio", importe: 2500, banco: "ZZ", numero: "9", vencimiento: "2026-11-30" }] });
    const html = ordenDePagoHtml({ numero: 7, fecha: "2026-10-22", proveedor: "ZZ <Distribuidora>", proveedorCuit: null, total: 2500, notas: null,
      imputaciones: [{ descripcion: "Factura 1", importe: 1000 }], medios: [{ medio: "efectivo", importe: 2500, referencia: null }] }, { nombre: "ZZ Comercio" });
    expect(html).toContain("ORDEN DE PAGO");
    expect(html).toContain("N.º 00000007");
    expect(html).toContain("ZZ &lt;Distribuidora&gt;");
    expect(html.match(/class="copia"/g)).toHaveLength(2);
  });

  it("el cheque entregado se nombra en la cartera", () => {
    expect(etiquetaDeEstado("received", "endorsed")).toBe("Entregado a proveedor");
  });
});

describe("Orden de pago: el diálogo", () => {
  beforeEach(() => rpc.mockReset());

  it("propone pagar los saldos por transferencia y emite con una clave de idempotencia", async () => {
    rpc.mockResolvedValue({ data: { ok: true, numero: 1, total: 3000 }, error: null });
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    render(<OrdenDePagoDialog open onOpenChange={() => {}} orgId="zz-org" proveedor={{ id: "s1", nombre: "ZZ Distribuidora" }}
      deudas={[{ id: "d1", description: "Factura 1", remaining_ars: 1000 }, { id: "d2", description: "Factura 2", remaining_ars: 2000 }]} onEmitida={() => {}} />);
    expect(screen.getByLabelText("Importe a pagar de Factura 2")).toHaveValue("2000");
    expect(screen.getByLabelText("Importe")).toHaveValue("3000");
    fireEvent.click(screen.getByRole("button", { name: "Emitir e imprimir" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("emitir_orden_de_pago", expect.objectContaining({
      p_org: "zz-org", p_datos: expect.objectContaining({ supplier_id: "s1", idempotency_key: expect.any(String), medios: [{ medio: "transferencia", importe: 3000 }] }),
    })));
    abrir.mockRestore();
  });

  it("la retención automática no pide certificado: la numera la base, y se imprime con la orden", () => {
    const ret = medioDeRetencion({ aplica: true, jurisdiccion: "ARBA", base: 10000, alicuota: 2.5, importe: 250, origen: "padron" });
    const unaDeuda = [{ deudaId: "d1", descripcion: "Factura 1", saldo: 12100, importe: "12100" }];
    expect(erroresDeOrden(unaDeuda, [ret, medioVacio("transferencia", "11850")])).toEqual([]);
    expect(ordenParaEnviar({ supplierId: "s1", clave: "clave-123456", notas: "", imputaciones: unaDeuda, medios: [ret] }).medios)
      .toEqual([{ medio: "retencion", importe: 250, automatica: true, base: 10000 }]);
    const html = ordenDePagoHtml({ numero: 7, fecha: "2026-10-22", proveedor: "ZZ Distribuidora", proveedorCuit: "30712345671", total: 12100, notas: null,
      imputaciones: [{ descripcion: "Factura 1", importe: 12100 }], medios: [{ medio: "retencion", importe: 250, referencia: "Certificado IIBB AGIP N.º 00000003" }],
      retenciones: [{ jurisdiccion: "AGIP", certificado: 3, base: 10000, alicuota: 2.5, importe: 250 }] }, { nombre: "ZZ Comercio", cuit: "20123456786" } as never);
    expect(html).toContain("CERTIFICADO DE RETENCIÓN");
    expect(html).toContain("IIBB AGIP N.º 00000003");
    expect(html.match(/CERTIFICADO DE RETENCIÓN/g)).toHaveLength(2);
    // En ARBA el comprobante es el A-122R: la hoja de Nerqia no se presenta como certificado.
    const arba = ordenDePagoHtml({ numero: 8, fecha: "2026-10-22", proveedor: "ZZ", proveedorCuit: "30712345671", total: 100, notas: null,
      imputaciones: [{ descripcion: "F", importe: 100 }], medios: [{ medio: "retencion", importe: 2, referencia: null }],
      retenciones: [{ jurisdiccion: "ARBA", certificado: 4, base: 100, alicuota: 2, importe: 2 }] }, { nombre: "ZZ Comercio" } as never);
    expect(arba).not.toContain("CERTIFICADO DE RETENCIÓN");
    expect(arba).toContain("DETALLE DE RETENCIÓN");
    expect(arba).toContain("A-122R");
    expect(avisoDeRetencion({ aplica: false, motivo: "sin_cuit" })).toMatch(/no tiene CUIT/);
    expect(avisoDeRetencion({ aplica: false, motivo: "no_agente" })).toBeNull();
  });

  it("si el comercio es agente, propone la retención y descuenta el resto de la transferencia", async () => {
    rpc.mockReset();
    rpc.mockImplementation((nombre: string) => Promise.resolve(nombre === "retencion_para_proveedor"
      ? { data: { aplica: true, jurisdiccion: "ARBA", base: 3000, alicuota: 2.5, importe: 75, origen: "padron" }, error: null }
      : { data: { ok: true, numero: 2, total: 3000, retenciones: [{ jurisdiccion: "ARBA", certificado: 1, base: 3000, alicuota: 2.5, importe: 75 }] }, error: null }));
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    render(<OrdenDePagoDialog open onOpenChange={() => {}} orgId="zz-org" proveedor={{ id: "s1", nombre: "ZZ Distribuidora", cuit: "30712345671" }}
      deudas={[{ id: "d1", description: "Factura 1", remaining_ars: 1000 }, { id: "d2", description: "Factura 2", remaining_ars: 2000 }]} onEmitida={() => {}} />);
    await waitFor(() => expect(screen.getByText(/certificado al emitir/)).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith("retencion_para_proveedor", { p_org: "zz-org", p_supplier: "s1", p_base: 3000 });
    expect(screen.getByLabelText("Importe")).toHaveValue("2925");
    fireEvent.click(screen.getByRole("button", { name: "Emitir e imprimir" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("emitir_orden_de_pago", expect.objectContaining({
      p_datos: expect.objectContaining({ medios: [{ medio: "retencion", importe: 75, automatica: true, base: 3000 }, { medio: "transferencia", importe: 2925 }] }),
    })));
    abrir.mockRestore();
  });

  it("la retención la recalcula la base y numera el certificado por jurisdicción", () => {
    const sql = readFileSync("supabase/migrations/20261022001600_retencion_iibb_orden_de_pago.sql", "utf8");
    expect(sql).toContain("v_calc := public.retencion_iibb_calculada(p_org, v_supplier.cuit, v_ret_base, v_fecha);");
    expect(sql).toContain("IF (v_calc->>'importe')::numeric <> v_importe THEN");
    expect(sql).toContain("Una orden lleva una sola retencion automatica");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.retencion_iibb_calculada(uuid, text, numeric, date) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("ON public.withholding_records (org_id, withholding_type, jurisdiccion, certificado_numero)");
    // La retención manual con su certificado sigue igual que en 20261022001400.
    expect(sql).toContain("ELSIF v_medio = 'retencion' AND btrim(COALESCE(v_med->>'referencia', '')) = '' THEN");
    // La versión nueva conserva todo lo de la anterior.
    const anterior = readFileSync("supabase/migrations/20261022001400_orden_de_pago.sql", "utf8");
    for (const frase of ["Los medios de pago suman % y lo que se paga suma %: tienen que coincidir", "Un cheque de terceros se entrega por su importe completo",
      "pg_advisory_xact_lock(hashtextextended('orden_de_pago:' || p_org::text, 0))", "Una de las deudas no es de este proveedor"]) {
      expect(anterior).toContain(frase);
      expect(sql).toContain(frase);
    }
  });

  it("la base valida todo en una transacción y el cheque de terceros sólo sale con la orden", () => {
    const sql = readFileSync("supabase/migrations/20261022001400_orden_de_pago.sql", "utf8");
    expect(sql).toContain("Los medios de pago suman % y lo que se paga suma %: tienen que coincidir");
    expect(sql).toContain("OR (NEW.status = 'endorsed' AND NEW.orden_de_pago_id IS NOT NULL)");
    expect(sql).toContain("CONSTRAINT ordenes_de_pago_idempotencia UNIQUE (org_id, idempotency_key)");
  });
});
