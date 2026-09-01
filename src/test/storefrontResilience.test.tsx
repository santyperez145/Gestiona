import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import StorefrontStatus from "@/storefront/StorefrontStatus";

const leer = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * D5.10: una red lenta no es un 404.
 *
 * Medido en el código: `get_store_by_slug` con Failed to fetch pintaba
 * «Tienda no encontrada». El catálogo con el mismo corte devolvía `[]` y la
 * home decía 0 productos. El comprador se iba; el carrito seguía en
 * localStorage sin que nadie lo supiera.
 */
describe("la vitrina distingue 404 de red caída", () => {
  it("el error invita a reintentar y el 404 no", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <StorefrontStatus kind="error" storeName="Exentry Imports" onRetry={retry} />,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-storefront-state", "error");
    expect(screen.getByRole("heading")).toHaveTextContent("No pudimos cargar Exentry Imports");
    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Tienda no encontrada")).toBeNull();

    rerender(<StorefrontStatus kind="not-found" slug="no-existe" />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-storefront-state", "not-found");
    expect(screen.getByRole("heading")).toHaveTextContent("Tienda no encontrada");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("no usa chrome del SaaS ni confunde error con notFound", () => {
    const pagina = leer("src/pages/StorefrontPage.tsx");
    const ctx = leer("src/storefront/storeContext.tsx");
    const estado = leer("src/storefront/StorefrontStatus.tsx");

    expect(pagina).toContain("if (loadError)");
    expect(pagina).toContain("<StorefrontStatus");
    expect(pagina).not.toContain("bg-background");
    expect(estado).not.toContain("bg-background");
    expect(estado).toContain("min-h-11");

    expect(ctx).toContain("setLoadError(true)");
    expect(ctx).toContain("if (!pRes.ok)");
    expect(ctx).not.toMatch(/storeResponse\.error[\s\S]{0,80}setNotFound\(true\)/);
  });
});
