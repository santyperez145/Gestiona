import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  commerceHandoffPath,
  POS_CLOSED_SHIFT_CART,
  POS_FIRST_SALE_BANNER,
  posCatalogEmptyCopy,
  posCatalogEmptyKind,
  posHandoffPath,
  posProductIsOutOfStock,
  posProductIsSellable,
} from '@/lib/posCatalog';

const ROOT = resolve(import.meta.dirname, '..', '..');
const POS = readFileSync(resolve(ROOT, 'src/pages/POSPage.tsx'), 'utf8');
const PRODUCTS = readFileSync(resolve(ROOT, 'src/pages/ProductsPage.tsx'), 'utf8');

describe('posProductIsSellable', () => {
  it('un servicio con stock 0 se cobra', () => {
    expect(posProductIsSellable({ stock: 0, maneja_stock: false })).toBe(true);
    expect(posProductIsOutOfStock({ stock: 0, maneja_stock: false })).toBe(false);
  });

  it('sin unidades y con descuento de stock no aparece', () => {
    expect(posProductIsSellable({ stock: 0, maneja_stock: true })).toBe(false);
    expect(posProductIsOutOfStock({ stock: 0 })).toBe(true);
  });

  it('stock positivo o stock negativo permitido sí se cobran', () => {
    expect(posProductIsSellable({ stock: 3 })).toBe(true);
    expect(posProductIsSellable({ stock: 0, allow_negative_stock: true })).toBe(true);
  });
});

describe('posCatalogEmptyKind', () => {
  it('distingue catálogo vacío, nada cobrable y filtro', () => {
    expect(posCatalogEmptyKind({
      loading: true, productCount: 0, sellableCount: 0, visibleCount: 0, narrowed: false,
    })).toBe('loading');
    expect(posCatalogEmptyKind({
      loading: false, productCount: 0, sellableCount: 0, visibleCount: 0, narrowed: false,
    })).toBe('none');
    expect(posCatalogEmptyKind({
      loading: false, productCount: 2, sellableCount: 0, visibleCount: 0, narrowed: false,
    })).toBe('no-stock');
    expect(posCatalogEmptyKind({
      loading: false, productCount: 2, sellableCount: 2, visibleCount: 0, narrowed: true,
    })).toBe('filtered');
    expect(posCatalogEmptyKind({
      loading: false, productCount: 2, sellableCount: 2, visibleCount: 1, narrowed: false,
    })).toBeNull();
  });

  it('el vacío de primera venta manda a cargar producto del mostrador', () => {
    expect(posCatalogEmptyCopy('none', 'pos').href).toBe('/productos?onboarding=1&goal=pos');
    expect(posCatalogEmptyCopy('no-stock', null).href).toBe('/productos');
    expect(posCatalogEmptyCopy('filtered', 'pos').href).toBeNull();
  });
});

describe('handoff al mostrador', () => {
  it('el primer producto de POS no se queda en el catálogo', () => {
    expect(posHandoffPath()).toBe('/caja?onboarding=1');
    expect(commerceHandoffPath()).toBe('/tienda-online?onboarding=1&goal=online');
    expect(PRODUCTS).toContain('posHandoffPath');
    expect(PRODUCTS).toContain('commerceHandoffPath');
  });

  it('caja cerrada no se lee como que no se puede cobrar', () => {
    expect(POS_CLOSED_SHIFT_CART).toMatch(/cobrar igual/);
    expect(POS_FIRST_SALE_BANNER.description).toMatch(/turno/);
  });

  it('el POS lee la continuación del wizard y no esconde servicios', () => {
    expect(POS).toContain('parseActivationHandoff');
    expect(POS).toContain('posProductIsSellable');
    expect(POS).toContain('posProductIsOutOfStock');
    expect(POS).toContain('POS_CLOSED_SHIFT_CART');
    expect(POS).toContain('POS_CLOSED_SHIFT_TOPBAR');
    expect(POS).toContain('POS_FIRST_SALE_BANNER');
    expect(POS).not.toContain('Sin resultados');
    expect(POS).not.toContain('las ventas quedarán sin turno');
    expect(POS).not.toContain('vende 2 Lattafa');
  });
});
