import { describe, expect, it } from 'vitest';
import {
  commerceHandoffPath,
  firstProductEmptyCopy,
  firstProductPath,
  parseActivationHandoff,
  posHandoffPath,
  storeHandoffCopy,
} from '@/lib/activationHandoff';

describe('parseActivationHandoff', () => {
  it('sólo trata de continuación del wizard el query que el wizard escribe', () => {
    expect(parseActivationHandoff(new URLSearchParams('onboarding=1&goal=pos'))).toEqual({
      fromWizard: true,
      goal: 'pos',
    });
    expect(parseActivationHandoff(new URLSearchParams('onboarding=1&goal=online'))).toEqual({
      fromWizard: true,
      goal: 'online',
    });
  });

  it('un goal suelto o un valor inventado no abre el formulario', () => {
    expect(parseActivationHandoff(new URLSearchParams('goal=pos'))).toEqual({
      fromWizard: false,
      goal: 'pos',
    });
    expect(parseActivationHandoff(new URLSearchParams('onboarding=1&goal=explore'))).toEqual({
      fromWizard: true,
      goal: null,
    });
    expect(parseActivationHandoff(new URLSearchParams())).toEqual({
      fromWizard: false,
      goal: null,
    });
  });
});

describe('firstProductPath', () => {
  it('conserva el canal para que Productos sepa qué pedir', () => {
    expect(firstProductPath('pos')).toBe('/productos?onboarding=1&goal=pos');
    expect(firstProductPath('online')).toBe('/productos?onboarding=1&goal=online');
    expect(firstProductPath(null)).toBe('/productos');
  });

  it('después del primer SKU sigue el canal, no el catálogo vacío', () => {
    expect(posHandoffPath()).toBe('/caja?onboarding=1');
    expect(commerceHandoffPath()).toBe('/tienda-online?onboarding=1&goal=online');
  });
});

describe('copy del primer producto', () => {
  it('POS pide stock del mostrador y online no promete una vitrina llena', () => {
    expect(firstProductEmptyCopy('pos').title).toContain('mostrador');
    expect(firstProductEmptyCopy('online').description).toContain('Business Core');
    expect(firstProductEmptyCopy(null).title).toBe('Todavía no hay productos');
  });

  it('la tienda sin catálogo manda a cargar producto, no a publicar vacío', () => {
    expect(storeHandoffCopy().href).toBe('/productos?onboarding=1&goal=online');
  });
});
