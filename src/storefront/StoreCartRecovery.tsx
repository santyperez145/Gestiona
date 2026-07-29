/**
 * Restaura un carrito desde el link del email de recuperación.
 *
 * El token viene en la URL, así que no hace falta que la persona inicie sesión
 * — pedirle que se loguee para recuperar su propio carrito sería justo el
 * obstáculo que hizo que lo abandonara.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { Loader2, ShoppingBag } from "lucide-react";

export default function StoreCartRecovery() {
  const { token } = useParams<{ token: string }>();
  const { store, products, addToCart, clearCart } = useStore();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<"cargando" | "vacio" | "listo">("cargando");
  const yaCorrio = useRef(false);

  useEffect(() => {
    // El catálogo tiene que estar cargado para poder revalidar precio y stock.
    if (!token || !store || products.length === 0 || yaCorrio.current) return;
    yaCorrio.current = true;

    (async () => {
      const { data } = await supabase.rpc("get_cart_by_recovery_token", { p_token: token });
      const row = (Array.isArray(data) ? data[0] : data) as { items?: any[] } | undefined;
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
    })();
  }, [token, store, products, addToCart, clearCart, navigate]);

  if (estado === "vacio") {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Este carrito ya no está disponible</p>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Puede que ya lo hayas comprado, o que los productos se hayan agotado.
        </p>
        <button
          onClick={() => navigate(`/tienda/${store?.slug ?? ""}/productos`)}
          className="mt-5 px-4 py-2 text-sm font-medium"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          Ver productos
        </button>
      </div>
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
