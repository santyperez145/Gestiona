import { describe, expect, it } from "vitest";
import { applyMarketingTemplate, withMarketingUnsubscribe } from "../../supabase/functions/_shared/marketingEmail.ts";

describe("contenido de campañas y secuencias", () => {
  it("personaliza ambos formatos con los datos del destinatario", () => {
    expect(applyMarketingTemplate("Hola {{ NOMBRE }}, {name}", { nombre: "Ana", name: "Ana" }))
      .toBe("Hola Ana, Ana");
  });

  it("los nombres no introducen otras variables ni secuencias de reemplazo", () => {
    expect(applyMarketingTemplate("Hola {{nombre}}, de {{business}}", {
      nombre: "$& {{business}}", business: "Nerqia",
    })).toBe("Hola $& {{business}}, de Nerqia");
  });

  it("escapa los valores HTML sin modificar el formato de la plantilla", () => {
    expect(applyMarketingTemplate('<p>{{nombre}}</p><a href="{{unsubscribe_url}}">Baja</a>', {
      nombre: '<img src=x onerror="alert(1)">',
      unsubscribe_url: "https://example.com/?token=abc&source=email",
    }, true)).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p><a href="https://example.com/?token=abc&amp;source=email">Baja</a>');
  });

  it("preserva variables desconocidas sin leer propiedades del prototipo", () => {
    expect(applyMarketingTemplate("{{toString}} {{faltante}}", {})).toBe("{{toString}} {{faltante}}");
  });

  it("incluye una baja visible aunque la plantilla tenga un enlace oculto", () => {
    const html = withMarketingUnsubscribe('<body><a hidden href="https://example.com/baja">Baja</a></body>', "https://example.com/baja");
    expect(html).toContain('>Cancelar suscripción</a>');
    expect(html.indexOf("Cancelar suscripción")).toBeLessThan(html.indexOf("</body>"));
  });

  it("el pie identifica al comercio sin interpolar HTML ni reemplazos", () => {
    const html = withMarketingUnsubscribe("<p>Novedades</p>", "https://example.com/baja", "<Comercio> $&");
    expect(html).toContain("&lt;Comercio&gt; $&amp;");
    expect(html).toContain("Cancelar suscripción");
  });
});
