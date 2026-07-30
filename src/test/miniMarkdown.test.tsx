/**
 * El markdown de las páginas de contenido lo escribe el comercio y se sirve
 * desde el dominio de su tienda, con la sesión del comprador viva. Un `<script>`
 * que llegue a ejecutarse ahí es un XSS con el carrito y la cuenta del otro
 * lado, así que la falta de HTML crudo es un invariante, no un detalle.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "@/storefront/miniMarkdown";

const html = (md: string) => renderToStaticMarkup(<>{renderMarkdown(md)}</>);

describe("miniMarkdown", () => {
  it("no deja pasar HTML del comercio: lo escapa como texto", () => {
    const out = html('<script>alert(1)</script><img src=x onerror="alert(2)">');
    // Lo que importa es que no salga ninguna etiqueta viva. La palabra
    // "onerror" puede aparecer, pero escapada y dentro de un párrafo: es
    // texto que se lee, no un atributo que el navegador ejecute.
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain('onerror="');
    expect(out).toContain("&lt;script&gt;");
  });

  it("ignora links que no sean http/https", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
  });

  it("arma links externos con rel de seguridad", () => {
    const out = html("Escribinos por [Instagram](https://instagram.com/tienda)");
    expect(out).toContain('href="https://instagram.com/tienda"');
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });

  it("convierte encabezados y negrita", () => {
    const out = html("## Cambios\nTenés **10 días** para arrepentirte.");
    expect(out).toContain("<h2");
    expect(out).toContain("<strong>10 días</strong>");
  });

  it("agrupa líneas con guion en una sola lista", () => {
    const out = html("- Uno\n- Dos\n- Tres");
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li/g)).toHaveLength(3);
  });

  it("cierra la lista al volver a texto suelto", () => {
    const out = html("- Uno\n\nDespués un párrafo\n\n- Otra lista");
    expect(out.match(/<ul/g)).toHaveLength(2);
    expect(out).toContain("<p");
  });

  it("tolera contenido vacío sin romper", () => {
    expect(html("")).toBe("");
    expect(renderMarkdown(undefined as unknown as string)).toEqual([]);
  });
});
