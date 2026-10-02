import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { capitalCaptureSchema, capitalSourceError, inventoryCapitalSchema, type InventoryCapital } from "@/lib/inventoryCapital";
import { retryIdempotentWrite, retryRead } from "@/lib/transientRead";

type Props = { orgId: string | null; enabled: boolean; search: string; page: number; historyPage: number; layerPage?: number };
export function useInventoryCapital({ orgId, enabled, search, page, historyPage, layerPage = 1 }: Props) {
  const scope = JSON.stringify([orgId, search, page, historyPage, layerPage]);
  const [snapshot, setSnapshot] = useState<{ scope: string; data: InventoryCapital } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [captureState, setCaptureState] = useState<{ orgId: string; pending: boolean; message?: string; error?: string } | null>(null);
  const lock = useRef(false);
  const currentContext = useRef({ orgId, enabled, generation: 0, mounted: true });
  if (currentContext.current.orgId !== orgId || currentContext.current.enabled !== enabled) currentContext.current.generation++;
  currentContext.current = { ...currentContext.current, orgId, enabled };
  useEffect(() => { currentContext.current.mounted = true; return () => { currentContext.current.mounted = false; }; }, []);
  useEffect(() => {
    if (!enabled || !orgId) { setSnapshot(null); setFailure(null); setPending(false); return; }
    let cancelled = false;
    setPending(true); setFailure(null);
    const load = async () => {
      try {
        const result = await retryRead(() => supabase.rpc("get_inventory_capital", {
          p_org_id: orgId, p_search: search, p_page: page, p_page_size: 25, p_history_page: historyPage, p_layer_page: layerPage,
        }));
        if (cancelled) return;
        if (result.error) throw result.error;
        const data = inventoryCapitalSchema.parse(result.data);
        if (data.orgId !== orgId || data.search !== search
          || data.page !== Math.min(page, Math.max(1, Math.ceil(data.itemCount / data.pageSize)))
          || data.historyPage !== Math.min(historyPage, Math.max(1, Math.ceil(data.historyCount / data.pageSize)))
          || data.layerPage !== Math.min(layerPage, Math.max(1, Math.ceil(data.layerCount / data.pageSize)))) throw new Error("Capital scope mismatch");
        setSnapshot({ scope, data });
      } catch (error) {
        if (cancelled) return;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
        console.error("[Inventory capital] read failed", { code, orgId });
        if (code === "42501" || code === "PGRST301") setSnapshot(null);
        setFailure({ scope, message: capitalSourceError(code) });
      } finally { if (!cancelled) setPending(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled, orgId, search, page, historyPage, layerPage, scope, revision]);
  const data = enabled && snapshot?.scope === scope ? snapshot.data : null;
  const error = enabled && failure?.scope === scope ? failure.message : null;
  const capture = async () => {
    if (lock.current || !enabled || !orgId || !data || error || pending) return;
    lock.current = true; setCaptureState({ orgId, pending: true });
    const generation = currentContext.current.generation;
    const isCurrent = () => currentContext.current.mounted && currentContext.current.generation === generation && currentContext.current.orgId === orgId && currentContext.current.enabled;
    try {
      // The server serializes the org/day and never overwrites a previous capture.
      const result = await retryIdempotentWrite(() => supabase.rpc("capture_inventory_capital", { p_org_id: orgId, p_date: data.snapshotDate }));
      if (!isCurrent()) return;
      if (result.error) throw result.error;
      const response = capitalCaptureSchema.parse(result.data);
      if (response.orgId !== orgId || response.date !== data.snapshotDate) throw new Error("Capture scope mismatch");
      setCaptureState({ orgId, pending: false, message: response.status === "recorded" ? "Cierre del día guardado para toda la organización."
        : response.status === "already_recorded" ? "El cierre del día ya existe y se conservó sin cambios." : "No hay stock para guardar un cierre." });
      setRevision(value => value + 1);
    } catch (failure) {
      if (!isCurrent()) return;
      const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : undefined;
      console.error("[Inventory capital] capture failed", { code, orgId });
      if (code === "42501" || code === "PGRST301") { setSnapshot(null); setFailure({ scope, message: capitalSourceError(code) }); }
      setCaptureState({ orgId, pending: false, error: capitalSourceError(code) });
    } finally {
      lock.current = false;
      if (currentContext.current.mounted && !isCurrent()) setCaptureState(null);
    }
  };
  const captureResult = enabled && captureState?.orgId === orgId ? captureState : null;
  return { data, error, loading: enabled && (pending || (!data && !error)), retry: () => setRevision(value => value + 1),
    capture, capturing: enabled && lock.current, captureMessage: captureResult?.message, captureError: captureResult?.error };
}
