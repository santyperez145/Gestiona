/**
 * "Avisame cuando vuelva" para un producto (o variante) agotado.
 *
 * No pide cuenta a propósito: quien entra, ve "sin stock" y se va es una venta
 * perdida; pedirle que se registre para avisarle es perderla dos veces.
 * Alcanza con el email, que se precarga si hay sesión.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeSeguroParaCliente } from "@/lib/edgeErrors";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { BellRing, Check, Loader2 } from "lucide-react";

export default function StockAlertForm({
  productId, variantId,
}: { productId: string; variantId?: string | null }) {
  const { store } = useStore();
  const { customer } = useStoreAuth();
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (customer?.email) setEmail(customer.email); }, [customer?.email]);
  // Al cambiar de variante el pedido anterior ya no aplica: se vuelve a pedir.
  useEffect(() => { setListo(false); setError(null); }, [variantId, productId]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.slug) return;
    setEnviando(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("request_stock_alert", {
      p_slug: store.slug, p_product_id: productId,
      p_email: email, p_variant_id: variantId ?? null,
    });
    setEnviando(false);
    if (rpcErr) {
      console.error("[alerta de stock] no se pudo registrar", rpcErr);
      setError(mensajeSeguroParaCliente(rpcErr, "No pudimos anotar tu email. Reintentá en unos minutos."));
      return;
    }
    const res = data as unknown as { ok?: boolean; reason?: string };
    if (!res?.ok) {
      setError(res?.reason === "hay_stock"
        ? "Justo volvió a haber stock: recargá la página."
        : "No pudimos anotar tu pedido.");
      return;
    }
    setListo(true);
  };

  if (listo) {
    return (
      <div
        className="mt-6 p-4 border flex items-start gap-3"
        style={{ borderColor: "hsl(var(--st-accent))", borderRadius: "var(--st-radius)" }}
      >
        <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--st-link))" }} />
        <div>
          <p className="text-sm font-medium">Listo, te avisamos</p>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--st-muted))" }}>
            Te escribimos a {email} apenas vuelva. Es un solo mensaje.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="mt-6 p-4 border space-y-3"
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4" style={{ color: "hsl(var(--st-link))" }} />
        <p className="text-sm font-medium">Sin stock por ahora</p>
      </div>
      <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
        Dejanos tu email y te avisamos cuando vuelva. No hace falta tener cuenta.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input
          type="email" required value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="tu@email.com"
          className="flex-1 min-w-[180px] px-3 py-2 text-sm border bg-transparent outline-none"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        />
        <button
          type="submit" disabled={enviando}
          className="px-4 py-2 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Avisame
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
