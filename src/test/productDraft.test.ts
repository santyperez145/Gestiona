import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  firstProductExpandCopy,
  firstProductFormIsCompact,
  firstProductRequiresAttributes,
  firstProductSubmitLabel,
  productCostWarning,
  validateProductDraft,
} from '@/lib/productDraft';

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

describe('primera ficha compacta', () => {
  it('esconde el resto hasta que el comercio lo pide', () => {
    expect(firstProductFormIsCompact(true, false)).toBe(true);
    expect(firstProductFormIsCompact(true, true)).toBe(false);
    expect(firstProductFormIsCompact(false, false)).toBe(false);
  });

  it('no exige atributos del rubro para poder vender', () => {
    expect(firstProductRequiresAttributes(true)).toBe(false);
    expect(firstProductRequiresAttributes(false)).toBe(true);
  });

  it('el CTA manda al canal elegido', () => {
    expect(firstProductSubmitLabel({ firstUse: true, uploading: false, editing: false, goal: 'pos' }))
      .toBe('Crear y cobrar');
    expect(firstProductSubmitLabel({ firstUse: true, uploading: false, editing: false, goal: 'online' }))
      .toBe('Crear y publicar');
    expect(firstProductSubmitLabel({ firstUse: false, uploading: false, editing: false, goal: 'pos' }))
      .toBe('Crear producto');
    expect(firstProductExpandCopy().label).toMatch(/resto/);
  });

  it('Productos usa la ficha compacta y no bloquea por atributos', () => {
    const products = readFileSync(resolve(__dirname, '../pages/ProductsPage.tsx'), 'utf8');
    expect(products).toContain('firstProductFormIsCompact');
    expect(products).toContain('firstProductRequiresAttributes');
    expect(products).toContain('firstProductSubmitLabel');
    expect(products).toContain('compactFirstProduct');
  });
});
