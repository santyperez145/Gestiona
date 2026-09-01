/**
 * Restaura un carrito desde el link del email de recuperación.
 *
 * El token viene en la URL, así que no hace falta que la persona inicie sesión
 * — pedirle que se loguee para recuperar su propio carrito sería justo el
 * obstáculo que hizo que lo abandonara.
 *
 * Un corte de red no es un carrito vencido: devolver vacío hacía que el
 * comprador creyera que ya compró o que se agotó todo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { retryPublicRead } from "@/lib/publicDataSource";
import { useStore } from "./storeContext";
import { Loader2, ShoppingBag } from "lucide-react";

type EstadoRecuperacion = "cargando" | "vacio" | "error" | "catalogo" | "listo";

export default function StoreCartRecovery() {
  const { token } = useParams<{ token: string }>();
  const { store, products, addToCart, clearCart, loading, loadError, reload } = useStore();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<EstadoRecuperacion>("cargando");
  const yaCorrio = useRef(false);

  const intentar = useCallback(async () => {
    if (!token || !store) return;
    setEstado("cargando");
    const rpc = await retryPublicRead(() =>
      supabase.rpc("get_cart_by_recovery_token", { p_token: token }));
    if (rpc.error) {
      console.error("[carrito] error recuperando:", rpc.error.message);
      setEstado("error");
      return;
    }
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { items?: { product_id?: string; quantity?: number }[] } | undefined;
    const items = row?.items ?? [];

    if (!items.length) { setEstado("vacio"); return; }

    // Se rearma contra el catálogo actual: el precio o el stock pueden haber
    // cambiado desde que se mandó el email, y cobrar el precio viejo sería
    // un problema.
    clearCart();
    let agregados = 0;
    for (const it of items) {
      const p = products.find(x => x.id === it.product_id);
      if (!p || p.stock < 1) continue;
      addToCart(p, Math.min(p.stock, Number(it.quantity) || 1));
      agregados++;
    }

    if (agregados === 0) { setEstado("vacio"); return; }
    setEstado("listo");
    navigate(`/tienda/${store.slug}/checkout`, { replace: true });
  }, [token, store, products, addToCart, clearCart, navigate]);

  useEffect(() => {
    if (!token || !store || loading) return;
    if (loadError) {
      setEstado("catalogo");
      return;
    }
    if (yaCorrio.current) return;
    yaCorrio.current = true;
    void intentar();
  }, [token, store, loading, loadError, intentar]);

  const card = (titulo: string, detalle: string, accion: { label: string; onClick: () => void }, state: string) => (
    <div className="max-w-md mx-auto px-4 py-24 text-center" data-storefront-state={state} role={state === "vacio" ? undefined : "alert"}>
      <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">{titulo}</p>
      <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>{detalle}</p>
      <button
        type="button"
        onClick={accion.onClick}
        className="mt-5 min-h-11 px-4 py-2 text-sm font-medium"
        style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
      >
        {accion.label}
      </button>
    </div>
  );

  if (estado === "catalogo") {
    return card(
      "No pudimos cargar el catálogo",
      "Sin el catálogo no podemos rearmar tu carrito al precio de hoy. Reintentá.",
      {
        label: "Reintentar",
        onClick: () => {
          yaCorrio.current = false;
          reload();
        },
      },
      "cart-catalog-error",
    );
  }

  if (estado === "error") {
    return card(
      "No pudimos recuperar tu carrito",
      "La red falló. El link sigue siendo válido; reintentá.",
      {
        label: "Reintentar",
        onClick: () => { void intentar(); },
      },
      "cart-error",
    );
  }

  if (estado === "vacio") {
    return card(
      "Este carrito ya no está disponible",
      "Puede que ya lo hayas comprado, o que los productos se hayan agotado.",
      {
        label: "Ver productos",
        onClick: () => navigate(`/tienda/${store?.slug ?? ""}/productos`),
      },
      "cart-empty",
    );
  }

  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 opacity-50" />
        <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>Recuperando tu carrito…</p>
      </div>
    </div>
  );
}
