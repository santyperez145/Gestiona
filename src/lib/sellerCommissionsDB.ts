import { supabase } from "@/integrations/supabase/client";

export async function configureSellerCommission(input: {
  orgId: string;
  userId: string;
  enabled: boolean;
  percent: number;
}) {
  const { error } = await supabase.rpc("configure_seller_commission", {
    p_org_id: input.orgId,
    p_user_id: input.userId,
    p_enabled: input.enabled,
    p_percent: input.percent,
  });
  if (error) throw error;
}

export async function generateSellerCommission(input: {
  orgId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const { data, error } = await supabase.rpc("generate_seller_commission", {
    p_org_id: input.orgId,
    p_user_id: input.userId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
  });
  if (error) throw error;
  return data;
}

export async function settleSellerCommission(input: {
  payoutId: string;
  paymentReference: string;
  paymentMethod: string;
}) {
  const { data, error } = await supabase.rpc("settle_seller_commission", {
    p_payout_id: input.payoutId,
    p_payment_reference: input.paymentReference,
    p_payment_method: input.paymentMethod,
  });
  if (error) throw error;
  return data;
}
