/**
 * StorefrontPage — la vitrina pública en `/tienda/:slug`.
 *
 * El panel "Tienda Online" venía guardando nombre, tema, colores, métodos de
 * pago y SEO para una tienda que no existía: no había ruta `/tienda/:slug` en
 * ningún lado y el botón "Ver tienda" apuntaba a un dominio hardcodeado que no
 * resuelve.
 *
 * En vez de escribir una segunda vitrina, esta página resuelve el slug y
 * renderiza el catálogo público —que ya tiene carrito, checkout por WhatsApp,
 * decants, combos y promociones— con la marca de la tienda encima. Mantener
 * dos vitrinas en paralelo habría sido garantía de que una quedara vieja.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PublicCatalogPage from "@/pages/PublicCatalogPage";
import { Store, Loader2 } from "lucide-react";

interface StoreRow {
  org_id: string;
  owner_user_id: string | null;
  name: string;
  description: string | null;
  slug: string;
  primary_color: string | null;
  logo_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
}

export default function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const [store, setStore] = useState<StoreRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    let cancelled = false;
    supabase
      .rpc("get_store_by_slug", { p_slug: slug })
      .then(({ data }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setStore((row as StoreRow) ?? null);
        setLoading(false);
      }, () => { if (!cancelled) { setStore(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [slug]);

  // SEO: el panel deja configurar meta title/description, así que se usan.
  useEffect(() => {
    if (!store) return;
    document.title = store.meta_title || `${store.name} — Tienda online`;
    if (store.meta_description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", "description");
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", store.meta_description);
    }
  }, [store]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!store || !store.owner_user_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Store className="w-5 h-5 text-muted-foreground" />
          </div>
          <h1 className="text-base font-semibold mb-1">Tienda no encontrada</h1>
          <p className="text-sm text-muted-foreground mb-4">
            No hay ninguna tienda activa en <span className="font-mono">/tienda/{slug}</span>.
            Puede que la dirección haya cambiado o que la tienda esté desactivada.
          </p>
          <Link to="/" className="text-sm text-primary hover:underline">Ir al inicio</Link>
        </div>
      </div>
    );
  }

  return (
    <PublicCatalogPage
      overrideUserId={store.owner_user_id}
      storeBranding={{
        name: store.name,
        primary_color: store.primary_color,
        logo_url: store.logo_url,
      }}
    />
  );
}
