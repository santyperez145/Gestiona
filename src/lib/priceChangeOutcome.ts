export interface PriceChangeOutcomeLike {
  status?: string | null;
  measurement_due_at?: string | null;
  outcome_updated_at?: string | null;
  is_mature?: boolean | null;
  baseline_coverage_pct?: number | null;
  observed_coverage_pct?: number | null;
  contribution_per_day_delta_ars?: number | null;
}

export type PriceOutcomeState = 'awaiting_sales' | 'early_signal' | 'measured_partial' | 'measured';

/**
 * Clasifica evidencia, no performance. Un delta positivo con cobertura baja
 * sigue siendo parcial y nunca se presenta como impacto causal.
 */
export function priceOutcomeState(outcome: PriceChangeOutcomeLike): PriceOutcomeState {
  if (!outcome.outcome_updated_at) return 'awaiting_sales';
  const complete = Number(outcome.baseline_coverage_pct) === 100
    && Number(outcome.observed_coverage_pct) === 100
    && outcome.contribution_per_day_delta_ars != null;
  if (!outcome.is_mature) return 'early_signal';
  return complete ? 'measured' : 'measured_partial';
}

export function priceOutcomeProgress(
  appliedAt?: string | null,
  dueAt?: string | null,
  nowMs = Date.now(),
): number | null {
  if (!appliedAt || !dueAt) return null;
  const start = new Date(appliedAt).getTime();
  const end = new Date(dueAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(100, Math.round((nowMs - start) / (end - start) * 100)));
}

export function observedPriceLabel(outcome: PriceChangeOutcomeLike): string {
  const state = priceOutcomeState(outcome);
  if (state === 'awaiting_sales') return 'Todavía sin observación';
  if (state === 'early_signal') return 'Señal temprana';
  if (state === 'measured_partial') return 'Ventana completa · evidencia parcial';
  return 'Ventana completa · margen explicable';
}
