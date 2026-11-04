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
    expect(posReceiptCopy(true, { first: false }).title).toBe('Venta cobrada');
    expect(posReceiptCopy(false).title).toBe('Venta a cuenta');
    expect(ticketSalesPath('abc')).toBe('/ventas?sale=abc');
  });

  it('el recibo no habla del turno sin explicarlo (2026-11-03)', () => {
    expect(posReceiptCopy(true).description).not.toMatch(/turno/i);
    expect(posReceiptCopy(true).description).toBe('Quedó guardada en Ventas.');
  });

  it('la primera venta se festeja', () => {
    expect(posReceiptCopy(true, { first: true }).title).toBe('¡Primera venta hecha!');
    // Fiado no es una venta cobrada: no se festeja como tal.
    expect(posReceiptCopy(false, { first: true }).title).toBe('Venta a cuenta');
  });

  it('sin conexión no promete que ya está en Ventas', () => {
    const offline = posReceiptCopy(true, { offline: true });
    expect(offline.description).toMatch(/este dispositivo/);
    expect(offline.description).toMatch(/cuando vuelva la conexión/);
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

describe('primera visita: efectivo, transferencia y débito al frente', () => {
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
    // 2026-11-03: débito estaba escondido; un local con posnet cobra con tarjeta desde el primer día.
    expect(posVisiblePayMethods(methods, first).map((m) => m.value)).toEqual(['efectivo', 'transferencia', 'debito']);
    expect(posShowAllPayMethods({ firstTicket: true, expanded: false, payMethod: 'efectivo', splitMode: false })).toBe(false);
    expect(posVisiblePayMethods(methods, { ...first, expanded: true }).map((m) => m.value)).toContain('fiado');
    expect(posVisiblePayMethods(methods, { ...first, firstTicket: false }).map((m) => m.value)).toHaveLength(6);
  });

  it('fiado avisa que no cobra', () => {
    expect(posPayMethodCaution('fiado')).toMatch(/no cobra/);
    expect(posPayMethodCaution('efectivo')).toBeNull();
    expect(posFirstTicketPayCopy().expandLabel).toMatch(/Más medios/);
    expect(posFirstTicketPayCopy().hint).toMatch(/débito/);
    expect(posFirstTicketPayCopy().collapseLabel).toMatch(/débito/);
  });
});

describe('la caja se puede usar sin mirar el color ni scrollear (2026-11-03)', () => {
  it('los medios de pago son un grupo y dicen cuál está elegido', () => {
    expect(POS).toContain('role="group" aria-label={label}');
    expect(POS).toContain('label = "Medio de pago"');
    expect(POS).toContain('aria-pressed={active}');
    expect(POS).toContain('aria-pressed={splitMode}');
  });

  it('cada botón de ícono del carrito tiene nombre', () => {
    expect(POS).toContain('aria-label={`Quitar ${it.name} del carrito`}');
    expect(POS).toContain('aria-label={`Restar una unidad de ${it.name}`}');
    expect(POS).toContain('aria-label={`Sumar una unidad de ${it.name}`}');
    expect(POS).toContain('aria-label="Aplicar precio"');
    expect(POS).toContain('aria-label="Cancelar cambio de precio"');
    expect(POS).toContain('aria-label={`Quitar cupón ${couponResult.coupon.code}`}');
  });

  it('el primer ticket agrupa lo raro en «Más opciones» y fuera del asistente queda a la vista', () => {
    expect(POS).toMatch(/fromWizard \? \(\s*<details/);
    expect(POS).toContain('Más opciones');
    expect(POS).toContain('Factura ARCA activada');
    expect(POS).toContain('autoPrintTicket ? "Imprime al cerrar" : null');
    expect(POS).toMatch(/\{!fromWizard \? \(\s*<>\s*\{arcaToggle\}\s*\{printToggle\}/);
    expect(POS).toMatch(/\{!fromWizard \? noteField : null\}/);
  });

  it('con una sola sucursal no aparece el selector', () => {
    expect(POS).toContain('locations.length > 1 ? (');
  });

  it('cerrar el primer recibo saca al mostrador del asistente', () => {
    expect(POS).toContain('n.delete("onboarding")');
    expect(POS).toContain('onNewSale={() => { setReceipt(null); clearCart(); salirDelAsistente(); }}');
    // Con ventas previas (del turno o de los últimos 90 días) no es la primera.
    expect(POS).toContain('firstSale={fromWizard && turnoSales.length <= 1 && recSales.length === 0}');
    expect(POS).toContain('<Link to="/" replace onClick={onClose}>Volver al panel</Link>');
    expect(POS).toContain('Volver al panel');
  });

  it('«Devolver» no grita antes de la primera venta y «Guardar» no usa su ícono', () => {
    expect(POS).toContain('{!ocultarDevolver && (');
    expect(POS).not.toContain('border-orange-500/40 text-orange-400');
    expect(POS).toContain('<Bookmark className="w-3 h-3" aria-hidden="true" />Guardar');
  });
});
