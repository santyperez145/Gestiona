import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("seleccion explicita del proveedor de correo", () => {
  it("no activa SMTP por el solo hecho de estar configurado", () => {
    const source = read("supabase/functions/_shared/remitente.ts");

    expect(source).toContain('data.email_proveedor === "smtp"');
    expect(source).toContain('proveedor === "smtp" && data.smtp_configurado && pass');
  });

  it("permite elegir Resend o SMTP desde Plataforma", () => {
    const source = read("src/pages/PlatformMessagingPage.tsx");

    expect(source).toContain('value={cfg?.email_proveedor ?? "resend"}');
    expect(source).toContain('<SelectItem value="resend">Resend (recomendado)</SelectItem>');
    expect(source).toContain('<SelectItem value="smtp">Servidor SMTP propio</SelectItem>');
  });

  it("versiona la eleccion y exige reprobar al cambiar de proveedor", () => {
    const source = read("supabase/migrations/20260904000150_email_provider_selection.sql");

    expect(source).toContain("email_proveedor text");
    expect(source).toContain("p_cambios ? 'email_proveedor'");
    expect(source).toContain("THEN NULL ELSE c.email_verificado_at END");
  });
});
