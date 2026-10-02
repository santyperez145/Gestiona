import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { convieneConsultar, installmentResponseSchema, type RespuestaCuotas } from "@/lib/installments";
import { retryRead } from "@/lib/transientRead";

const TTL = 15 * 60 * 1000;
type Quote = { data: RespuestaCuotas; expiresAt: number };
const cache = new Map<string, Quote>();
const inFlight = new Map<string, Promise<Quote>>();
const recovery = "No pudimos consultar las cuotas. Podés verificarlas al pagar o volver a intentar.";

async function readQuote(key: string, slug: string, amount: number): Promise<Quote> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  cache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const result = await retryRead(async () => {
      const response = await supabase.functions.invoke("mp-installments", { body: { slug, amount } });
      const status = response.response?.status;
      return { ...response, status, error: response.error?.name === "FunctionsFetchError"
        ? { code: "ECONNRESET", message: "Installment transport unavailable" } : response.error };
    });
    if (result.error) throw result.error;
    const data = installmentResponseSchema.parse(result.data) as RespuestaCuotas;
    if (["mp_sin_respuesta", "no_se_pudo_validar"].includes(data.motivo || "")) throw new Error("Installment source unavailable");
    const quote = { data, expiresAt: Date.now() + TTL };
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, quote);
    return quote;
  })();
  inFlight.set(key, request);
  try { return await request; } finally { inFlight.delete(key); }
}

export function useInstallments(slug: string | undefined, monto: number | null | undefined, enabled: boolean) {
  const amount = Math.round(Number(monto) * 100) / 100;
  const key = enabled && slug && convieneConsultar(monto) ? JSON.stringify([slug, amount]) : null;
  const [snapshot, setSnapshot] = useState<{ key: string; quote: Quote } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!key) { setSnapshot(null); setFailure(null); setPending(null); return; }
    let cancelled = false;
    setPending(key); setFailure(null);
    void readQuote(key, slug, amount).then(quote => {
      if (!cancelled) setSnapshot({ key, quote });
    }).catch(error => {
      if (cancelled) return;
      console.error("[Store installments] source unavailable", { kind: error?.name || "SourceError" });
      setSnapshot(null); setFailure({ key, message: recovery });
    }).finally(() => { if (!cancelled) setPending(null); });
    return () => { cancelled = true; };
  }, [key, slug, amount, revision]);
  const data = key && snapshot?.key === key && snapshot.quote.expiresAt > Date.now() ? snapshot.quote.data : null;
  const error = key && failure?.key === key ? failure.message : null;
  return { data, error, loading: !!key && (pending === key || (!data && !error)), retry: () => setRevision(value => value + 1) };
}
