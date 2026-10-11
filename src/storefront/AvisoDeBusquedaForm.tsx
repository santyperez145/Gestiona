/**
 * «Avisame si lo consiguen» en una búsqueda sin resultados (migración
 * 20261011000800). Quien busca algo que la tienda no tiene se iba sin dejar
 * rastro; así deja su email y el comercio lo ve en «Lo que buscan y no
 * encuentran», con a quién escribirle cuando lo consiga. No pide cuenta,
 * igual que el aviso de stock.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeSeguroParaCliente } from "@/lib/edgeErrors";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { BellRing, Check, Loader2 } from "lucide-react";

export default function AvisoDeBusquedaForm({ termino }: { termino: string }) {
  const { store } = useStore();
  const { customer } = useStoreAuth();
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (customer?.email) setEmail(customer.email); }, [customer?.email]);
  // Otra búsqueda es otro pedido.
  useEffect(() => { setListo(false); setError(null); }, [termino]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.slug) return;
    setEnviando(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("pedir_aviso_de_busqueda" as never, {
      p_slug: store.slug, p_termino: termino, p_email: email,
    } as never);
    setEnviando(false);
    if (rpcErr) {
      console.error("[aviso de búsqueda] no se pudo registrar", rpcErr);
      setError(mensajeSeguroParaCliente(rpcErr, "No pudimos anotar tu email. Reintentá en unos minutos."));
      return;
    }
    setListo(true);
  };

  if (listo) {
    return (
      <div
        className="mt-6 mx-auto max-w-md p-4 border flex items-start gap-3 text-left"
        style={{ borderColor: "hsl(var(--st-accent))", borderRadius: "var(--st-radius)" }}
      >
        <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--st-link))" }} />
        <div>
          <p className="text-sm font-medium">Listo, la tienda ya sabe que lo buscás</p>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--st-muted))" }}>
            Si lo consiguen, te escriben a {email}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={enviar}
      aria-label="Pedir aviso"
      className="mt-6 mx-auto max-w-md p-4 border space-y-3 text-left"
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4" style={{ color: "hsl(var(--st-link))" }} />
        <p className="text-sm font-medium">¿Lo necesitás? Avisanos</p>
      </div>
      <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
        Dejanos tu email y, si consiguen «{termino}», la tienda te escribe. No hace falta tener cuenta.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input
          type="email" required value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="tu@email.com"
          aria-label="Tu email"
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
