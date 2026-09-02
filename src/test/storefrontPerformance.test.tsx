import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import StorefrontSkeleton from "@/storefront/StorefrontSkeleton";
import {
  atributosDeImagenVitrina,
  TAMANO_IMAGEN_VITRINA,
} from "@/storefront/mediaFallback";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * D5.8: la vitrina no puede nacer como un spinner del panel.
 *
 * El salto de layout más caro era el de carga: `bg-background` + Loader2, y
 * después header, banner y grilla aparecían juntos. El esqueleto reserva esa
 * geometría con tokens `--st-*`, no con el violeta del SaaS. Las fotos
 * declaran proporción y `sizes` para que el hueco `aspect-*` no dependa de
 * que el archivo haya llegado.
 */
describe("performance visual de la vitrina", () => {
  it("el LCP pide prioridad y el resto espera", () => {
    const lcp = atributosDeImagenVitrina("banner", { lcp: true });
    expect(lcp.fetchpriority).toBe("high");
    expect(lcp.loading).toBe("eager");
    expect(lcp.decoding).toBe("async");
    expect(lcp.sizes).toBe("100vw");
    expect(lcp.width).toBe(TAMANO_IMAGEN_VITRINA.banner.width);
    expect(lcp.height).toBe(TAMANO_IMAGEN_VITRINA.banner.height);

    const tarjeta = atributosDeImagenVitrina("tarjeta");
    expect(tarjeta.loading).toBe("lazy");
    expect(tarjeta.fetchpriority).toBe("auto");
    expect(tarjeta.width / tarjeta.height).toBe(1);
  });

  it("la carga reserva banner, header y ocho tarjetas cuadradas", () => {
    const { container } = render(<StorefrontSkeleton />);
    const root = container.querySelector("[data-storefront-state='loading']");
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando la tienda");
    expect(root!.querySelectorAll("article")).toHaveLength(8);
    expect(root!.querySelector(".aspect-square")).not.toBeNull();
    expect(root!.innerHTML).toContain("aspect-[16/7]");
    expect(root!.className).not.toContain("bg-background");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("la home, la ficha y las cards declaran tamaño y no usan el spinner del SaaS", () => {
    const pagina = leer("src/pages/StorefrontPage.tsx");
    const ficha = leer("src/storefront/StoreProductGallery.tsx");
    const banner = leer("src/storefront/StoreBanners.tsx");
    const card = leer("src/storefront/ProductCard.tsx");
    const css = leer("src/index.css");

    expect(pagina).toContain("StorefrontSkeleton");
    expect(pagina).not.toContain("Loader2");
    expect(pagina).toContain("if (loading) {\n    return <StorefrontSkeleton />;");

    expect(card).toContain('atributosDeImagenVitrina("tarjeta")');
    expect(banner).toContain('atributosDeImagenVitrina("banner", { lcp: i === 0 })');
    expect(ficha).toContain('atributosDeImagenVitrina("ficha", { lcp: imgIdx === 0 })');

    expect(css).toContain("storefront-skeleton-bone");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("storefront-skeleton-shimmer");
  });
});
