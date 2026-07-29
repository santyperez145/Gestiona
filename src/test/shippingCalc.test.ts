import { describe, it, expect } from 'vitest';
import {
  cartWeightKg, resolveZone, pickRateBracket, priceForWeight, applyMarkup,
  quoteShipping, amountToFreeShipping, AR_PROVINCES,
  type ShippingZone, type ShippingRate, type StoreShippingConfig,
} from '@/lib/shippingCalc';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ZONES: ShippingZone[] = [
  { id: 'z-caba', name: 'CABA', provinces: ['AR-C'] },
  { id: 'z-pat', name: 'Patagonia', provinces: ['AR-Q', 'AR-R', 'AR-U', 'AR-Z', 'AR-V'] },
  { id: 'z-off', name: 'Zona apagada', provinces: ['AR-X'], is_active: false },
];

/** Tarifario típico: 0-1kg, 1-5kg, 5kg+ con excedente por kg */
function bracketsFor(zoneId: string, carrier: 'correo_argentino' | 'andreani', base: number): ShippingRate[] {
  return [
    { id: `${zoneId}-${carrier}-a`, zone_id: zoneId, carrier, service: 'domicilio', min_weight_kg: 0, max_weight_kg: 1, price: base, delivery_days_min: 2, delivery_days_max: 4 },
    { id: `${zoneId}-${carrier}-b`, zone_id: zoneId, carrier, service: 'domicilio', min_weight_kg: 1, max_weight_kg: 5, price: base * 1.5, delivery_days_min: 2, delivery_days_max: 4 },
    { id: `${zoneId}-${carrier}-c`, zone_id: zoneId, carrier, service: 'domicilio', min_weight_kg: 5, max_weight_kg: 10, price: base * 2, price_per_extra_kg: 500, delivery_days_min: 3, delivery_days_max: 6 },
  ];
}

const ZONES_MODE: StoreShippingConfig = {
  shipping_mode: 'zones',
  default_item_weight_kg: 0.5,
};

// ── Datos de provincias ─────────────────────────────────────────────────────

describe('AR_PROVINCES', () => {
  it('tiene las 24 jurisdicciones con códigos ISO únicos', () => {
    expect(AR_PROVINCES).toHaveLength(24);
    expect(new Set(AR_PROVINCES.map(p => p.code)).size).toBe(24);
    expect(AR_PROVINCES.every(p => /^AR-[A-Z]$/.test(p.code))).toBe(true);
  });
});

// ── Peso del carrito ────────────────────────────────────────────────────────

describe('cartWeightKg', () => {
  it('multiplica peso por cantidad', () => {
    expect(cartWeightKg([{ qty: 3, weight_kg: 0.25 }])).toBe(0.75);
  });

  it('usa el peso default cuando el producto no lo declara', () => {
    expect(cartWeightKg([{ qty: 2, weight_kg: null }, { qty: 1 }], 0.4)).toBe(1.2);
  });

  it('trata un peso 0 o negativo como no declarado', () => {
    expect(cartWeightKg([{ qty: 1, weight_kg: 0 }], 0.5)).toBe(0.5);
    expect(cartWeightKg([{ qty: 1, weight_kg: -2 }], 0.5)).toBe(0.5);
  });

  it('ignora cantidades negativas en vez de restar peso', () => {
    expect(cartWeightKg([{ qty: -5, weight_kg: 2 }], 0.5)).toBe(0);
  });

  it('un carrito vacío pesa 0', () => {
    expect(cartWeightKg([], 0.5)).toBe(0);
  });
});

// ── Resolución de zona ──────────────────────────────────────────────────────

describe('resolveZone', () => {
  it('encuentra la zona que cubre la provincia', () => {
    expect(resolveZone('AR-R', ZONES)?.name).toBe('Patagonia');
  });

  it('devuelve null para una provincia sin zona', () => {
    expect(resolveZone('AR-S', ZONES)).toBeNull();
  });

  it('ignora zonas desactivadas', () => {
    expect(resolveZone('AR-X', ZONES)).toBeNull();
  });
});

// ── Tramos de peso ──────────────────────────────────────────────────────────

describe('pickRateBracket', () => {
  const rates = bracketsFor('z-caba', 'andreani', 1000);

  it('elige el tramo que contiene el peso', () => {
    expect(pickRateBracket(rates, 0.5)?.price).toBe(1000);
    expect(pickRateBracket(rates, 3)?.price).toBe(1500);
    expect(pickRateBracket(rates, 7)?.price).toBe(2000);
  });

  it('el límite superior es exclusivo — 1kg cae en el tramo de arriba', () => {
    expect(pickRateBracket(rates, 1)?.price).toBe(1500);
  });

  it('por encima de todos los techos usa el tramo más pesado', () => {
    expect(pickRateBracket(rates, 40)?.price).toBe(2000);
  });

  it('respeta un tramo sin techo', () => {
    const open: ShippingRate[] = [
      { id: 'o', zone_id: 'z', carrier: 'propio', service: 'domicilio', min_weight_kg: 0, max_weight_kg: null, price: 800 },
    ];
    expect(pickRateBracket(open, 999)?.price).toBe(800);
  });

  it('ignora tarifas desactivadas', () => {
    const off = rates.map(r => ({ ...r, is_active: false }));
    expect(pickRateBracket(off, 0.5)).toBeNull();
  });

  it('sin tarifas devuelve null', () => {
    expect(pickRateBracket([], 1)).toBeNull();
  });
});

describe('priceForWeight', () => {
  const heavy: ShippingRate = {
    id: 'h', zone_id: 'z', carrier: 'andreani', service: 'domicilio',
    min_weight_kg: 5, max_weight_kg: 10, price: 2000, price_per_extra_kg: 500,
  };

  it('dentro del tramo cobra el precio del tramo', () => {
    expect(priceForWeight(heavy, 8)).toBe(2000);
    expect(priceForWeight(heavy, 10)).toBe(2000);
  });

  it('cobra el excedente por kg o fracción', () => {
    expect(priceForWeight(heavy, 10.1)).toBe(2500);  // 1 kg de fracción
    expect(priceForWeight(heavy, 12)).toBe(3000);    // 2 kg
    expect(priceForWeight(heavy, 12.5)).toBe(3500);  // 3 kg (fracción redondea arriba)
  });

  it('sin techo nunca cobra excedente', () => {
    expect(priceForWeight({ ...heavy, max_weight_kg: null }, 500)).toBe(2000);
  });
});

describe('applyMarkup', () => {
  it('aplica porcentaje y fijo, en ese orden', () => {
    expect(applyMarkup(1000, { carrier: 'andreani', markup_pct: 10, markup_fixed: 200 })).toBe(1300);
  });

  it('sin config no toca el precio', () => {
    expect(applyMarkup(1234.567)).toBe(1234.57);
  });

  it('redondea a 2 decimales', () => {
    expect(applyMarkup(999.99, { carrier: 'oca', markup_pct: 7.5 })).toBe(1074.99);
  });
});

// ── Cotizador completo ──────────────────────────────────────────────────────

describe('quoteShipping — modo plano', () => {
  const store: StoreShippingConfig = { shipping_mode: 'flat', shipping_cost: 1500, free_shipping_above: 50000 };

  it('cobra el precio plano', () => {
    const q = quoteShipping({ subtotal: 10000, items: [{ qty: 1 }], provinceCode: 'AR-C', store });
    expect(q.options).toHaveLength(1);
    expect(q.options[0].price).toBe(1500);
    expect(q.options[0].isFree).toBe(false);
  });

  it('llega al umbral y sale gratis', () => {
    const q = quoteShipping({ subtotal: 50000, items: [{ qty: 1 }], provinceCode: 'AR-C', store });
    expect(q.options[0].price).toBe(0);
    expect(q.options[0].isFree).toBe(true);
    expect(q.options[0].freeReason).toBe('threshold');
  });

  it('un umbral en 0 no significa envío gratis para todos', () => {
    const q = quoteShipping({
      subtotal: 0, items: [{ qty: 1 }], provinceCode: 'AR-C',
      store: { ...store, free_shipping_above: 0 },
    });
    expect(q.options[0].price).toBe(1500);
  });
});

describe('quoteShipping — envío gratis como política', () => {
  it('devuelve una sola opción gratis', () => {
    const q = quoteShipping({
      subtotal: 100, items: [{ qty: 1 }], provinceCode: 'AR-V',
      store: { shipping_mode: 'free' },
    });
    expect(q.options).toHaveLength(1);
    expect(q.options[0].isFree).toBe(true);
    expect(q.options[0].freeReason).toBe('store_policy');
  });
});

describe('quoteShipping — modo zonas', () => {
  const rates = [
    ...bracketsFor('z-caba', 'correo_argentino', 1000),
    ...bracketsFor('z-caba', 'andreani', 1400),
    ...bracketsFor('z-pat', 'andreani', 3000),
  ];

  it('ofrece una opción por transportista, de más barata a más cara', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1, weight_kg: 0.5 }],
      provinceCode: 'AR-C', store: ZONES_MODE, zones: ZONES, rates,
    });
    expect(q.zone?.name).toBe('CABA');
    expect(q.options.map(o => o.carrier)).toEqual(['correo_argentino', 'andreani']);
    expect(q.options.map(o => o.price)).toEqual([1000, 1400]);
  });

  it('cotiza distinto según la zona', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1, weight_kg: 0.5 }],
      provinceCode: 'AR-Z', store: ZONES_MODE, zones: ZONES, rates,
    });
    expect(q.zone?.name).toBe('Patagonia');
    expect(q.options[0].price).toBe(3000);
  });

  it('el peso del carrito mueve el tramo', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 4, weight_kg: 0.5 }],  // 2 kg
      provinceCode: 'AR-C', store: ZONES_MODE, zones: ZONES, rates,
    });
    expect(q.options[0].price).toBe(1500);  // tramo 1-5kg de Correo
  });

  it('aplica el markup del transportista', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1, weight_kg: 0.5 }],
      provinceCode: 'AR-C', store: ZONES_MODE, zones: ZONES, rates,
      carriers: [{ carrier: 'andreani', markup_pct: 10, markup_fixed: 100 }],
    });
    const andreani = q.options.find(o => o.carrier === 'andreani')!;
    expect(andreani.price).toBe(1640);  // 1400 * 1.1 + 100
  });

  it('no ofrece un transportista deshabilitado', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1, weight_kg: 0.5 }],
      provinceCode: 'AR-C', store: ZONES_MODE, zones: ZONES, rates,
      carriers: [{ carrier: 'andreani', is_enabled: false }],
    });
    expect(q.options.map(o => o.carrier)).toEqual(['correo_argentino']);
  });

  it('el umbral de la tarifa pisa el de la tienda', () => {
    const zoneRates: ShippingRate[] = [
      { id: 'r', zone_id: 'z-caba', carrier: 'andreani', service: 'domicilio', min_weight_kg: 0, max_weight_kg: null, price: 1400, free_above: 30000 },
    ];
    const store: StoreShippingConfig = { ...ZONES_MODE, free_shipping_above: 90000 };
    const q = quoteShipping({
      subtotal: 30000, items: [{ qty: 1 }], provinceCode: 'AR-C',
      store, zones: ZONES, rates: zoneRates,
    });
    expect(q.options[0].isFree).toBe(true);
  });

  it('sin zona para la provincia explica por qué no hay envío', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1 }], provinceCode: 'AR-S',
      store: ZONES_MODE, zones: ZONES, rates,
    });
    expect(q.options).toHaveLength(0);
    expect(q.unavailableReason).toMatch(/no hacemos envíos/i);
  });

  it('con zona pero sin tarifas cargadas nombra la zona', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1 }], provinceCode: 'AR-C',
      store: ZONES_MODE, zones: ZONES, rates: [],
    });
    expect(q.options).toHaveLength(0);
    expect(q.unavailableReason).toContain('CABA');
  });

  it('el retiro en tienda va primero y es gratis', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1, weight_kg: 0.5 }], provinceCode: 'AR-C',
      store: { ...ZONES_MODE, pickup_enabled: true }, zones: ZONES, rates,
    });
    expect(q.options[0].carrier).toBe('retiro');
    expect(q.options[0].price).toBe(0);
    expect(q.unavailableReason).toBeNull();
  });

  it('si no hay envío pero sí retiro, lo ofrece y lo aclara', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 1 }], provinceCode: 'AR-S',
      store: { ...ZONES_MODE, pickup_enabled: true }, zones: ZONES, rates,
    });
    expect(q.options.map(o => o.carrier)).toEqual(['retiro']);
    expect(q.unavailableReason).toMatch(/retirar en la tienda/i);
  });

  it('propaga los plazos de entrega del tramo elegido', () => {
    const q = quoteShipping({
      subtotal: 20000, items: [{ qty: 12, weight_kg: 0.5 }],  // 6 kg → tramo 5-10
      provinceCode: 'AR-C', store: ZONES_MODE, zones: ZONES, rates,
    });
    expect(q.options[0].deliveryDaysMin).toBe(3);
    expect(q.options[0].deliveryDaysMax).toBe(6);
  });
});

// ── Cuánto falta para el envío gratis ───────────────────────────────────────

describe('amountToFreeShipping', () => {
  it('devuelve lo que falta', () => {
    expect(amountToFreeShipping(35000, { shipping_mode: 'flat', free_shipping_above: 50000 })).toBe(15000);
  });

  it('null cuando ya llegó', () => {
    expect(amountToFreeShipping(50000, { shipping_mode: 'flat', free_shipping_above: 50000 })).toBeNull();
  });

  it('null cuando no hay umbral', () => {
    expect(amountToFreeShipping(1000, { shipping_mode: 'flat' })).toBeNull();
  });

  it('usa el umbral más bajo de las tarifas de la zona', () => {
    const rates: ShippingRate[] = [
      { id: 'a', zone_id: 'z', carrier: 'andreani', service: 'domicilio', min_weight_kg: 0, max_weight_kg: null, price: 1, free_above: 40000 },
      { id: 'b', zone_id: 'z', carrier: 'correo_argentino', service: 'domicilio', min_weight_kg: 0, max_weight_kg: null, price: 1, free_above: 25000 },
    ];
    expect(amountToFreeShipping(10000, { shipping_mode: 'zones', free_shipping_above: 90000 }, rates)).toBe(15000);
  });
});
