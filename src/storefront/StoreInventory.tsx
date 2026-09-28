/**
 * Mapa de stock por ubicación (POS + storefront).
 *
 * Paridad con Shopify POS / Tiendanube PDV: stock único por ubicación,
 * sincronización en tiempo real entre punto de venta y tienda online.
 * No inventa stock, precio, margen ni cliente fuera del Business Core.
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/storefront/storeContext";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";

export interface LocationStock {
  location_id: string;
  location_name: string;
  product_id: string;
  variant_id: string | null;
  stock: number;
  reserved: number;
  available: number;
}

export default function StoreInventory({ productId }: { productId: string }) {
  const { store } = useStore();
  const [locations, setLocations] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store?.slug || !productId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_product_stock_by_location", {
        p_slug: store.slug,
        p_product_id: productId,
      });
      if (rpcErr) throw rpcErr;
      setLocations((data ?? []) as unknown as LocationStock[]);
      setLastUpdate(new Date().toISOString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el stock por ubicación");
    } finally {
      setLoading(false);
    }
  }, [store?.slug, productId]);

  useEffect(() => { load(); }, [load]);

  // Suscripción realtime: cuando cambia stock en POS o storefront, actualiza.
  useEffect(() => {
    if (!store?.slug || !productId) return;
    const channel = safeChannel(`stock-by-location:${store.slug}:${productId}`, "StoreInventory");
    const subscription = channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "product_stock_by_location",
        filter: `product_id=eq.${productId}`,
      }, (payload) => {
        const row = (payload.new ?? payload.old) as LocationStock | null;
        if (!row) return;
        setLocations((prev) => {
          const exists = prev.find((l) => l.location_id === row.location_id);
          if (exists) {
            return prev.map((l) => (l.location_id === row.location_id ? row : l));
          }
          return [...prev, row];
        });
        setLastUpdate(new Date().toISOString());
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // subscription ready; no-op
        }
      });
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [store?.slug, productId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>Cargando stock por ubicación...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border" role="alert" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
        No hay ubicaciones configuradas para este producto.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Stock por ubicación</h3>
        {lastUpdate && (
          <span className="text-[10px]" style={{ color: "hsl(var(--st-muted))" }}>
            Actualizado: {new Date(lastUpdate).toLocaleTimeString("es-AR")}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border" style={{ borderColor: "hsl(var(--st-border))" }}>
          <thead>
            <tr className="text-left">
              <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Ubicación</th>
              <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Disponible</th>
              <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Reservado</th>
              <th className="px-3 py-2 font-medium" style={{ color: "hsl(var(--st-muted))" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((loc) => (
              <tr key={loc.location_id} className="border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
                <td className="px-3 py-2">{loc.location_name}</td>
                <td className="px-3 py-2 tabular-nums">{loc.available}</td>
                <td className="px-3 py-2 tabular-nums">{loc.reserved}</td>
                <td className="px-3 py-2 tabular-nums">{loc.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}