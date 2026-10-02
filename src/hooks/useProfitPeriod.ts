import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { profitPeriodSchema, profitSourceError, type ProfitPeriod } from "@/lib/profitPeriod";

type Props = { orgId: string | null; enabled: boolean; from?: string; to?: string; productPage: number; operationPage: number };
type Snapshot = { scope: string; data: ProfitPeriod; updatedAt: string };

export function useProfitPeriod({ orgId, enabled, from, to, productPage, operationPage }: Props) {
  const scope = JSON.stringify([orgId, from || null, to || null]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled || !orgId) { setSnapshot(null); setFailure(null); setPending(false); return; }
    let cancelled = false;
    setPending(true);
    setFailure(null);
    const load = async () => {
      try {
        const result = await supabase.rpc("get_profit_period", {
          p_org_id: orgId, p_from: from || null, p_to: to || null,
          p_product_page: productPage, p_operation_page: operationPage, p_page_size: 25,
        });
        if (cancelled) return;
        if (result.error) throw result.error;
        const data = profitPeriodSchema.parse(result.data);
        if (data.from !== (from || null) || data.to !== (to || null)
          || data.operations.some(operation => operation.org_id !== orgId)) {
          throw new Error("Profit scope mismatch");
        }
        setSnapshot({ scope, data, updatedAt: new Date().toISOString() });
      } catch (error) {
        if (cancelled) return;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
        console.error("[Profit] period source failed", { code, orgId });
        if (code === "42501" || code === "PGRST301") setSnapshot(null);
        setFailure({ scope, message: profitSourceError({ code }) });
      } finally {
        if (!cancelled) setPending(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled, from, operationPage, orgId, productPage, revision, scope, to]);

  const current = enabled && snapshot?.scope === scope ? snapshot : null;
  const error = enabled && failure?.scope === scope ? failure.message : null;
  return {
    data: current?.data ?? null, updatedAt: current?.updatedAt,
    loading: enabled && (pending || (!current && !error)), error,
    retry: () => setRevision(value => value + 1),
  };
}
