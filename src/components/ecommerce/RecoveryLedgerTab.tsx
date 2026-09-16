/**
 * Recovery Ledger (historial comparativo) — tercera vista del workspace de recuperación.
 * Muestra el historial de carritos abandonados con sus estados de recuperación
 * para análisis de KPI y decisión estratégica.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AbandonedCartsPanel from "@/components/ecommerce/AbandonedCartsPanel";
import RecoveryLedger from "@/components/ecommerce/RecoveryLedger";
import {
  filterAbandonedCartsForQueue,
  parseRecoveryEmailChannel,
  type AbandonedCartRow,
  type AbandonedEmailChannel,
} from "@/lib/abandonedCarts";

interface Props {
  orgId: string | null;
  storeId: string | null;
  storeSlug: string | null;
}

export default function RecoveryLedgerTab({ orgId, storeId, storeSlug }: Props) {
  const [abandonedCartRows, setAbandonedCartRows] = useState<AbandonedCartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailChannel, setEmailChannel] = useState<AbandonedEmailChannel | null>(null);

  const loadEmailChannel = async () => {
    if (!orgId) {
      setEmailChannel(null);
      return;
    }
    const { data, error } = await supabase.rpc("recovery_email_channel_ready", {
      p_org_id: orgId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42883" || code === "PGRST202") {
        console.warn("RecoveryLedgerTab / canal email: RPC aún no aplicada");
        setEmailChannel(null);
        return;
      }
      console.error("RecoveryLedgerTab / canal email:", error);
      setEmailChannel({ ready: false, merchantSmtp: false, platformEmail: false });
      return;
    }
    setEmailChannel(parseRecoveryEmailChannel(data));
  };

  const loadLedger = async () => {
    if (!orgId || !storeId) {
      setAbandonedCartRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("ecommerce_cart_sessions")
      .select("id, status, items, customer_email, subtotal, total, abandoned_email_sent, recovery_token, expires_at, updated_at, created_at")
      .eq("org_id", orgId)
      .eq("store_id", storeId);
    if (error) {
      console.error("RecoveryLedgerTab / carritos:", error);
      setError(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as AbandonedCartRow[];
    const queue = filterAbandonedCartsForQueue(rows);
    setAbandonedCartRows(queue);
    setLoading(false);
  };

  useEffect(() => {
    void loadEmailChannel();
    void loadLedger();
  }, [orgId, storeId]);

  return (
    <div className="space-y-6">
      {/* Vista de ledger como tabla histórica */}
      <RecoveryLedger
        orgId={orgId}
        storeId={storeId}
        storeSlug={storeSlug}
      />
    </div>
  );
}