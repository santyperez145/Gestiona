import { supabase } from "@/integrations/supabase/client";

export async function saveWalletBankAccount(input: {
  orgId: string;
  alias: string;
  holder: string;
  cbu: string;
  bank?: string | null;
}) {
  const { data, error } = await supabase.rpc("wallet_guardar_cuenta", {
    p_org: input.orgId,
    p_alias: input.alias,
    p_titular: input.holder,
    p_cbu: input.cbu,
    p_banco: input.bank ?? null,
  });
  if (error) throw error;
  return data;
}

export async function confirmWalletWithdrawal(input: {
  withdrawalId: string;
  reference: string;
  paymentMethod: string;
}) {
  const { data, error } = await supabase.rpc("wallet_confirmar_retiro", {
    p_id: input.withdrawalId,
    p_referencia: input.reference,
    p_payment_method: input.paymentMethod,
  });
  if (error) throw error;
  return data;
}

export async function rejectWalletWithdrawal(withdrawalId: string, reason: string) {
  const { error } = await supabase.rpc("wallet_rechazar_retiro", {
    p_id: withdrawalId,
    p_motivo: reason,
  });
  if (error) throw error;
}
