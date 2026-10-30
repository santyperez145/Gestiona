/**
 * «Pedir cotización» desde el carrito (2026-10-30, migración 20261030000700).
 * En tiendas con venta mayorista, el comprador logueado manda su lista y le
 * llega al comercio como presupuesto; la respuesta y el link de pago los ve
 * en Mi cuenta. No vacía el carrito: puede seguir comprando igual.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeSeguroParaCliente } from "@/lib/edgeErrors";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";

const tenue = { color: "hsl(var(--st-muted))" } as const;

export default function PedirCotizacion() {
  const { store, cart, mayorista, basePath } = useStore();
  const { customer } = useStoreAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  if (!store?.slug || cart.length === 0 || !mayorista || mayorista.modo === "off") return null;

  const borde = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as const;

  if (!customer) {
    return (
      <p className="mt-3 text-xs" style={tenue}>
        ¿Comprás por cantidad?{" "}
        <Link to={`${basePath}/cuenta`} className="underline" style={{ color: "hsl(var(--st-link))" }}>Ingresá</Link>
        {" "}y pedí una cotización con este carrito.
      </p>
    );
  }

  if (listo) {
    return (
      <p className="mt-3 text-xs border p-3" style={borde} role="status">
        Listo: tu pedido <strong>{listo}</strong> llegó a la tienda. Te respondemos por email y lo seguís en{" "}
        <Link to={`${basePath}/cuenta`} className="underline" style={{ color: "hsl(var(--st-link))" }}>Mi cuenta</Link>.
      </p>
    );
  }

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("solicitar_cotizacion_tienda" as never, {
      p_slug: store.slug,
      p_items: cart.map(l => ({ product_id: l.productId, variant_id: l.variantId ?? null, quantity: l.qty })),
      p_datos: { mensaje: mensaje.trim() || null },
    } as never);
    setEnviando(false);
    // Un «listo» falso le haría esperar una respuesta que nunca llega.
    if (rpcError) {
      console.error("[cotización] no se pudo enviar el pedido", rpcError);
      setError(mensajeSeguroParaCliente(rpcError, "No pudimos enviar el pedido. Reintentá en unos minutos."));
      return;
    }
    setListo(String((data as { quote_number?: unknown } | null)?.quote_number ?? ""));
  };

  return (
    <div className="mt-3 border p-3 space-y-2" style={borde}>
      {!abierto ? (
        <button type="button" onClick={() => setAbierto(true)} className="w-full inline-flex items-center justify-center gap-1.5 min-h-11 text-sm font-medium border" style={borde}>
          <FileText className="w-4 h-4" />Pedir cotización
        </button>
      ) : (
        <>
          <p className="text-xs" style={tenue}>
            La tienda te responde con el precio por cantidad y un link para pagar. Tu carrito queda como está.
          </p>
          <label className="block text-xs space-y-1">Algo que debamos saber (opcional)
            <textarea value={mensaje} onChange={e => setMensaje(e.target.value.slice(0, 1000))} rows={2}
              placeholder="Obra, plazo de entrega, forma de pago…"
              className="w-full border px-3 py-2 text-sm bg-transparent" style={borde} />
          </label>
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
          <button type="button" disabled={enviando} onClick={() => void enviar()}
            className="w-full inline-flex items-center justify-center gap-1.5 min-h-11 text-sm font-semibold"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}Enviar pedido de cotización
          </button>
        </>
      )}
    </div>
  );
}
