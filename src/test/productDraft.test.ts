import { describe, expect, it } from 'vitest';
import { productCostWarning, validateProductDraft } from '@/lib/productDraft';

const base = {
  name: 'Remera negra',
  salePrice: 15000,
  resolvedCost: 0,
  manejaStock: true,
  stockRaw: '4',
  firstUse: true,
};

describe('validateProductDraft', () => {
  it('deja pasar un producto vendible sin costo', () => {
    expect(validateProductDraft(base)).toEqual({ ok: true });
    expect(productCostWarning(0)).toMatch(/margen/);
    expect(productCostWarning(800)).toBeNull();
  });

  it('exige precio de venta, no costo', () => {
    expect(validateProductDraft({ ...base, salePrice: 0 }).ok).toBe(false);
    expect(validateProductDraft({ ...base, resolvedCost: 0 }).ok).toBe(true);
  });

  it('en la primera ficha no acepta stock 0 si el producto se descuenta', () => {
    const result = validateProductDraft({ ...base, stockRaw: '0' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unidades/);
  });

  it('un servicio no pide unidades', () => {
    expect(validateProductDraft({
      ...base,
      manejaStock: false,
      stockRaw: '',
    })).toEqual({ ok: true });
  });

  it('stock vacío no se disfraza de cero', () => {
    const result = validateProductDraft({ ...base, firstUse: false, stockRaw: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unidades/);
  });

  it('después de la primera ficha, cero es una decisión explícita', () => {
    expect(validateProductDraft({ ...base, firstUse: false, stockRaw: '0' })).toEqual({ ok: true });
  });
});
