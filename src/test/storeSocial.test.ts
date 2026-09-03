import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  displayInstagram,
  displayWhatsApp,
  handleInstagram,
  hrefInstagram,
  hrefWhatsApp,
  hrefWhatsAppConsultar,
  parseStoreSocial,
  socialLinksParaGuardar,
} from "@/lib/storeSocial";

const ROOT = resolve(import.meta.dirname, "..", "..");

describe("contacto de la vitrina", () => {
  it("arma wa.me con dígitos y no inventa el 54", () => {
    expect(hrefWhatsApp("5491112345678")).toBe("https://wa.me/5491112345678");
    expect(hrefWhatsApp("+54 9 11 1234-5678")).toBe("https://wa.me/5491112345678");
    expect(hrefWhatsApp("https://wa.me/5491112345678")).toBe("https://wa.me/5491112345678");
    expect(hrefWhatsApp("https://api.whatsapp.com/send?phone=5491112345678")).toBe("https://wa.me/5491112345678");
    expect(hrefWhatsApp("11 1234-5678")).toBe("https://wa.me/1112345678");
    expect(hrefWhatsApp("")).toBeNull();
    expect(hrefWhatsApp("123")).toBeNull();
  });

  it("no deja pasar javascript: ni un host ajeno", () => {
    expect(hrefWhatsApp("javascript:https://wa.me/5491112345678")).toBeNull();
    expect(hrefWhatsApp("https://evil.example/wa.me/5491112345678")).toBeNull();
    expect(hrefInstagram("javascript:https://instagram.com/exentry")).toBeNull();
    expect(hrefInstagram("https://evil.example/exentry")).toBeNull();
  });

  it("Instagram acepta @handle o URL del host, nada más", () => {
    expect(handleInstagram("@exentry.ok")).toBe("exentry.ok");
    expect(hrefInstagram("@exentry.ok")).toBe("https://www.instagram.com/exentry.ok/");
    expect(hrefInstagram("https://instagram.com/exentry.ok")).toBe("https://www.instagram.com/exentry.ok/");
    expect(hrefInstagram("https://www.instagram.com/exentry.ok/")).toBe("https://www.instagram.com/exentry.ok/");
    expect(handleInstagram("no spaces")).toBeNull();
  });

  it("al guardar sólo quedan hrefs construidos", () => {
    expect(socialLinksParaGuardar({
      whatsapp: "+54 9 11 1234-5678",
      instagram: "@exentry.ok",
    })).toEqual({
      whatsapp: "https://wa.me/5491112345678",
      instagram: "https://www.instagram.com/exentry.ok/",
    });
    expect(socialLinksParaGuardar({ whatsapp: "", instagram: "" })).toEqual({});
    expect(parseStoreSocial({ twitter: "x", whatsapp: "javascript:alert(1)" })).toEqual({});
  });

  it("el campo de edición muestra dígitos o @, no el href", () => {
    expect(displayWhatsApp("https://wa.me/5491112345678")).toBe("5491112345678");
    expect(displayInstagram("https://www.instagram.com/exentry.ok/")).toBe("@exentry.ok");
  });

  it("consultar agrega un saludo con el nombre, sin pegar text= del comercio", () => {
    const href = hrefWhatsAppConsultar("5491112345678", "Exentry Imports");
    expect(href).toContain("https://wa.me/5491112345678?text=");
    expect(href).toContain(encodeURIComponent("Hola, quiero consultar por Exentry Imports"));
  });

  it("Commerce escribe social_links y la vitrina los muestra", () => {
    const page = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
    const layout = readFileSync(resolve(ROOT, "src/storefront/StoreLayout.tsx"), "utf8");
    const draft = readFileSync(resolve(ROOT, "src/lib/storeDraft.ts"), "utf8");
    expect(page).toContain("socialLinksParaGuardar");
    expect(page).toContain("WhatsApp");
    expect(draft).toContain("whatsapp:");
    expect(layout).toContain("hrefWhatsAppConsultar");
    expect(layout).toContain("parseStoreSocial");
    expect(page).not.toContain("settings.whatsapp_number");
    expect(layout).not.toContain("settings.whatsapp_number");
  });
});
