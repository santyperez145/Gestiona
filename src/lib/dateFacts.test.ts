import { describe, expect, it } from 'vitest';
import { daysSinceKnownDate } from './dateFacts';

const reference = new Date('2026-09-05T18:00:00-03:00');

describe('daysSinceKnownDate', () => {
  it('acepta fechas SQL y timestamps ISO sin concatenar formatos', () => {
    expect(daysSinceKnownDate('2026-09-04', reference)).toBe(1);
    expect(daysSinceKnownDate('2026-09-03T18:00:00.000-03:00', reference)).toBe(2);
  });

  it('conserva como desconocidos los datos ausentes o inválidos', () => {
    expect(daysSinceKnownDate(null, reference)).toBeNull();
    expect(daysSinceKnownDate('no-es-una-fecha', reference)).toBeNull();
  });

  it('no presenta días negativos por relojes o ventas futuras', () => {
    expect(daysSinceKnownDate('2026-09-06T18:00:00.000-03:00', reference)).toBe(0);
  });
});
