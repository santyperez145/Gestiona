import { describe, expect, it } from 'vitest';
import { businessDate, businessDateInRange } from '@/lib/dateRange';

describe('rango civil de fechas de negocio', () => {
  it('no desplaza una columna date al día anterior por UTC', () => {
    const parsed = businessDate('2026-09-06');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(6);
  });

  it('incluye completos los dos días límite', () => {
    const from = new Date('2026-09-01T00:00:00');
    const to = new Date('2026-09-06T00:00:00');
    expect(businessDateInRange('2026-09-01', from, to)).toBe(true);
    expect(businessDateInRange('2026-09-06T23:59:59.999', from, to)).toBe(true);
  });

  it('excluye ambos lados del período', () => {
    const from = new Date('2026-09-02T00:00:00');
    const to = new Date('2026-09-05T00:00:00');
    expect(businessDateInRange('2026-09-01', from, to)).toBe(false);
    expect(businessDateInRange('2026-09-06', from, to)).toBe(false);
  });

  it('no deja entrar fechas inválidas cuando existe un filtro', () => {
    expect(businessDateInRange('fecha-rota', new Date('2026-09-01'))).toBe(false);
    expect(businessDateInRange(null, undefined, new Date('2026-09-06'))).toBe(false);
  });

  it('sin filtro no altera el conjunto original', () => {
    expect(businessDateInRange('2020-01-01')).toBe(true);
    expect(businessDateInRange(null)).toBe(true);
  });
});
