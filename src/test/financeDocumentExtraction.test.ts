import { describe, expect, it } from 'vitest';
import {
  normalizeFinanceExtraction,
  validateFinanceExtraction,
  type FinanceExtractionPayload,
} from '../../supabase/functions/_shared/financeDocumentExtraction';

const field = (value: unknown, confidence = 0.9) => ({ value, confidence });

describe('extracción estructurada de documentos Finance', () => {
  it('normaliza la tool call sin inventar defaults financieros', () => {
    const result = normalizeFinanceExtraction({
      supplier_name: field(' Proveedor SA '),
      supplier_tax_id: field(null, 0),
      document_number: field('A-1'),
      issue_date: field('2026-08-22'),
      currency: field('ars'),
      subtotal: field(200),
      tax_total: field(42),
      total: field(242),
      items: [{
        description: field('Producto'), sku: field(null, 0), quantity: field(2),
        unit_price: field(100), line_total: field(200), tax_rate: field(21),
      }],
    });
    expect(result.payload.supplier_name).toBe('Proveedor SA');
    expect(result.payload.currency).toBe('ARS');
    expect(result.payload.items[0].line_total).toBe(200);
    expect(result.localErrors).toEqual([]);
    expect(result.overallConfidence).toBeLessThan(0.9);
  });

  it('convierte faltantes y números inválidos en revisión, no en ceros optimistas', () => {
    const result = normalizeFinanceExtraction({ items: [] });
    expect(result.payload.currency).toBeNull();
    expect(result.payload.total).toBeNull();
    expect(result.localErrors).toContain('items: se necesita al menos una línea');
    expect(result.overallConfidence).toBe(0);
  });

  it('detecta líneas y totales que no reconcilian', () => {
    const payload: FinanceExtractionPayload = {
      supplier_name: 'Proveedor', supplier_tax_id: null, document_number: '1',
      issue_date: '2026-08-22', currency: 'ARS', subtotal: 300,
      tax_total: 0, total: 250,
      items: [{ description: 'Item', sku: null, quantity: 2, unit_price: 100, line_total: 190, tax_rate: 0 }],
    };
    const errors = validateFinanceExtraction(payload);
    expect(errors).toContain('items[1].line_total: no coincide con cantidad × precio');
    expect(errors).toContain('subtotal: no reconcilia con las líneas');
    expect(errors).toContain('total: menor al subtotal');
  });
});
