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
import { useEffect, useMemo, useState } from "react";
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
import StoreCart from "@/storefront/StoreCart";
import StoreArrepentimiento from "@/storefront/StoreArrepentimiento";
import StoreOrderLookup from "@/storefront/StoreOrderLookup";
import StoreLegacyRedirect from "@/storefront/StoreLegacyRedirect";
import { StoreAuthProvider } from "@/storefront/storeAuth";
import { WishlistProvider } from "@/storefront/wishlist";
import StorefrontSkeleton from "@/storefront/StorefrontSkeleton";
import StorefrontStatus from "@/storefront/StorefrontStatus";
import {
  deactivateTracking,
  initTracking,
  isSensitiveStorefrontTrackingPath,
  trackPageView,
} from "@/storefront/tracking";
import {
  StoreTrackingConsentProvider,
  StoreTrackingRuntimeProvider,
  useStoreTrackingConsent,
} from "@/storefront/trackingConsent";
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

function PreviewCheckoutBlocked({ basePath }: { basePath: string }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--st-muted))" }}>
        Vista previa
      </p>
      <h1 className="mt-2 text-2xl font-semibold">El checkout está desactivado</h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: "hsl(var(--st-muted))" }}>
        Podés recorrer el catálogo y probar el carrito. Publicá el diseño para habilitar una compra real.
      </p>
      <Link
        to={basePath || "/"}
        className="mt-6 inline-flex min-h-11 items-center justify-center px-5 font-semibold"
        style={{
          borderRadius: "var(--st-radius)",
          background: "hsl(var(--st-accent))",
          color: "hsl(var(--st-accent-fg))",
        }}
      >
        Volver a la tienda
      </Link>
    </section>
  );
}

function StoreShell({ expectedSlug, previewMode }: { expectedSlug: string; previewMode: boolean }) {
  const { basePath, loading, notFound, loadError, store, products, pages, categorias, reload } = useStore();
  const { pathname, search } = useLocation();
  const { decision: trackingConsent } = useStoreTrackingConsent();
  const trackingKey = useMemo(() => {
    if (previewMode || !store || store.slug !== expectedSlug || trackingConsent !== "granted") return null;
    const ids = [
      store.meta_pixel_id?.trim() || null,
      store.ga_measurement_id?.trim() || null,
      store.tiktok_pixel_id?.trim() || null,
    ];
    if (!ids.some(Boolean)) return null;
    return JSON.stringify([
      store.slug,
      ...ids,
    ]);
  }, [expectedSlug, previewMode, store, trackingConsent]);
  const [activeTrackingKey, setActiveTrackingKey] = useState<string | null>(null);
  const trackingRuntimeReady = trackingKey !== null && trackingKey === activeTrackingKey;

  // Píxeles externos: sólo después de una decisión afirmativa de esta tienda.
  // Cambiar de merchant desactiva el destino anterior antes de inicializar el
  // siguiente, para no mezclar tráfico entre organizaciones en la misma SPA.
  useEffect(() => {
    deactivateTracking();
    setActiveTrackingKey(null);
    if (!store || !trackingKey) return;
    initTracking({
      metaPixelId: store.meta_pixel_id,
      gaMeasurementId: store.ga_measurement_id,
      tiktokPixelId: store.tiktok_pixel_id,
    });
    setActiveTrackingKey(trackingKey);
    return () => deactivateTracking();
  }, [store, trackingKey]);

  // En una SPA el cambio de ruta no dispara PageView solo.
  useEffect(() => {
    if (store && trackingRuntimeReady && !isSensitiveStorefrontTrackingPath(pathname)) trackPageView();
  }, [pathname, search, store, trackingRuntimeReady]);

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
    if (previewMode || canonicalPath === null) {
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
  }, [store, basePath, pathname, search, products, pages, categorias, previewMode]);

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
    <StoreTrackingRuntimeProvider ready={trackingRuntimeReady}>
      <StoreLayout>
        {previewMode ? (
          <aside
            role="status"
            className="sticky top-16 z-30 border-b px-4 py-2.5 text-sm"
            style={{
              borderColor: "hsl(var(--st-border))",
              background: "hsl(var(--st-text))",
              color: "hsl(var(--st-bg))",
            }}
          >
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
              <span><strong>Vista previa.</strong> Estos cambios todavía no están publicados.</span>
              <a className="font-semibold underline underline-offset-4" href="/tienda-online?tab=design">
                Volver al editor
              </a>
            </div>
          </aside>
        ) : null}
        <Routes>
        <Route index element={<StoreHome />} />
        <Route path="productos" element={<StoreProducts />} />
        <Route path="producto/:productId" element={<StoreProduct />} />
        <Route
          path="checkout"
          element={previewMode ? <PreviewCheckoutBlocked basePath={basePath} /> : <StoreCheckout />}
        />
        <Route path="carrito" element={<StoreCart />} />
        <Route path="orden/:orderNumber" element={<StoreOrder />} />
        <Route path="seguimiento" element={<StoreOrderLookup />} />
        <Route path="cuenta" element={<StoreAccount />} />
        <Route path="carrito/:token" element={<StoreCartRecovery />} />
        <Route path="pagina/:pageSlug" element={<StorePage />} />
        {/* Res. 424/2020: el botón de arrepentimiento va accesible desde la
            primera pantalla. El link vive en la barra de arriba del header. */}
        <Route path="arrepentimiento" element={<StoreArrepentimiento />} />
        <Route path="*" element={<StoreLegacyRedirect disabled={previewMode} />} />
        </Routes>
      </StoreLayout>
    </StoreTrackingRuntimeProvider>
  );
}

export default function StorefrontPage({
  hostedSlug,
  basePath,
  preview = false,
}: {
  hostedSlug?: string;
  basePath?: string;
  preview?: boolean;
} = {}) {
  const { slug: routeSlug, previewVersionId } = useParams<{ slug: string; previewVersionId: string }>();
  const slug = hostedSlug ?? routeSlug;
  if (!slug) return null;
  const activePreviewId = preview ? previewVersionId : undefined;
  const resolvedBasePath = activePreviewId
    ? `/tienda/${encodeURIComponent(slug)}/vista-previa/${encodeURIComponent(activePreviewId)}`
    : basePath;
  return (
    <StoreTrackingConsentProvider slug={slug} disabled={Boolean(activePreviewId)}>
      <StoreAuthProvider slug={slug} basePath={resolvedBasePath}>
        <StoreProvider slug={slug} basePath={resolvedBasePath} previewVersionId={activePreviewId}>
          <WishlistProvider slug={slug}>
            <StoreShell expectedSlug={slug} previewMode={Boolean(activePreviewId)} />
          </WishlistProvider>
        </StoreProvider>
      </StoreAuthProvider>
    </StoreTrackingConsentProvider>
  );
}
