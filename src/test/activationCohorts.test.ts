import { describe, expect, it } from 'vitest';
import {
  summarizeActivationCohorts,
  validateActivationIntervention,
  type ActivationCohortRow,
} from '@/lib/activationCohorts';

const cohort = (overrides: Partial<ActivationCohortRow>): ActivationCohortRow => ({
  activated_14d_total: 0,
  activated_30d_total: 0,
  activated_7d_total: 0,
  activated_total: 0,
  activation_14d_rate_pct: null,
  activation_30d_rate_pct: null,
  activation_7d_rate_pct: null,
  activation_intervention_minutes: 0,
  activation_interventions_total: 0,
  activation_rate_pct: null,
  avg_support_minutes_per_org: null,
  cohort_month: '2026-08-01',
  eligible_14d_total: 0,
  eligible_30d_total: 0,
  eligible_7d_total: 0,
  median_days_to_first_sale: null,
  organizations_total: 0,
  pending_total: 0,
  self_service_activated_total: 0,
  self_service_rate_pct: null,
  support_measurement_eligible_total: 0,
  supported_activated_total: 0,
  ...overrides,
});

describe('summarizeActivationCohorts', () => {
  it('suma denominadores y no promedia porcentajes mensuales', () => {
    const summary = summarizeActivationCohorts([
      cohort({
        organizations_total: 1,
        activated_total: 1,
        pending_total: 0,
        eligible_7d_total: 1,
        activated_7d_total: 1,
        support_measurement_eligible_total: 1,
        self_service_activated_total: 1,
        activation_intervention_minutes: 0,
        activation_rate_pct: 100,
      }),
      cohort({
        organizations_total: 9,
        activated_total: 0,
        pending_total: 9,
        eligible_7d_total: 9,
        activated_7d_total: 0,
        support_measurement_eligible_total: 9,
        activation_intervention_minutes: 90,
        activation_rate_pct: 0,
      }),
    ]);

    expect(summary.activationRatePct).toBe(10);
    expect(summary.activation7dRatePct).toBe(10);
    expect(summary.averageSupportMinutesPerEligibleOrg).toBe(9);
  });

  it('no inventa autoservicio ni costo medio sin base instrumentada', () => {
    const summary = summarizeActivationCohorts([
      cohort({ organizations_total: 4, activated_total: 1, pending_total: 3 }),
    ]);

    expect(summary.activationRatePct).toBe(25);
    expect(summary.selfServiceRatePct).toBeNull();
    expect(summary.averageSupportMinutesPerEligibleOrg).toBeNull();
  });

  it('calcula autoservicio sólo sobre activaciones clasificables', () => {
    const summary = summarizeActivationCohorts([
      cohort({
        organizations_total: 4,
        activated_total: 3,
        self_service_activated_total: 2,
        supported_activated_total: 1,
        support_measurement_eligible_total: 4,
      }),
    ]);

    expect(summary.selfServiceRatePct).toBe(66.7);
  });
});

describe('validateActivationIntervention', () => {
  const valid = {
    milestone: 'catalog',
    interventionType: 'data_import',
    minutesSpent: 17,
    outcome: 'resolved',
  };

  it('acepta únicamente el vocabulario estructurado', () => {
    expect(validateActivationIntervention(valid)).toBeNull();
    expect(validateActivationIntervention({ ...valid, milestone: 'cliente@email.com' })).toContain('hito');
    expect(validateActivationIntervention({ ...valid, interventionType: 'nota libre' })).toContain('tipo');
    expect(validateActivationIntervention({ ...valid, outcome: 'tal vez' })).toContain('resultado');
  });

  it('limita el costo a minutos enteros razonables', () => {
    expect(validateActivationIntervention({ ...valid, minutesSpent: 0 })).toContain('entero');
    expect(validateActivationIntervention({ ...valid, minutesSpent: 12.5 })).toContain('entero');
    expect(validateActivationIntervention({ ...valid, minutesSpent: 481 })).toContain('entero');
  });
});
