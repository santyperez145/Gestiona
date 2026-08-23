import { describe, expect, it } from 'vitest';

import { getPaginationRange } from '@/lib/dataPagination';

describe('rango de paginación canónico', () => {
  it('calcula la primera página', () => {
    expect(getPaginationRange(0, 20, 53)).toEqual({ page: 0, from: 1, to: 20, total: 53 });
  });

  it('recorta la última página al total real', () => {
    expect(getPaginationRange(2, 20, 53)).toEqual({ page: 2, from: 41, to: 53, total: 53 });
  });

  it('declara cero sin inventar un primer registro', () => {
    expect(getPaginationRange(0, 20, 0)).toEqual({ page: 0, from: 0, to: 0, total: 0 });
  });

  it('normaliza páginas fuera de rango', () => {
    expect(getPaginationRange(99, 10, 24)).toEqual({ page: 2, from: 21, to: 24, total: 24 });
  });

  it('normaliza valores negativos y tamaños inválidos', () => {
    expect(getPaginationRange(-3, 0, -8)).toEqual({ page: 0, from: 0, to: 0, total: 0 });
  });
});
