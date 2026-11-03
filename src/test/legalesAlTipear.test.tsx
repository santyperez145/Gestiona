import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LegalPagesPanel from "@/components/ecommerce/LegalPagesPanel";

vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ orgId: "zz-org" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "update", "insert"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

/**
 * El formulario legal desaparecía al tipear la primera letra del último campo
 * vacío: el comercio quedaba con «h» como email publicado (2026-11-03).
 * Playwright llena cada campo de una vez y no lo veía; acá se tipea letra por
 * letra, como una persona.
 */
const tipear = (campo: HTMLElement, texto: string) => {
  let valor = "";
  for (const letra of texto) {
    valor += letra;
    fireEvent.change(campo, { target: { value: valor } });
  }
};

describe("términos y privacidad al tipear", () => {
  it("los campos siguen en pantalla hasta terminar de escribir y el botón espera datos válidos", async () => {
    render(<LegalPagesPanel storeId="zz-tienda" existentes={[]} onAplicado={() => undefined} />);
    tipear(await screen.findByLabelText("Razón social o tu nombre"), "ZZ Tienda SRL");
    tipear(screen.getByLabelText("CUIT"), "30-71234567-1");
    tipear(screen.getByLabelText("Domicilio comercial"), "Av. Corrientes 1234");
    tipear(screen.getByLabelText("Email de contacto"), "hola@zz.com");

    expect((screen.getByLabelText("Email de contacto") as HTMLInputElement).value).toBe("hola@zz.com");
    expect((screen.getByRole("button", { name: "Generar los textos legales" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("no genera con un CUIT de dígito verificador inválido ni con un email sin dominio", async () => {
    render(<LegalPagesPanel storeId="zz-tienda" existentes={[]} onAplicado={() => undefined} />);
    tipear(await screen.findByLabelText("Razón social o tu nombre"), "ZZ Tienda SRL");
    tipear(screen.getByLabelText("CUIT"), "30-71234567-8");
    tipear(screen.getByLabelText("Domicilio comercial"), "Av. Corrientes 1234");
    tipear(screen.getByLabelText("Email de contacto"), "hola@zz");

    expect(screen.getByText(/El CUIT no es válido/)).toBeTruthy();
    expect(screen.getByText(/Revisá el email/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generar los textos legales" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("con los borradores escritos, publicar espera que el comercio confirme que los leyó", () => {
    const borrador = (slug: string, title: string) => ({ slug, title, content: "Texto propio del comercio, completo.", status: "draft" });
    render(<LegalPagesPanel storeId="zz-tienda" onAplicado={() => undefined} onAbrirPagina={() => undefined}
      existentes={[borrador("politica-de-privacidad", "Política de privacidad"), borrador("terminos-y-condiciones", "Términos y condiciones")]} />);
    return screen.findByRole("button", { name: "Publicar términos y privacidad" }).then(publicar => {
      expect((publicar as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("checkbox", { name: /Leí los textos/ }));
      expect((publicar as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole("button", { name: "Leer Política de privacidad" })).toBeTruthy();
    });
  });
});
