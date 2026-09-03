/**
 * StorefrontPage — una sola tienda para `/tienda/:slug` y `slug.nerqia.app`.
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
import { Route, Routes, useParams, useLocation } from "react-router-dom";
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
import StoreCart from "@/storefront/StoreCart";
import StoreArrepentimiento from "@/storefront/StoreArrepentimiento";
import StoreOrderLookup from "@/storefront/StoreOrderLookup";
import { StoreAuthProvider } from "@/storefront/storeAuth";
import { WishlistProvider } from "@/storefront/wishlist";
import StorefrontSkeleton from "@/storefront/StorefrontSkeleton";
import StorefrontStatus from "@/storefront/StorefrontStatus";
import { initTracking, trackPageView } from "@/storefront/tracking";
import { canonicalStorefrontPath, parseRutaTienda, tituloDeRutaTienda } from "@/lib/storefrontSeo";
import { nombreDeCategoria } from "@/lib/storeCategories";
import { hostedStoreUrl } from "@/lib/storefrontHost";

function tituloPrivadoDeRuta(pathname: string): string | null {
  if (pathname.includes("/checkout")) return "Checkout";
  if (pathname.includes("/carrito") && !pathname.includes("/carrito/")) return "Carrito";
  if (pathname.includes("/cuenta")) return "Mi cuenta";
  if (pathname.includes("/seguimiento")) return "Consultar pedido";
  if (pathname.includes("/orden/")) return "Pedido";
  return null;
}

function StoreShell() {
  const { basePath, loading, notFound, loadError, store, products, pages, categorias, reload } = useStore();
  const { pathname, search } = useLocation();

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

  // Título de la pestaña por ruta. WhatsApp/Google no ejecutan JS — eso es
  // `api/og`. Acá es lo que ve el comprador al cambiar de ficha.
  useEffect(() => {
    if (!store) return;
    const ruta = parseRutaTienda(
      pathname,
      new URLSearchParams(search),
      basePath === '' ? store?.slug : null,
    );
    const productName = ruta?.kind === "pdp"
      ? products.find(p => p.id === ruta.productId)?.name ?? null
      : null;
    const categoryLabel = ruta?.kind === "plp" && ruta.cat
      ? nombreDeCategoria(ruta.cat, categorias)
      : null;
    const pageTitle = ruta?.kind === "page"
      ? pages.find(p => p.slug === ruta.pageSlug)?.title ?? null
      : tituloPrivadoDeRuta(pathname);
    document.title = tituloDeRutaTienda({
      ruta,
      storeName: store.name,
      metaTitle: store.meta_title,
      productName,
      categoryLabel,
      pageTitle,
    });

    const hostedHome = hostedStoreUrl(window.location.origin, store.slug);
    const canonicalHome = hostedHome ?? `${window.location.origin}${basePath}`;
    const canonicalPath = canonicalStorefrontPath(ruta);
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalPath === null ? canonicalHome : `${canonicalHome}${canonicalPath}`;

    const previousRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"][data-storefront]');
    if (canonicalPath === null) {
      const robots = previousRobots ?? document.createElement("meta");
      robots.name = "robots";
      robots.content = "noindex,nofollow";
      robots.dataset.storefront = "true";
      if (!previousRobots) document.head.appendChild(robots);
    } else {
      previousRobots?.remove();
    }
    if (store.meta_description && (!ruta || ruta.kind === "home")) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", "description");
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", store.meta_description);
    }
  }, [store, basePath, pathname, search, products, pages, categorias]);

  if (loading) {
    return <StorefrontSkeleton />;
  }

  if (loadError) {
    return (
      <StorefrontStatus
        kind="error"
        storeName={store?.name}
        onRetry={reload}
      />
    );
  }

  if (notFound || !store) {
    return <StorefrontStatus kind="not-found" />;
  }

  return (
    <StoreLayout>
      <Routes>
        <Route index element={<StoreHome />} />
        <Route path="productos" element={<StoreProducts />} />
        <Route path="producto/:productId" element={<StoreProduct />} />
        <Route path="checkout" element={<StoreCheckout />} />
        <Route path="carrito" element={<StoreCart />} />
        <Route path="orden/:orderNumber" element={<StoreOrder />} />
        <Route path="seguimiento" element={<StoreOrderLookup />} />
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

export default function StorefrontPage({
  hostedSlug,
  basePath,
}: {
  hostedSlug?: string;
  basePath?: string;
} = {}) {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const slug = hostedSlug ?? routeSlug;
  if (!slug) return null;
  return (
    <StoreAuthProvider slug={slug} basePath={basePath}>
      <StoreProvider slug={slug} basePath={basePath}>
        <WishlistProvider slug={slug}>
          <StoreShell />
        </WishlistProvider>
      </StoreProvider>
    </StoreAuthProvider>
  );
}
