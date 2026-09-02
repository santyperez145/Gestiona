import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  posPaymentAlreadyCollected,
  posPayMethodCaution,
  posReceiptCopy,
  posShouldAutoPromptSeller,
  posVisiblePayMethods,
  posFirstTicketPayCopy,
  posShowAllPayMethods,
  salesListEmptyCopy,
  salesListEmptyKind,
  ticketSalesPath,
} from '@/lib/posFirstTicket';

const ROOT = resolve(import.meta.dirname, '..', '..');
const POS = readFileSync(resolve(ROOT, 'src/pages/POSPage.tsx'), 'utf8');
const SALES = readFileSync(resolve(ROOT, 'src/pages/SalesPage.tsx'), 'utf8');

describe('posShouldAutoPromptSeller', () => {
  it('el wizard no tapa el mostrador con el nombre del vendedor', () => {
    expect(posShouldAutoPromptSeller(true, '')).toBe(false);
    expect(posShouldAutoPromptSeller(false, '')).toBe(true);
    expect(posShouldAutoPromptSeller(false, 'Ana')).toBe(false);
  });
});

describe('posPaymentAlreadyCollected', () => {
  it('efectivo y transferencia ya están cobrados; fiado no', () => {
    expect(posPaymentAlreadyCollected({ payMethod: 'efectivo', splitMode: false })).toBe(true);
    expect(posPaymentAlreadyCollected({ payMethod: 'transferencia', splitMode: false })).toBe(true);
    expect(posPaymentAlreadyCollected({ payMethod: 'fiado', splitMode: false })).toBe(false);
    expect(posPaymentAlreadyCollected({
      payMethod: 'efectivo', splitMode: true, splitMethod1: 'efectivo', splitMethod2: 'fiado',
    })).toBe(false);
  });
});

describe('recibo y lista', () => {
  it('el recibo cobrado no promete otro cobro', () => {
    expect(posReceiptCopy(true).title).toBe('Venta cobrada');
    expect(posReceiptCopy(false).title).toBe('Venta a cuenta');
    expect(ticketSalesPath('abc')).toBe('/ventas?sale=abc');
  });

  it('Ventas vacío manda al POS, no a un formulario paralelo', () => {
    expect(salesListEmptyKind({ saleCount: 0, filteredCount: 0 })).toBe('none');
    expect(salesListEmptyKind({ saleCount: 4, filteredCount: 0 })).toBe('filtered');
    expect(salesListEmptyCopy('none').href).toBe('/caja?onboarding=1');
    expect(salesListEmptyCopy('none').actionLabel).toMatch(/POS/);
  });
});

describe('el código usa las reglas', () => {
  it('el POS no abre el vendedor encima del primer producto', () => {
    expect(POS).toContain('posShouldAutoPromptSeller');
    expect(POS).toContain('posPaymentAlreadyCollected');
    expect(POS).toContain('posReceiptCopy');
    expect(POS).toContain('ticketSalesPath');
    expect(POS).toContain('posVisiblePayMethods');
    expect(POS).toContain('posFirstTicketPayCopy');
    expect(POS).toContain('posIsFirstTicketMethod');
  });

  it('Ventas vacío no abre SaleForm como primera acción', () => {
    expect(SALES).toContain('salesListEmptyCopy');
    expect(SALES).toContain('salesListEmptyKind');
    expect(SALES).not.toMatch(/!filtered\.length \? \([\s\S]{0,400}setOpen\(true\)/);
  });
});

describe('primera visita: efectivo y transferencia al frente', () => {
  const methods = [
    { value: 'efectivo' },
    { value: 'transferencia' },
    { value: 'debito' },
    { value: 'qr' },
    { value: 'mayorista' },
    { value: 'fiado' },
  ];
  const first = { firstTicket: true, expanded: false, payMethod: 'efectivo', splitMode: false, allowQr: true };

  it('esconde QR, fiado y mayorista hasta que pidan más medios', () => {
    expect(posVisiblePayMethods(methods, first).map((m) => m.value)).toEqual(['efectivo', 'transferencia']);
    expect(posShowAllPayMethods({ firstTicket: true, expanded: false, payMethod: 'efectivo', splitMode: false })).toBe(false);
    expect(posVisiblePayMethods(methods, { ...first, expanded: true }).map((m) => m.value)).toContain('fiado');
    expect(posVisiblePayMethods(methods, { ...first, firstTicket: false }).map((m) => m.value)).toHaveLength(6);
  });

  it('fiado avisa que no cobra', () => {
    expect(posPayMethodCaution('fiado')).toMatch(/no cobra/);
    expect(posPayMethodCaution('efectivo')).toBeNull();
    expect(posFirstTicketPayCopy().expandLabel).toMatch(/Más medios/);
  });
});
