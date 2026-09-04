import { describe, expect, it } from 'vitest';
import {
  STORE_VISIT_WINDOW_MS,
  storeVisitAttribution,
  storeVisitToken,
} from '@/lib/storeVisitAttribution';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('atribución first-party de Storefront', () => {
  it('conserva sólo las UTM admitidas y el hostname externo', () => {
    expect(storeVisitAttribution({
      search: '?utm_source=Google&utm_medium=CPC&utm_campaign=Invierno%202026&email=no@guardar.test',
      referrer: 'https://www.google.com/search?q=secreto',
      currentHostname: 'mitienda.nerqia.app',
    })).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'Invierno 2026',
      referrer_host: 'www.google.com',
    });
  });

  it('no atribuye una navegación interna entre hosts de Nerqia', () => {
    expect(storeVisitAttribution({
      search: '',
      referrer: 'https://nerqia.app/tienda-online?token=no-copiar',
      currentHostname: 'exentryimports.nerqia.app',
    }).referrer_host).toBeNull();
  });

  it('no manda URL inválida ni parámetros fuera de UTM', () => {
    expect(storeVisitAttribution({
      search: '?ref=persona&utm_campaign=%00%20',
      referrer: 'no-es-url',
      currentHostname: 'tienda.example',
    })).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      referrer_host: null,
    });
  });

  it('reutiliza 30 minutos y rota después sin mezclarlo con el carrito', () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const createToken = () => `${String(++sequence).padStart(32, 'a')}`;
    const first = storeVisitToken({ storage, slug: 'Mi Tienda', now: 1_000, createToken });
    const same = storeVisitToken({
      storage,
      slug: 'mi tienda',
      now: 1_000 + STORE_VISIT_WINDOW_MS - 1,
      createToken,
    });
    const next = storeVisitToken({
      storage,
      slug: 'mi tienda',
      now: 1_000 + (2 * STORE_VISIT_WINDOW_MS),
      createToken,
    });
    expect(same).toBe(first);
    expect(next).not.toBe(first);
  });
});
