import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ImageUpload from "@/components/shared/ImageUpload";
import StoreBanners from "@/storefront/StoreBanners";
import { mostrarImagenValida, ocultarImagenRota } from "@/storefront/mediaFallback";

describe("resiliencia de imágenes públicas", () => {
  it("oculta un activo roto y permite recuperarlo cuando vuelve a cargar", () => {
    const image = document.createElement("img");

    ocultarImagenRota({ currentTarget: image } as never);
    expect(image).not.toBeVisible();
    expect(image).toHaveAttribute("data-media-state", "error");

    mostrarImagenValida({ currentTarget: image } as never);
    expect(image.hidden).toBe(false);
    expect(image).toHaveAttribute("data-media-state", "ready");
  });

  it("mantiene el mensaje y la acción del banner sobre un fallback de marca", () => {
    render(
      <MemoryRouter>
        <StoreBanners
          base="/tienda/demo"
          storeName="Comercio Demo"
          banners={[{
            id: "banner-1",
            image_url: "https://example.invalid/banner.jpg",
            image_url_mobile: null,
            title: "Nueva colección",
            subtitle: "Ya disponible",
            link_url: "/productos",
            cta_label: "Comprar",
            alt_text: "Colección",
            sort_order: 0,
          }]}
        />
      </MemoryRouter>,
    );

    const image = screen.getByRole("img", { name: "Colección" });
    fireEvent.error(image);

    expect(image).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Nueva colección" })).toBeVisible();
    expect(screen.getByText("Ya disponible")).toBeVisible();
    expect(screen.getByText("Comprar")).toBeVisible();
  });

  it("expone la URL inválida en Gestión y notifica su validez", () => {
    const onValidityChange = vi.fn();
    const { container } = render(
      <ImageUpload
        value="https://example.invalid/banner.jpg"
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
        orgId="org-test"
      />,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);

    expect(screen.getByRole("alert")).toHaveTextContent("La imagen guardada ya no responde");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });
});
