/**
 * StorefrontPage — la tienda online en `/tienda/:slug`.
 *
 * Es una tienda de verdad, no el catálogo con otro nombre: home con hero y
 * secciones, listado con filtros, ficha de producto con perfil olfativo,
 * carrito persistente y checkout que crea una orden real en
 * `ecommerce_orders`. El catálogo (`/catalogo/:userId`) sigue existiendo como
 * vidriera rápida para mandar por WhatsApp.
 *
 * El tema, los colores, los métodos de pago y el SEO salen del panel
 * "Tienda Online", que hasta ahora configuraba una vitrina inexistente.
 */
import { useEffect } from "react";
import { Link, Route, Routes, useParams, useLocation } from "react-router-dom";
import { StoreProvider, useStore } from "@/storefront/storeContext";
import StoreLayout from "@/storefront/StoreLayout";
import StoreHome from "@/storefront/StoreHome";
import StoreProducts from "@/storefront/StoreProducts";
import StoreProduct from "@/storefront/StoreProduct";
import StoreCheckout from "@/storefront/StoreCheckout";
import StorePage from "@/storefront/StorePage";
import StoreOrder from "@/storefront/StoreOrder";
import StoreAccount from "@/storefront/StoreAccount";
import StoreCartRecovery from "@/storefront/StoreCartRecovery";
import StoreArrepentimiento from "@/storefront/StoreArrepentimiento";
import { StoreAuthProvider } from "@/storefront/storeAuth";
import { WishlistProvider } from "@/storefront/wishlist";
import StorefrontSkeleton from "@/storefront/StorefrontSkeleton";
import { Store } from "lucide-react";
import { initTracking, trackPageView } from "@/storefront/tracking";

function StoreShell() {
  const { loading, notFound, store } = useStore();
  const { slug } = useParams<{ slug: string }>();
  const { pathname } = useLocation();

  // Píxeles: se inicializan una vez, en cuanto se conoce la tienda.
  useEffect(() => {
    if (!store) return;
    initTracking({
      metaPixelId: store.meta_pixel_id,
      gaMeasurementId: store.ga_measurement_id,
      tiktokPixelId: store.tiktok_pixel_id,
    });
  }, [store]);

  // En una SPA el cambio de ruta no dispara PageView solo.
  useEffect(() => { if (store) trackPageView(); }, [pathname, store]);

  // SEO: el panel deja configurar meta title y description.
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
    return <StorefrontSkeleton />;
  }

  if (notFound || !store) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
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
    <StoreLayout>
      <Routes>
        <Route index element={<StoreHome />} />
        <Route path="productos" element={<StoreProducts />} />
        <Route path="producto/:productId" element={<StoreProduct />} />
        <Route path="checkout" element={<StoreCheckout />} />
        <Route path="orden/:orderNumber" element={<StoreOrder />} />
        <Route path="cuenta" element={<StoreAccount />} />
        <Route path="carrito/:token" element={<StoreCartRecovery />} />
        <Route path="pagina/:pageSlug" element={<StorePage />} />
        {/* Res. 424/2020: el botón de arrepentimiento va accesible desde la
            primera pantalla. El link vive en la barra de arriba del header. */}
        <Route path="arrepentimiento" element={<StoreArrepentimiento />} />
        <Route path="*" element={<StoreHome />} />
      </Routes>
    </StoreLayout>
  );
}

export default function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return null;
  return (
    <StoreProvider slug={slug}>
      <StoreAuthProvider slug={slug}>
        <WishlistProvider slug={slug}>
          <StoreShell />
        </WishlistProvider>
      </StoreAuthProvider>
    </StoreProvider>
  );
}
