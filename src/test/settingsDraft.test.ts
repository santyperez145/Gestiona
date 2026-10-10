import { afterEach, describe, expect, it } from 'vitest';
import {
  SECCION_DE_CAMPO,
  borrarBorrador,
  camposCambiados,
  claveBorrador,
  guardarBorrador,
  leerBorrador,
  seccionesConCambios,
  soloCambios,
} from '@/lib/settingsDraft';

describe('qué cambió en Ajustes', () => {
  const base = {
    business_name: 'Kiosco',
    exchange_rate: null,
    category_pricing: { remeras: { markup: 50, discount: 10 } },
    brand_palettes: [{ id: '1', name: 'Mar' }],
    tax_enabled: false,
  };

  it('sin base todavía —la página está cargando— no hay cambios', () => {
    expect(camposCambiados(null, { business_name: 'x' })).toEqual([]);
  });

  it('lo mismo que está guardado no es un cambio', () => {
    expect(camposCambiados(base, { ...base })).toEqual([]);
  });

  it('el orden de las claves de un objeto no es un cambio', () => {
    // Releer `category_pricing` de la base puede devolver las claves en otro
    // orden: si contara, la barra aparecería sin que nadie toque nada.
    const releido = { ...base, category_pricing: { remeras: { discount: 10, markup: 50 } } };
    expect(camposCambiados(base, releido)).toEqual([]);
  });

  it('undefined y null son el mismo «sin valor»', () => {
    expect(camposCambiados(base, { ...base, exchange_rate: undefined })).toEqual([]);
  });

  it('detecta cambios de texto, booleanos, objetos y listas', () => {
    const actual = {
      ...base,
      business_name: 'Kiosco Centro',
      tax_enabled: true,
      category_pricing: { remeras: { markup: 60, discount: 10 } },
      brand_palettes: [],
    };
    expect(camposCambiados(base, actual)).toEqual([
      'brand_palettes', 'business_name', 'category_pricing', 'tax_enabled',
    ]);
  });

  it('un campo nuevo que la base no tenía también cuenta', () => {
    expect(camposCambiados(base, { ...base, costo_por_pedido: 1500 })).toEqual(['costo_por_pedido']);
  });

  it('agrupa por pestaña sin repetir', () => {
    expect(seccionesConCambios(['business_name', 'logo_url', 'tax_iva_percent', 'ai_tone']))
      .toEqual(['brand', 'billing', 'inventory']);
  });

  it('soloCambios arma el update chico', () => {
    expect(soloCambios({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('los ajustes huérfanos que consume el sistema tienen pestaña', () => {
    // run_abc_analysis (lote óptimo), el checkout fiscal y el recomendador de
    // ofertas los leen. Hasta 2026-10-09 ninguna pantalla los dejaba cargar.
    for (const campo of [
      'costo_por_pedido', 'costo_almacenamiento_anual_pct', 'fiscal_id_required_above',
      'stock_dormido_days', 'max_overstock_units', 'max_ai_discount_percent', 'ai_tone',
    ]) {
      expect(SECCION_DE_CAMPO[campo], campo).toBeDefined();
    }
  });
});

describe('el borrador sobrevive a navegar por el menú', () => {
  const clave = claveBorrador('org-1');
  afterEach(() => borrarBorrador(clave));

  it('sin organización no hay clave', () => {
    expect(claveBorrador(null)).toBeNull();
    expect(leerBorrador(null)).toBeNull();
  });

  it('guarda, lee y borra', () => {
    guardarBorrador(clave, { business_name: 'Nuevo' });
    expect(leerBorrador(clave)).toEqual({ business_name: 'Nuevo' });
    borrarBorrador(clave);
    expect(leerBorrador(clave)).toBeNull();
  });

  it('un valor corrupto no rompe la página', () => {
    window.sessionStorage.setItem(clave!, '{no es json');
    expect(leerBorrador(clave)).toBeNull();
    window.sessionStorage.setItem(clave!, '[1,2]');
    expect(leerBorrador(clave)).toBeNull();
  });
});
