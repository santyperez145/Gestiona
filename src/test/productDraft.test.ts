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
      .toBe('Guardar y seguir');
    expect(firstProductSubmitLabel({ firstUse: false, uploading: false, editing: false, goal: 'pos' }))
      .toBe('Crear producto');
    expect(firstProductExpandCopy().label).toMatch(/resto/);
  });

  it('el botón online no promete una tienda publicada', () => {
    // 2026-11-03: después del primer producto todavía faltan pasos de la tienda.
    const label = firstProductSubmitLabel({ firstUse: true, uploading: false, editing: false, goal: 'online' });
    expect(label).not.toMatch(/publica/i);
  });

  it('la ayuda para expandir habla del canal elegido', () => {
    const online = firstProductExpandCopy('online');
    expect(online.label).toBe('Sumar foto, marca y el resto');
    expect(online.hint).toBe('Una foto ayuda a vender; se puede sumar después.');
    expect(online.hint).not.toMatch(/mostrador/);
    expect(firstProductExpandCopy('pos').hint).toMatch(/mostrador/);
    expect(firstProductExpandCopy(null).label).toBe('Cargar foto, marca y el resto');
  });

  it('la ficha compacta no repite tres veces lo obligatorio y el precio se lee en pesos', () => {
    const products = readFileSync(resolve(__dirname, '../pages/ProductsPage.tsx'), 'utf8');
    expect(products).toContain('firstProductExpandCopy(handoffGoal)');
    expect(products).not.toContain('Para cobrar hace falta esto');
    expect(products).not.toContain('Nombre, precio de venta y unidades. El costo puede esperar.');
    expect(products).toContain('El costo y la foto pueden esperar.');
    expect(products).toContain('placeholder="Ej: 12500"');
  });

  it('Productos usa la ficha compacta y no bloquea por atributos', () => {
    const products = readFileSync(resolve(__dirname, '../pages/ProductsPage.tsx'), 'utf8');
    expect(products).toContain('firstProductFormIsCompact');
    expect(products).toContain('firstProductRequiresAttributes');
    expect(products).toContain('firstProductSubmitLabel');
    expect(products).toContain('compactFirstProduct');
    // P0.1.3: la ficha compacta no muestra el select, pero igual tipa al crear.
    expect(products).toContain('defaultProductTypeId');
  });
});
