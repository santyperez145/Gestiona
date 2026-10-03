import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260930000200_invoice_transaction_authority.sql");
const saleMigration = read("supabase/migrations/20260930000210_single_sale_invoice_authority.sql");
const manualGuard = read("supabase/migrations/20260930000220_manual_invoice_sale_guard.sql");
const ivaGuard = read("supabase/migrations/20260930000230_invoice_iva_aliquot_guard.sql");
const manualLineTax = read("supabase/migrations/20261002000500_manual_invoice_line_tax.sql");
const page = read("src/pages/InvoicesPage.tsx");

describe("autoridad transaccional de facturación", () => {
  it("crea número, cabecera, renglones y vínculo de venta en una sola RPC", () => {
    expect(migration).toContain("FUNCTION public.crear_factura_manual");
    expect(migration).toContain("public.siguiente_numero_factura(p_org)");
    expect(migration).toContain("INSERT INTO public.invoice_items");
    expect(migration).toContain("UPDATE public.sales SET invoice_id");
    expect(migration).toContain("PERFORM public.exigir_permiso(p_org, 'invoices', 'edit'");
    expect(page).toContain('supabase.rpc("crear_factura_manual"');
    expect(page).not.toContain('.from("invoice_sequences")');
  });

  it("deriva el tipo fiscal desde emisor y receptor y valida el CUIT", () => {
    expect(migration).toContain("public.tipo_de_comprobante(v_emisor, v_receptor)");
    expect(migration).toContain("public.condicion_iva_codigo(v_receptor)");
    expect(migration).toContain("public.cuit_valido(v_customer_tax_digits)");
    expect(page).toContain("Condición IVA del receptor");
    expect(page).toContain("tipoDeComprobante(afipSettings.afip_tipo_emisor");
    expect(page).not.toContain("Tipo de comprobante ARCA");
  });

  it("emite notas de crédito fiscales sin fingir devoluciones de stock o pago", () => {
    expect(migration).toContain("Solo se puede emitir una nota de credito sobre una factura autorizada por ARCA");
    expect(migration).toContain("v_tipo_nc := public.tipo_nota_credito");
    expect(migration).toContain("nota_credito.creada");
    expect(page).toContain('supabase.rpc("emitir_nota_credito"');
    expect(page).toContain("El reintegro del pago y el reingreso de unidades se registran en Devoluciones");
    expect(page).not.toContain("recordMemberStockMovementDB");
    expect(page).not.toContain('payment_method: "devolucion"');
  });

  it("factura una venta por su importe persistido sin volver a sumar IVA", () => {
    expect(saleMigration).toContain("FUNCTION public.facturar_venta_individual");
    expect(saleMigration).toContain("FROM public.sales");
    expect(saleMigration).toContain("public.desglosar_iva(v_total, v_tax_pct, true)");
    expect(saleMigration).toContain("v_sale.total_ars");
    expect(saleMigration).toContain("FOR UPDATE");
    expect(page).toContain('supabase.rpc("facturar_venta_individual"');
    expect(page).toContain('select("product_name, customer_name, quantity, unit_price_ars, total_ars, sale_transaction_id, ecommerce_order_id, invoice_id")');
  });

  it("impide enlazar una venta desde la RPC manual y evita IVA en borradores no fiscales", () => {
    expect(manualGuard).toContain("IF p_sale_id IS NOT NULL THEN");
    expect(manualGuard).toContain("_crear_factura_manual_interna(p_org, p_customer, p_items, p_fiscal, NULL)");
    expect(manualGuard).toContain("jsonb_build_object('tax_pct', 0)");
    expect(manualGuard).toContain("REVOKE ALL ON FUNCTION public._crear_factura_manual_interna");
    expect(page).toContain('!afipConfigured || suggestedVoucher?.letra === "C" ? 0');
  });

  it("limita las alicuotas fiscales en UI y base", () => {
    expect(ivaGuard).toContain("NOT IN (0, 2.5, 5, 10.5, 21, 27)");
    expect(ivaGuard).toContain("CREATE TRIGGER trg_validar_alicuota_factura");
    expect(page).toContain("INVOICE_TAX_RATES.map");
  });

  it("recalcula y persiste la alicuota de cada renglon manual", () => {
    expect(manualLineTax).toContain("v_item->>'tax_rate'");
    expect(manualLineTax).toContain("v_line_tax_amount := public.redondear_moneda");
    expect(manualLineTax).toContain("tax_rate, tax_amount");
    expect(manualLineTax).toContain("PERFORM public.invoice_iva_groups(v_invoice_id)");
    expect(page).toContain('aria-label={`IVA del ítem ${i + 1}`}');
    expect(page).toContain("manualTaxSummary.groups.map");
  });

  it("no confunde una consulta ARCA pendiente o fallida con una desconexion real", () => {
    expect(page).toContain("setAfipSettingsLoading(true)");
    expect(page).toContain("setAfipSettingsError(true)");
    expect(page).toContain("afipSettingsOrgId === afipOrgId");
    expect(page).toContain("if (!afipSettingsReady)");
    expect(page).toContain("La creación de facturas está detenida");
  });
});
