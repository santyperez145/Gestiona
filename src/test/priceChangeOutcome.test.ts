import { describe, expect, it } from 'vitest';
import {
  observedPriceLabel,
  priceOutcomeProgress,
  priceOutcomeState,
} from '@/lib/priceChangeOutcome';

describe('price change outcome evidence', () => {
  it('no convierte una propuesta sin lectura en resultado', () => {
    expect(priceOutcomeState({ outcome_updated_at: null })).toBe('awaiting_sales');
  });

  it('marca como temprana una medición antes de vencer la ventana', () => {
    expect(priceOutcomeState({ outcome_updated_at: '2026-08-22', is_mature: false })).toBe('early_signal');
  });

  it('exige 100% en ambas ventanas para publicar contribución medida', () => {
    expect(priceOutcomeState({
      outcome_updated_at: '2026-08-22',
      is_mature: true,
      baseline_coverage_pct: 100,
      observed_coverage_pct: 75,
      contribution_per_day_delta_ars: null,
    })).toBe('measured_partial');
    expect(priceOutcomeState({
      outcome_updated_at: '2026-08-22',
      is_mature: true,
      baseline_coverage_pct: 100,
      observed_coverage_pct: 100,
      contribution_per_day_delta_ars: 250,
    })).toBe('measured');
  });

  it('limita el progreso entre cero y cien', () => {
    expect(priceOutcomeProgress('2026-08-22T00:00:00Z', '2026-08-23T00:00:00Z', Date.parse('2026-08-22T12:00:00Z'))).toBe(50);
    expect(priceOutcomeProgress('2026-08-22T00:00:00Z', '2026-08-23T00:00:00Z', Date.parse('2026-08-24T00:00:00Z'))).toBe(100);
  });

  it('dice evidencia observada y no causalidad', () => {
    expect(observedPriceLabel({ outcome_updated_at: '2026-08-22', is_mature: false })).toBe('Señal temprana');
  });
});
