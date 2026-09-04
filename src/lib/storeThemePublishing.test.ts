import { describe, expect, it } from 'vitest';
import {
  applyStoreThemeConfig,
  parseStoreThemeConfig,
  sameStoreThemeConfig,
  storeThemeConfigFromEditor,
  storeThemePreviewPath,
} from './storeThemePublishing';
import { storeDraftInicial } from './storeDraft';
import type { StoreThemeConfig } from './storeThemePublishing';

const config: StoreThemeConfig = {
  theme: 'pastel',
  primary_color: '#AABBCC',
  font: 'inter',
  logo_url: 'https://cdn.test/logo.png',
  banner_url: null,
  storefront_layout: { sections: [{ id: 'featured', enabled: true }] },
};

describe('storeThemePublishing', () => {
  it('construye un snapshot sólo con presentación', () => {
    expect(storeThemeConfigFromEditor('pastel', {
      primary_color: '#aabbcc',
      font: 'inter',
      logo_url: ' https://cdn.test/logo.png ',
      banner_url: '',
      storefront_layout: config.storefront_layout,
    })).toEqual(config);
  });

  it('rechaza configuraciones incompletas y normaliza las válidas', () => {
    expect(parseStoreThemeConfig({ theme: 'minimal' })).toBeNull();
    expect(parseStoreThemeConfig({ ...config, primary_color: 'violeta' })).toBeNull();
    expect(parseStoreThemeConfig({ ...config, primary_color: '#aabbcc' })).toEqual(config);
  });

  it('compara objetos sin depender del orden de sus claves', () => {
    expect(sameStoreThemeConfig(config, {
      ...config,
      storefront_layout: { sections: [{ enabled: true, id: 'featured' }] },
    })).toBe(true);
    expect(sameStoreThemeConfig(config, { ...config, theme: 'minimal' })).toBe(false);
  });

  it('aplica un snapshot sin borrar campos ajenos al diseño', () => {
    const result = applyStoreThemeConfig({
      ...storeDraftInicial(),
      primary_color: '#000000', font: 'sistema', logo_url: '', banner_url: '',
      name: 'La tienda',
    }, config);
    expect(result.name).toBe('La tienda');
    expect(result.primary_color).toBe('#AABBCC');
  });

  it('normaliza una composición histórica antes de montarla en el editor', () => {
    const result = applyStoreThemeConfig(storeDraftInicial(), {
      ...config,
      storefront_layout: {},
    });
    expect(result.storefront_layout.sections.length).toBeGreaterThan(0);
    expect(result.storefront_layout.announcement).toBeDefined();
  });

  it('construye una ruta de preview compartible dentro de la sesión', () => {
    expect(storeThemePreviewPath('mi tienda', 'version/1'))
      .toBe('/tienda/mi%20tienda/vista-previa/version%2F1');
  });
});
