import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  cotizacionDe, faltaCotizacion, costoUnitarioArs, costoArsONull, SIN_COTIZACION,
} from './exchangeRate';

describe('cotizacionDe', () => {
  it('devuelve la cotización configurada', () => {
    expect(cotizacionDe({ exchange_rate: 1600 })).toBe(1600);
    expect(cotizacionDe({ exchange_rate: '1600' })).toBe(1600);
  });

  it('devuelve null cuando el comercio todavía no cargó ninguna', () => {
    expect(cotizacionDe({ exchange_rate: null })).toBeNull();
    expect(cotizacionDe({})).toBeNull();
    expect(cotizacionDe(null)).toBeNull();
    expect(cotizacionDe(undefined)).toBeNull();
    expect(cotizacionDe({ exchange_rate: '' })).toBeNull();
  });

  it('⚠️ un cero no es una cotización de cero: es que no hay', () => {
    // Convertir con cero haría que todo costo en dólares valga $0 y que el
    // margen dé 100%. Es el mismo error que inventar 1695, con otro número.
    expect(cotizacionDe({ exchange_rate: 0 })).toBeNull();
    expect(cotizacionDe({ exchange_rate: -1600 })).toBeNull();
    expect(cotizacionDe({ exchange_rate: 'no es un número' })).toBeNull();
    expect(cotizacionDe({ exchange_rate: NaN })).toBeNull();
  });

  it('faltaCotizacion es el complemento', () => {
    expect(faltaCotizacion({ exchange_rate: 1600 })).toBe(false);
    expect(faltaCotizacion({ exchange_rate: null })).toBe(true);
  });
});

describe('costoUnitarioArs — espejo de costo_unitario_ars en SQL', () => {
  it('un costo en pesos no pasa por el dólar', () => {
    const r = costoUnitarioArs({ costArs: 7500, costCurrency: 'ARS' }, 1600);
    expect(r.costoArs).toBe(7500);
    expect(r.moneda).toBe('ARS');
    expect(r.tipoCambio).toBeNull();
  });

  it('y sigue sin pasar aunque no haya cotización cargada', () => {
    // Éste es el caso que motivó todo: quien compra en pesos no depende del
    // dólar, así que su costo se conoce igual.
    const r = costoUnitarioArs({ costArs: 7500, costCurrency: 'ARS' }, null);
    expect(r.costoArs).toBe(7500);
    expect(r.motivo).toBeUndefined();
  });

  it('un costo en dólares se convierte a la cotización vigente', () => {
    const r = costoUnitarioArs({ costUsd: 10, costCurrency: 'USD' }, 1600);
    expect(r.costoArs).toBe(16000);
    expect(r.tipoCambio).toBe(1600);
  });

  it('⚠️ sin cotización el costo en dólares es DESCONOCIDO, no cero', () => {
    const r = costoUnitarioArs({ costUsd: 10, costCurrency: 'USD' }, null);
    expect(r.costoArs).toBeNull();
    expect(r.costoUsd).toBe(10);
    expect(r.motivo).toContain('tipo de cambio');
  });

  it('sin moneda declarada, se deduce de dónde está el número', () => {
    expect(costoUnitarioArs({ costArs: 7500 }, 1600).moneda).toBe('ARS');
    expect(costoUnitarioArs({ costUsd: 10 }, 1600).moneda).toBe('USD');
    // Sin ningún costo cargado no hay nada que adivinar: queda en USD y da 0,
    // que acá sí es cero de verdad — no hay costo, no que no se sepa.
    const vacio = costoUnitarioArs({}, 1600);
    expect(vacio.moneda).toBe('USD');
    expect(vacio.costoArs).toBe(0);
  });

  it('la moneda declarada le gana a la deducción', () => {
    // Un producto con los dos números cargados y declarado en dólares se
    // convierte, aunque tenga un cost_ars viejo.
    const r = costoUnitarioArs({ costUsd: 10, costArs: 999, costCurrency: 'USD' }, 1600);
    expect(r.costoArs).toBe(16000);
  });

  it('costoArsONull no disfraza el desconocido de cero', () => {
    expect(costoArsONull({ costUsd: 10 }, null)).toBeNull();
    expect(costoArsONull({ costUsd: 10 }, 1600)).toBe(16000);
  });

  it('redondea medio arriba en valor absoluto, como redondear_moneda', () => {
    expect(costoUnitarioArs({ costUsd: 1, costCurrency: 'USD' }, 1600.005).costoArs).toBe(1600.01);
    expect(costoUnitarioArs({ costArs: -0.005, costCurrency: 'ARS' }, null).costoArs).toBe(-0.01);
  });
});

// ── Guarda ────────────────────────────────────────────────────────────────
//
// Un literal de cotización en el código es un dato de negocio disfrazado de
// constante. Este test es preciso a propósito: busca el número exacto, así que
// no tiene falsos positivos.
describe('el dólar no se escribe a mano en el código', () => {
  const RAIZ = join(process.cwd(), 'src');

  function archivos(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        salida.push(...archivos(ruta));
      } else if (/\.(ts|tsx)$/.test(entrada) && !ruta.includes('types.ts')) {
        salida.push(ruta);
      }
    }
    return salida;
  }

  it('no hay ningún 1695 suelto en src/', () => {
    const culpables: string[] = [];
    for (const ruta of archivos(RAIZ)) {
      // El propio test lo menciona en los comentarios; se salta a sí mismo.
      if (ruta.endsWith('exchangeRate.test.ts') || ruta.endsWith('exchangeRate.ts')) continue;
      const texto = readFileSync(ruta, 'utf8');
      texto.split('\n').forEach((linea, i) => {
        // Los comentarios pueden nombrarlo: explicar de dónde salía el bug es
        // parte del arreglo. Lo que no puede volver es el número en el código.
        const comentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
        if (!comentario && /\b1695\b/.test(linea)) {
          culpables.push(`${ruta.replace(RAIZ, 'src')}:${i + 1}  ${linea.trim().slice(0, 80)}`);
        }
      });
    }
    expect(culpables, [
      'Volvió a aparecer el dólar escrito a mano.',
      'Sin cotización cargada el costo es DESCONOCIDO, no 1695:',
      'usar cotizacionDe() y mostrar SIN_COTIZACION.',
      ...culpables,
    ].join('\n')).toEqual([]);
  });

  it('SIN_COTIZACION es el texto único para ese estado', () => {
    expect(SIN_COTIZACION).toBe('Sin cotización');
  });
});
