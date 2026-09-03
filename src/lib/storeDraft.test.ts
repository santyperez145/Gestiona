import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STORE_WORKSPACE_COLOR,
  colorInicialDeTienda,
  costoEnvioAlGuardar,
  envioGratisAlGuardar,
  esConflictoDeSlug,
  nombreInicialDeTienda,
  slugCandidatoDeTienda,
  storeDraftInicial,
  storeFormDesdeFila,
  sugerirDireccionDeRetiro,
  sugerirEmailDeAvisos,
} from "@/lib/storeDraft";

describe("la tienda no nace con la identidad de Exentry", () => {
  it("el nombre sale de la organización, no de «Mi Tienda Online»", () => {
    expect(nombreInicialDeTienda("  Panadería López  ")).toBe("Panadería López");
    expect(nombreInicialDeTienda("")).toBe("");
    expect(nombreInicialDeTienda(null)).toBe("");
    expect(storeDraftInicial({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "Panadería López" }).name)
      .toBe("Panadería López");
    expect(storeDraftInicial().name).toBe("");
    expect(storeDraftInicial().name).not.toMatch(/tienda online/i);
  });

  it("el color es el del onboarding o el violeta del workspace, nunca el oro por default", () => {
    expect(colorInicialDeTienda(null)).toBe(STORE_WORKSPACE_COLOR);
    expect(colorInicialDeTienda("")).toBe(STORE_WORKSPACE_COLOR);
    expect(colorInicialDeTienda("#3B82F6")).toBe("#3B82F6");
    // Si el comercio lo eligió en el onboarding, es su marca, no un token del workspace.
    expect(colorInicialDeTienda("#f59e0b")).toBe("#f59e0b");
    expect(storeDraftInicial().primary_color).toBe(STORE_WORKSPACE_COLOR);
    expect(storeDraftInicial().primary_color).not.toBe("#f59e0b");
  });

  it("el slug no es mi-tienda-online para todos", () => {
    expect(slugCandidatoDeTienda({
      name: "Mi Tienda Online",
      orgId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe("tienda-aaaaaaaa");
    expect(slugCandidatoDeTienda({
      name: "Panadería López",
      orgId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe("panaderia-lopez");
    expect(slugCandidatoDeTienda({
      slugEscrito: "mi-tienda",
      name: "Café",
      orgSlug: "cafe-centro",
      orgId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe("cafe");
    expect(storeDraftInicial({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "Mi Tienda Online",
      slug: "pruebas",
    }).slug).toBe("pruebas");
  });

  it("guardar sin tocar envío no inventa $2.500 ni $50.000", () => {
    expect(costoEnvioAlGuardar("")).toBe(0);
    expect(costoEnvioAlGuardar("  ")).toBe(0);
    expect(costoEnvioAlGuardar("2500")).toBe(2500);
    expect(costoEnvioAlGuardar(-10)).toBe(0);
    expect(envioGratisAlGuardar("")).toBeNull();
    expect(envioGratisAlGuardar("0")).toBeNull();
    expect(envioGratisAlGuardar("50000")).toBe(50000);
    const draft = storeDraftInicial();
    expect(draft.shipping_cost).toBe("");
    expect(draft.free_shipping_above).toBe("");
    expect(costoEnvioAlGuardar(draft.shipping_cost)).toBe(0);
    expect(envioGratisAlGuardar(draft.free_shipping_above)).toBeNull();
  });

  it("una tienda nueva ofrece transferencia, no Mercado Pago desconectado", () => {
    expect(storeDraftInicial().payment_methods).toEqual(["transferencia"]);
  });

  it("una tienda nueva cotiza por zonas (provincia), no flat $0 disfrazado", () => {
    expect(storeDraftInicial().shipping_mode).toBe("zones");
    expect(storeFormDesdeFila({ shipping_mode: "flat" }).shipping_mode).toBe("flat");
  });

  it("una tienda nueva ofrece retiro: sin tarifas el comprador igual puede cerrar", () => {
    expect(storeDraftInicial().pickup_enabled).toBe(true);
    expect(storeFormDesdeFila({ pickup_enabled: false }).pickup_enabled).toBe(false);
  });

  it("el retiro vacío puede tomar el domicilio fiscal, sin pisar lo cargado", () => {
    expect(sugerirDireccionDeRetiro({
      pickupAddress: "",
      domicilioFiscal: "Alsina 123, CABA",
    })).toBe("Alsina 123, CABA");
    expect(sugerirDireccionDeRetiro({
      pickupAddress: "Local 4",
      domicilioFiscal: "Alsina 123, CABA",
    })).toBeNull();
    expect(sugerirDireccionDeRetiro({
      pickupAddress: "",
      domicilioFiscal: null,
    })).toBeNull();
    const page = readFileSync(resolve(__dirname, "../pages/EcommerceStorePage.tsx"), "utf8");
    expect(page).toContain("sugerirDireccionDeRetiro");
    expect(page).toContain("Usar domicilio fiscal");
    expect(page).toContain("afip_connection_status");
  });

  it("el email de avisos vacío puede tomar el de la sesión, sin pisar lo cargado", () => {
    expect(sugerirEmailDeAvisos({
      notificationEmail: "",
      sessionEmail: "dueño@ejemplo.com",
    })).toBe("dueño@ejemplo.com");
    expect(sugerirEmailDeAvisos({
      notificationEmail: "ventas@ejemplo.com",
      sessionEmail: "dueño@ejemplo.com",
    })).toBeNull();
    expect(sugerirEmailDeAvisos({
      notificationEmail: "",
      sessionEmail: "sin-arroba",
    })).toBeNull();
    const page = readFileSync(resolve(__dirname, "../pages/EcommerceStorePage.tsx"), "utf8");
    expect(page).toContain("sugerirEmailDeAvisos");
    expect(page).toContain("Usar mi correo");
  });

  it("leer una fila con envío NULL no rellena el formulario con tarifas inventadas", () => {
    const form = storeFormDesdeFila({
      name: "Exentry",
      slug: "exentry",
      shipping_cost: 0,
      free_shipping_above: null,
      payment_methods: ["mercadopago", "transferencia"],
      primary_color: "#f59e0b",
    });
    expect(form.free_shipping_above).toBe("");
    expect(form.shipping_cost).toBe("0");
    expect(form.payment_methods).toEqual(["gestiona_pay", "transferencia"]);
    expect(form.primary_color).toBe("#f59e0b");
    expect(form.whatsapp).toBe("");
    expect(form.instagram).toBe("");
  });

  it("el contacto de vitrina sale de social_links, no de un default", () => {
    const form = storeFormDesdeFila({
      social_links: {
        whatsapp: "https://wa.me/5491112345678",
        instagram: "https://www.instagram.com/exentry.ok/",
      },
    });
    expect(form.whatsapp).toBe("5491112345678");
    expect(form.instagram).toBe("@exentry.ok");
    expect(storeDraftInicial().whatsapp).toBe("");
  });

  it("un slug ocupado se distingue de un error genérico", () => {
    expect(esConflictoDeSlug({ code: "23505" })).toBe(true);
    expect(esConflictoDeSlug({ message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(esConflictoDeSlug({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
