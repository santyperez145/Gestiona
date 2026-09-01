import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  liquidarCobroEstimado,
  normalizarAppliesTo,
  type Channel,
  type CommissionRule,
  type ProviderFee,
  type Settlement,
} from "@/lib/paymentFees";

const FEES_SELECT =
  "provider, method, installments, percent_fee, fixed_fee, iva_on_fee_pct, release_days, currency, effective_from";
const RULES_SELECT =
  "id, percent, fixed, min_per_transaction, max_per_transaction, tax_rate_pct, tax_treatment, is_active, approval_status, applies_to, org_id, plan_id, effective_from, effective_until";

interface TarifaFila extends ProviderFee {
  iva_on_fee_pct: number;
}

interface ReglaFila {
  id: string;
  percent: number;
  fixed: number;
  min_per_transaction: number;
  max_per_transaction: number | null;
  tax_rate_pct: number;
  tax_treatment: string | null;
  is_active: boolean;
  approval_status: string;
  applies_to: string;
  org_id: string | null;
  plan_id: string | null;
  effective_from: string | null;
  effective_until: string | null;
}

export function useLiquidacionEstimada(input: {
  orgId?: string;
  planId?: string | null;
  bruto: number;
  provider: string;
  method?: string;
  installments?: number;
  channel?: Channel;
}): { settlement: Settlement | null; error: string | null; cargando: boolean } {
  const [tarifas, setTarifas] = useState<TarifaFila[]>([]);
  const [reglas, setReglas] = useState<ReglaFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [feesRes, rulesRes] = await Promise.all([
      supabase.from("payment_provider_fees").select(FEES_SELECT).eq("provider", input.provider),
      supabase.from("platform_commission_rules").select(RULES_SELECT),
    ]);
    if (feesRes.error) {
      console.error("useLiquidacionEstimada tarifas:", feesRes.error);
      setError(feesRes.error.message);
      setCargando(false);
      return;
    }
    if (rulesRes.error) {
      console.error("useLiquidacionEstimada reglas:", rulesRes.error);
      setError(rulesRes.error.message);
      setCargando(false);
      return;
    }
    setTarifas((feesRes.data ?? []) as TarifaFila[]);
    setReglas((rulesRes.data ?? []) as ReglaFila[]);
    setError(null);
    setCargando(false);
  }, [input.provider]);

  useEffect(() => { void cargar(); }, [cargar]);

  const settlement = useMemo(() => {
    if (input.bruto <= 0) return null;
    const mapped: CommissionRule[] = reglas.map(r => ({
      id: r.id,
      percent: r.percent,
      fixed: r.fixed,
      min_per_transaction: r.min_per_transaction,
      max_per_transaction: r.max_per_transaction,
      tax_rate_pct: r.tax_rate_pct,
      tax_treatment: r.tax_treatment === "added" || r.tax_treatment === "included"
        ? r.tax_treatment
        : null,
      is_active: r.is_active,
      approval_status: r.approval_status,
      applies_to: normalizarAppliesTo(r.applies_to),
      org_id: r.org_id,
      plan_id: r.plan_id,
      effective_from: r.effective_from,
      effective_until: r.effective_until,
    }));
    return liquidarCobroEstimado({
      tarifas,
      reglas: mapped,
      gross: input.bruto,
      orgId: input.orgId ?? null,
      planId: input.planId ?? null,
      channel: input.channel ?? "online",
      provider: input.provider,
      method: input.method,
      installments: input.installments,
    });
  }, [tarifas, reglas, input.bruto, input.orgId, input.planId, input.channel, input.provider, input.method, input.installments]);

  return { settlement, error, cargando };
}
