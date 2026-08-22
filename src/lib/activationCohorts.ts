import type { Database } from '@/integrations/supabase/types';

export type ActivationCohortRow = Database['public']['Views']['platform_activation_cohorts']['Row'];
export type ActivationCohortMemberRow = Database['public']['Views']['platform_activation_cohort_members']['Row'];
export type ActivationInterventionRow = Database['public']['Views']['platform_activation_interventions']['Row'];

export const ACTIVATION_MILESTONES = [
  'identity', 'catalog', 'stock', 'channel', 'payment',
  'shipping', 'fiscal', 'sale', 'general',
] as const;

export const ACTIVATION_INTERVENTION_TYPES = [
  'onboarding_call', 'data_import', 'configuration', 'training',
  'bug_workaround', 'commercial_followup', 'other',
] as const;

export const ACTIVATION_INTERVENTION_OUTCOMES = [
  'resolved', 'follow_up', 'blocked_external', 'no_change',
] as const;

export type ActivationMilestoneId = typeof ACTIVATION_MILESTONES[number];
export type ActivationInterventionType = typeof ACTIVATION_INTERVENTION_TYPES[number];
export type ActivationInterventionOutcome = typeof ACTIVATION_INTERVENTION_OUTCOMES[number];

export const ACTIVATION_MILESTONE_LABEL: Record<ActivationMilestoneId, string> = {
  identity: 'Identidad y legales',
  catalog: 'Catálogo',
  stock: 'Stock',
  channel: 'Canal',
  payment: 'Cobro',
  shipping: 'Entrega',
  fiscal: 'Fiscal',
  sale: 'Primera venta',
  general: 'Acompañamiento general',
};

export const ACTIVATION_INTERVENTION_TYPE_LABEL: Record<ActivationInterventionType, string> = {
  onboarding_call: 'Llamada de onboarding',
  data_import: 'Importación de datos',
  configuration: 'Configuración',
  training: 'Capacitación',
  bug_workaround: 'Contención de bug',
  commercial_followup: 'Seguimiento comercial',
  other: 'Otra intervención',
};

export const ACTIVATION_INTERVENTION_OUTCOME_LABEL: Record<ActivationInterventionOutcome, string> = {
  resolved: 'Resuelto',
  follow_up: 'Requiere seguimiento',
  blocked_external: 'Bloqueo externo',
  no_change: 'Sin cambio',
};

export interface ActivationInterventionDraft {
  milestone: string;
  interventionType: string;
  minutesSpent: number;
  outcome: string;
}

export interface ActivationCohortSummary {
  organizations: number;
  activated: number;
  pending: number;
  activationRatePct: number | null;
  eligible7d: number;
  activation7dRatePct: number | null;
  eligible14d: number;
  activation14dRatePct: number | null;
  eligible30d: number;
  activation30dRatePct: number | null;
  supportMeasurementEligible: number;
  selfServiceActivated: number;
  selfServiceRatePct: number | null;
  interventionMinutes: number;
  averageSupportMinutesPerEligibleOrg: number | null;
}

function total(rows: ActivationCohortRow[], field: keyof ActivationCohortRow) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

/**
 * Consolida cohortes sin promediar porcentajes mensuales. Los denominadores de
 * 7/14/30 días ya vienen madurados por SQL y la tasa autoservicio excluye todo
 * lo anterior al watermark de instrumentación.
 */
export function summarizeActivationCohorts(rows: ActivationCohortRow[]): ActivationCohortSummary {
  const organizations = total(rows, 'organizations_total');
  const activated = total(rows, 'activated_total');
  const pending = total(rows, 'pending_total');
  const eligible7d = total(rows, 'eligible_7d_total');
  const eligible14d = total(rows, 'eligible_14d_total');
  const eligible30d = total(rows, 'eligible_30d_total');
  const activated7d = total(rows, 'activated_7d_total');
  const activated14d = total(rows, 'activated_14d_total');
  const activated30d = total(rows, 'activated_30d_total');
  const supportMeasurementEligible = total(rows, 'support_measurement_eligible_total');
  const selfServiceActivated = total(rows, 'self_service_activated_total');
  const supportedActivated = total(rows, 'supported_activated_total');
  const interventionMinutes = total(rows, 'activation_intervention_minutes');

  return {
    organizations,
    activated,
    pending,
    activationRatePct: percentage(activated, organizations),
    eligible7d,
    activation7dRatePct: percentage(activated7d, eligible7d),
    eligible14d,
    activation14dRatePct: percentage(activated14d, eligible14d),
    eligible30d,
    activation30dRatePct: percentage(activated30d, eligible30d),
    supportMeasurementEligible,
    selfServiceActivated,
    selfServiceRatePct: percentage(selfServiceActivated, selfServiceActivated + supportedActivated),
    interventionMinutes,
    averageSupportMinutesPerEligibleOrg: supportMeasurementEligible > 0
      ? Math.round((interventionMinutes / supportMeasurementEligible) * 10) / 10
      : null,
  };
}

export function validateActivationIntervention(draft: ActivationInterventionDraft): string | null {
  if (!ACTIVATION_MILESTONES.includes(draft.milestone as ActivationMilestoneId)) {
    return 'Elegí el hito que recibió ayuda.';
  }
  if (!ACTIVATION_INTERVENTION_TYPES.includes(draft.interventionType as ActivationInterventionType)) {
    return 'Elegí el tipo de intervención.';
  }
  if (!Number.isInteger(draft.minutesSpent) || draft.minutesSpent < 1 || draft.minutesSpent > 480) {
    return 'Los minutos deben ser un entero entre 1 y 480.';
  }
  if (!ACTIVATION_INTERVENTION_OUTCOMES.includes(draft.outcome as ActivationInterventionOutcome)) {
    return 'Elegí el resultado de la intervención.';
  }
  return null;
}
