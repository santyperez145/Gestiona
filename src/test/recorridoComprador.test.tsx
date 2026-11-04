/**
 * Recorrido del comprador (2026-11-04): lo que se vio mal en las capturas de
 * la tienda nueva — portada, checkout, página de gracias y seguimiento.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import CodigoPersonalizado from "@/storefront/CodigoPersonalizado";
import { parseStorefrontLayout } from "@/lib/storeHomeLayout";
import {
  PASO_ESPERANDO_PAGO,
  canalComprobante,
  contactoDeLaTienda,
  emailContactoTienda,
  enlaceMailComprobante,
  enlaceMailPedido,
  enlaceWhatsAppPedido,
  fechaSeguimiento,
  importeParaCopiar,
  importeVisibleTransferencia,
  indicePasoSeguimiento,
  introPedidoSinPagar,
  pasosSeguimiento,
  textoWhatsAppPedido,
} from "@/lib/storeOrderBuyerCopy";

const fuente = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), "utf8");

describe("portada: el bloque «Código personalizado» no llega al comprador", () => {
  it("con el layout por defecto (bloque prendido) no renderiza nada", () => {
    const layout = parseStorefrontLayout(null);
    expect(layout.sections.find((s) => s.id === "codigo")?.enabled).toBe(true);
    const { container } = render(<CodigoPersonalizado layout={layout} />);
    expect(container.innerHTML).toBe("");
  });

  it("el texto del editor ya no existe y el bloque no se monta dos veces", () => {
    const codigo = fuente("src/storefront/CodigoPersonalizado.tsx");
    expect(codigo).not.toContain("Agrega HTML");
    expect(codigo).not.toMatch(/<h2[^>]*>Código personalizado/);
    const home = fuente("src/storefront/StoreHome.tsx");
    expect(home.match(/<CodigoPersonalizado/g)?.length).toBe(1);
  });
});

describe("gracias: WhatsApp al número del comercio, nunca sin destino", () => {
  it("con WhatsApp cargado arma wa.me/<número>?text=", () => {
    const href = enlaceWhatsAppPedido({ whatsapp: "https://wa.me/5491112345678" }, "Hola! pedido A-1");
    expect(href).toBe(`https://wa.me/5491112345678?text=${encodeURIComponent("Hola! pedido A-1")}`);
  });

  it("sin WhatsApp (o con basura) no hay enlace", () => {
    expect(enlaceWhatsAppPedido({}, "x")).toBeNull();
    expect(enlaceWhatsAppPedido(null, "x")).toBeNull();
    expect(enlaceWhatsAppPedido({ whatsapp: "javascript:alert(1)" }, "x")).toBeNull();
  });

  it("la página ya no arma wa.me/?text= y el botón depende del enlace", () => {
    const pagina = fuente("src/storefront/StoreOrder.tsx");
    expect(pagina).not.toContain("https://wa.me/?text=");
    expect(pagina).toContain("{waPedido && (");
  });

  it("el mensaje de transferencia menciona el comprobante", () => {
    const t = textoWhatsAppPedido({
      orderNumber: "A-1", totalFmt: "$ 12.500", esRetiro: true,
      pagado: false, pagoRevertido: false, transferenciaPendiente: true,
    });
    expect(t).toMatch(/comprobante/);
    expect(t).toContain("A-1");
  });

  it("los pasos de la transferencia piden la referencia y el comprobante", () => {
    const pagina = fuente("src/storefront/StoreOrder.tsx");
    expect(pagina).toContain('<CopyField label="Referencia" value={order.order_number} />');
    expect(pagina).toContain("Mandale el comprobante al comercio por WhatsApp");
  });
});

describe("gracias: sin WhatsApp no se promete que el comercio escriba", () => {
  it("el comprobante va al mail del comercio con el número de pedido en el asunto", () => {
    const href = enlaceMailComprobante("ventas@tienda.com.ar", "0042");
    expect(href).toBe(
      `mailto:ventas@tienda.com.ar?subject=${encodeURIComponent("Comprobante del pedido 0042")}`
      + `&body=${encodeURIComponent("Hola! Te mando el comprobante de la transferencia del pedido 0042.")}`,
    );
    expect(enlaceMailPedido("ventas@tienda.com.ar", "0042"))
      .toBe(`mailto:ventas@tienda.com.ar?subject=${encodeURIComponent("Pedido 0042")}`);
  });

  it("un mail con basura no arma mailto (no se cuelan destinatarios ni encabezados)", () => {
    expect(emailContactoTienda({ email: "a@b.com?bcc=x@y.com" })).toBeNull();
    expect(emailContactoTienda({ email: "a@b.com,otro@c.com" })).toBeNull();
    expect(emailContactoTienda({ email: "a@b.com\r\nBcc: x@y.com" })).toBeNull();
    expect(emailContactoTienda({ email: "javascript:alert(1)" })).toBeNull();
    expect(emailContactoTienda({ email: "sin-arroba" })).toBeNull();
    expect(emailContactoTienda({ email: 42 })).toBeNull();
    expect(emailContactoTienda(null)).toBeNull();
    expect(emailContactoTienda({ email: " mailto:Ventas@Tienda.com " })).toBe("Ventas@Tienda.com");
    expect(enlaceMailComprobante("a@b.com?cc=x@y.com", "1")).toBeNull();
  });

  it("canal del comprobante: WhatsApp, después mail, si no guardar", () => {
    expect(canalComprobante(contactoDeLaTienda({ whatsapp: "5491112345678", email: "a@b.com" }))).toBe("whatsapp");
    expect(canalComprobante(contactoDeLaTienda({ email: "a@b.com" }))).toBe("email");
    expect(canalComprobante(contactoDeLaTienda({ instagram: "mitienda" }))).toBe("guardar");
    expect(canalComprobante(contactoDeLaTienda(null))).toBe("guardar");
  });

  it("la página ya no promete que el comercio escriba ni que se responda el mail del pedido", () => {
    const pagina = fuente("src/storefront/StoreOrder.tsx");
    expect(pagina).not.toContain("respondiendo ese mail");
    expect(pagina).not.toContain("el comercio te va a escribir");
    expect(pagina).not.toContain("Te vamos a escribir a");
    expect(pagina).toContain("Guardá el comprobante. Si el comercio te lo pide, se lo mandás.");
    expect(pagina).toContain("href={mailComprobante}");
    expect(pagina).toContain('aria-label="Contacto del comercio"');
  });

  // 2026-11-04 (ronda 3): el bloque de contacto es un landmark con nombre
  // (<section>), no un <div> con aria-label que nadie anuncia.
  it("el contacto del comercio es una <section> con nombre", () => {
    const pagina = fuente("src/storefront/StoreOrder.tsx");
    expect(pagina).toMatch(/<section[^>]*aria-label="Contacto del comercio"/);
    expect(pagina).not.toMatch(/<div[^>]*aria-label="Contacto del comercio"/);
  });

  // 2026-11-04 (ronda 3): con pago online en la misma página se pide usar el
  // botón; «escribile al comercio» queda para los medios manuales.
  it("pedido sin pagar: con pago online se usa el botón, no se manda a escribir", () => {
    expect(introPedidoSinPagar({ pagoOnline: true, hayContacto: true })).toBe("Completá el pago con el botón de abajo.");
    expect(introPedidoSinPagar({ pagoOnline: true, hayContacto: true, confirmando: true })).toBe("Estamos confirmando tu pago.");
    expect(introPedidoSinPagar({ pagoOnline: true, hayContacto: false })).toBe("Completá el pago con el botón de abajo.");
    expect(introPedidoSinPagar({ pagoOnline: false, hayContacto: true })).toMatch(/escribile al comercio \(contacto abajo\)/);
    expect(introPedidoSinPagar({ pagoOnline: false, hayContacto: false })).toMatch(/^Guardá este número de pedido/);
    expect(introPedidoSinPagar({ pagoOnline: false, hayContacto: false })).not.toMatch(/escribile/);
  });

  // 2026-11-04 (ronda 3): el comprador sigue viendo a qué mail quedó asociado
  // el pedido (los avisos del sistema salen a customer_email), también en el
  // pedido sin pagar y en el pago revertido.
  it("el mail del comprador se sigue mostrando en el pedido sin pagar y en el revertido", () => {
    const pagina = fuente("src/storefront/StoreOrder.tsx");
    const avisos = pagina.split("Los avisos del pedido te llegan a").length - 1;
    expect(avisos).toBeGreaterThanOrEqual(2);
    expect(pagina).toMatch(/introPedidoSinPagar\(\{ pagoOnline: pagoOnlineEnPagina, hayContacto, confirmando: pagoEnProceso \}\)\} Los avisos del pedido te llegan a <strong[^>]*>\{order\.customer_email\}/);
    expect(pagina).toMatch(/const pagoOnlineEnPagina = puedeReintentarPago && esMedioGestionaPay\(order\.payment_method\)/);
  });
});

describe("gracias: el importe se copia como lo acepta un banco", () => {
  it("sin signo, sin punto de miles, coma decimal sólo con centavos", () => {
    expect(importeParaCopiar(12500)).toBe("12500");
    expect(importeParaCopiar(12500.5)).toBe("12500,50");
    expect(importeParaCopiar(12500.05)).toBe("12500,05");
    expect(importeParaCopiar(1234567.891)).toBe("1234567,89");
    expect(importeParaCopiar(0)).toBe("0");
  });

  it("no arrastra el error de coma flotante", () => {
    expect(importeParaCopiar(0.1 + 0.2)).toBe("0,30");
    expect(importeParaCopiar(12499.999)).toBe("12500");
    expect(importeParaCopiar(Number.NaN)).toBe("");
  });

  it("lo que se ve coincide con lo que se copia (los centavos se muestran)", () => {
    const visible = (n: number) => importeVisibleTransferencia(n, "ARS").replace(/\s/g, " ");
    expect(visible(12500)).not.toMatch(/,/);
    expect(visible(12500)).toMatch(/12\.500$/);
    expect(visible(12500.5)).toMatch(/12\.500,50$/);
  });
});

describe("seguimiento: la transferencia pendiente es un paso propio", () => {
  it("sin el argumento nuevo, los pasos quedan como antes", () => {
    expect(pasosSeguimiento(true).map((p) => p.id)).toEqual(["pending", "processing", "shipped", "delivered"]);
    expect(indicePasoSeguimiento("delivered", true)).toBe(3);
  });

  it("con pago pendiente se intercala «Esperando tu transferencia»", () => {
    const pasos = pasosSeguimiento(true, true);
    expect(pasos[1]).toEqual({ id: PASO_ESPERANDO_PAGO, label: "Esperando tu transferencia" });
    expect(pasos).toHaveLength(5);
    expect(indicePasoSeguimiento("unfulfilled", true, true)).toBe(0);
    expect(indicePasoSeguimiento("processing", false, true)).toBe(2);
  });

  it("la fecha sale «4 de noviembre», no «04-noviembre»", () => {
    expect(fechaSeguimiento("2026-11-04")).toBe("4 de noviembre");
    expect(fechaSeguimiento(null)).toBeNull();
    expect(fechaSeguimiento("no es fecha")).toBeNull();
  });
});

describe("checkout, portada y pie: sólo promesas ciertas", () => {
  it("el menú automático no ofrece «Ofertas» sin productos en oferta", () => {
    const layout = fuente("src/storefront/StoreLayout.tsx");
    expect(layout).toContain("menu.filter(m => m.to !== `${base}/productos?oferta=1`)");
    expect(layout).toContain('<div className="max-w-6xl mx-auto px-4 pb-8">');
  });

  it("la portada no dice «1 productos» ni deja la nota interna del envío", () => {
    const home = fuente("src/storefront/StoreHome.tsx");
    expect(home).toContain('disponibles === 1 ? "producto disponible" : "productos disponibles"');
    expect(home).not.toContain("no se promete el país");
  });

  it("en el celular el título y «Hoy en la tienda» se apilan, y el botón no se parte", () => {
    const home = fuente("src/storefront/StoreHome.tsx");
    expect(home).toMatch(/storefront-hero__content [^"]*max-sm:flex-col/);
    expect(home).toMatch(/storefront-hero__cta [^"]*whitespace-nowrap/);
  });

  it("la tienda no le habla al comprador de Nerqia ni de «workspace»", () => {
    expect(fuente("src/storefront/StoreAccount.tsx")).not.toContain("workspace Nerqia");
    expect(fuente("src/storefront/StoreTrackingConsent.tsx")).not.toContain("Nerqia no agrega");
  });

  it("el checkout no contradice «Precios finales»", () => {
    const checkout = fuente("src/storefront/StoreCheckout.tsx");
    expect(checkout).not.toContain("total final");
    expect(checkout).not.toContain("Pago seguro SSL");
  });
});
