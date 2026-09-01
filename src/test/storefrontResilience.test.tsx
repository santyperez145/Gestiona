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

  it("acepta un título propio sin volver al 404 de tienda", () => {
    render(
      <StorefrontStatus
        kind="error"
        title="No pudimos cargar tu pedido"
        detail="La red falló. Reintentá."
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("No pudimos cargar tu pedido");
    expect(screen.queryByText("Tienda no encontrada")).toBeNull();
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

/**
 * D5.11: el seguimiento, el carrito recuperado, la cuenta y el link de
 * pago tampoco convierten un corte de red en «no existe».
 *
 * Pedirle el email a quien ya pagó, o decirle que el carrito se venció,
 * es la misma mentira de D5.10 un paso más adelante en el recorrido.
 */
describe("después de comprar, una red lenta no es un pedido inexistente", () => {
  it("el pedido no pide email ni borra la ficha cuando falla la red", () => {
    const pedido = leer("src/storefront/StoreOrder.tsx");
    expect(pedido).toContain('data-storefront-state="order-error"');
    expect(pedido).toContain("No pudimos cargar tu pedido");
    expect(pedido).toContain("if (orderRef.current)");
    expect(pedido).not.toMatch(/if \(!found\) setAccesoError\("No pudimos verificar esos datos/);
    expect(pedido).toContain("mensajeDeEdgeFunction");
  });

  it("recuperar el carrito distingue link vencido de corte de red", () => {
    const carrito = leer("src/storefront/StoreCartRecovery.tsx");
    expect(carrito).toContain("retryPublicRead");
    expect(carrito).toContain('data-storefront-state={state}');
    expect(carrito).toContain("cart-error");
    expect(carrito).toContain("cart-catalog-error");
    expect(carrito).not.toMatch(/const \{ data \} = await supabase\.rpc\("get_cart_by_recovery_token"/);
  });

  it("la cuenta no dice «sin pedidos» cuando no pudo leerlos", () => {
    const cuenta = leer("src/storefront/StoreAccount.tsx");
    expect(cuenta).toContain("errorPedidos");
    expect(cuenta).toContain("account-orders-error");
    expect(cuenta).toContain("No pudimos cargar tus pedidos");
    expect(cuenta).not.toMatch(/\.then\(\(\{ data \}\) => \{\s*setPedidos\(\(data \?\? \[\]\)/);
  });

  it("el link de pago no pinta 404 si el poll o la carga fallan", () => {
    const pago = leer("src/pages/PublicPaymentPage.tsx");
    expect(pago).toContain("loadError");
    expect(pago).toContain('data-payment-state="error"');
    expect(pago).toContain("if (!lectura.ok)");
    expect(pago).toContain("if (!silent)");
    expect(pago).not.toMatch(/if \(!row\) \{ setNotFound\(true\)/);
  });
});
