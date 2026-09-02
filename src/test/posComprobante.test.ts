import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  POS_WANTS_ARCA_INVOICE_DEFAULT,
  posArcaInvoiceCopy,
  posDebeIntentarAutorizar,
  posFiscalControllerPolicy,
  posParseFacturarResult,
  posReceiptInvoiceCopy,
  posSaleTransactionId,
  posThermalPrintCopy,
} from '@/lib/posComprobante';

const ROOT = resolve(import.meta.dirname, '..', '..');
const POS = readFileSync(resolve(ROOT, 'src/pages/POSPage.tsx'), 'utf8');
const MIGRACION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260901000050_facturar_venta_pos.sql'),
  'utf8',
);

describe('el ticket no es una factura', () => {
  it('facturar en ARCA arranca apagado', () => {
    expect(POS_WANTS_ARCA_INVOICE_DEFAULT).toBe(false);
    expect(posArcaInvoiceCopy().checkboxLabel).toMatch(/ARCA/);
    expect(posArcaInvoiceCopy().notFiscalTicket).toMatch(/no es un comprobante fiscal/i);
  });

  it('la térmica es el diálogo del sistema, no un driver USB', () => {
    expect(posThermalPrintCopy().label).toBe('Ticket 80 mm');
    expect(posThermalPrintCopy().hint).toMatch(/diálogo de impresión/);
  });

  it('la controladora fiscal no se finge', () => {
    expect(posFiscalControllerPolicy().built).toBe(false);
    expect(posFiscalControllerPolicy().reason).toMatch(/otro régimen/);
  });
});

describe('el resultado de facturar no es una unión discriminada', () => {
  it('lee transaction_id del ticket', () => {
    expect(posSaleTransactionId({ transaction_id: 'abc' })).toBe('abc');
    expect(posSaleTransactionId({ sale_ids: ['x'] })).toBeNull();
    expect(posSaleTransactionId(null)).toBeNull();
  });

  it('parsea ok, motivo y CAE como campos opcionales', () => {
    const ok = posParseFacturarResult({
      ok: true, invoice_id: 'inv', number: 'FC-1', tipo: 'C', already: false,
    });
    expect(ok.ok).toBe(true);
    expect(ok.invoiceId).toBe('inv');
    expect(ok.tipo).toBe('C');
    expect(posDebeIntentarAutorizar(ok)).toBe(true);

    const sinIva = posParseFacturarResult({
      ok: false, motivo: 'falta declarar la condicion frente al IVA',
    });
    expect(ok.motivo).toBeUndefined();
    expect(sinIva.ok).toBe(false);
    expect(sinIva.motivo).toMatch(/IVA/);
    expect(posDebeIntentarAutorizar(sinIva)).toBe(false);

    const facturaA = posParseFacturarResult({
      ok: true, invoice_id: 'inv', tipo: 'A', autorizar: false, motivo: 'sin CUIT',
    });
    expect(posDebeIntentarAutorizar(facturaA)).toBe(false);
  });

  it('el recibo distingue CAE, borrador y motivo', () => {
    expect(posReceiptInvoiceCopy({ cae: '123', number: 'FC-1' })?.tone).toBe('ok');
    expect(posReceiptInvoiceCopy({ ok: true, invoiceId: 'inv', number: 'FC-1' })?.tone).toBe('draft');
    expect(posReceiptInvoiceCopy({ motivo: 'sin IVA' })?.tone).toBe('warn');
  });
});

describe('el POS reusa el motor fiscal, no inventa uno', () => {
  it('el RPC es idempotente por ticket y no llama ARCA', () => {
    expect(MIGRACION).toContain('facturar_venta_pos');
    expect(MIGRACION).toContain('sale_transaction_id');
    expect(MIGRACION).toContain('exigir_permiso');
    expect(MIGRACION).toContain("'invoices'");
    expect(MIGRACION).toContain('tipo_de_comprobante');
    const cuerpo = MIGRACION.slice(MIGRACION.indexOf('AS $fn$'), MIGRACION.indexOf('$fn$;'));
    expect(cuerpo).not.toMatch(/FECAESolicitar|wsaa|http_post|net\.http/i);
    expect(cuerpo).not.toContain('afip-authorize');
  });

  it('el mostrador cobra, factura y autoriza por los caminos reales', () => {
    expect(POS).toContain('facturar_venta_pos');
    expect(POS).toContain('afip-authorize');
    expect(POS).toContain('posSaleTransactionId');
    expect(POS).toContain('POS_WANTS_ARCA_INVOICE_DEFAULT');
    expect(POS).toContain('posThermalPrintCopy');
    expect(POS).toContain('size: 80mm auto');
    expect(POS).toContain('posArcaInvoiceCopy');
  });

  it('el cliente no escribe CAE ni abre un puerto de controladora', () => {
    expect(POS).not.toMatch(/from\("invoices"\)[\s\S]{0,200}\.update/);
    expect(POS).not.toMatch(/WebUSB|WebSerial|ESC\/POS|Hasar|Moretti/);
    expect(POS).not.toContain('navigator.usb');
  });
});
