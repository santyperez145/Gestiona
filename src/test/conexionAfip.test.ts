import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260821000020_afip_delegacion_guiada.sql");
const fn = leer("supabase/functions/afip-authorize/index.ts");
const ui = leer("src/components/afip/ConectarAfip.tsx");

/**
 * C14b — guarda de la conexión guiada a AFIP.
 *
 * El comercio no sube ningún certificado: delega el servicio `wsfe` al CUIT de
 * la plataforma desde el Administrador de Relaciones de ARCA. Es el mecanismo
 * que ya usan las plataformas que facturan por terceros, y el único que no
 * hace abandonar el onboarding.
 */
describe("conexión guiada a AFIP", () => {
  it("le dice al comercio a qué CUIT delegar", () => {
    // Sin este dato la instrucción es "andá a delegar" sin decir a quién.
    expect(migracion).toContain("AS plataforma_cuit");
    expect(ui).toContain("plataformaCuit");
  });

  it("expone el CUIT pero NUNCA el certificado ni la clave", () => {
    // Un CUIT figura en cada factura y en el padrón público. El certificado no.
    expect(migracion).not.toMatch(/SELECT[\s\S]{0,200}p\.certificate\s*(,|AS)/);
    expect(migracion).not.toContain("p.private_key AS");
    expect(migracion).toContain("certificate IS NOT NULL");
  });

  it("el motivo distingue de quién es el problema", () => {
    // "Falta que delegues" y "falta que la plataforma cargue su certificado"
    // son de responsables distintos. Un estado único obliga a adivinar.
    for (const m of ["falta_datos_fiscales", "falta_plataforma", "falta_delegar", "listo"]) {
      expect(migracion).toContain(m);
      expect(ui).toContain(m);
    }
  });

  it("la delegación la marca el backend, no la pantalla", () => {
    // Si la pantalla pudiera marcarla, un comercio podría decir que delegó sin
    // haberlo hecho y el diagnóstico dejaría de servir.
    expect(migracion).toContain("is_platform_admin(auth.uid())");
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.afip_marcar_delegacion");
    expect(ui).not.toContain("afip_marcar_delegacion");
  });

  it("no hay botón de autodeclaración: se le pregunta a ARCA", () => {
    // Un checkbox de "ya lo hice" haría que el panel diga "listo" y la primera
    // factura falle, que es peor que decir "todavía no".
    expect(fn).toContain('body.action === "verificar_delegacion"');
    expect(fn).toContain("getUltimoAutorizado(");
  });

  it("la verificación es de sólo lectura: no emite nada", () => {
    // FECompUltimoAutorizado consulta el último número; no crea comprobantes.
    const bloque = fn.slice(
      fn.indexOf('body.action === "verificar_delegacion"'),
      fn.indexOf('body.action === "test_connection"'));
    expect(bloque).not.toContain("solicitarCAE");
    expect(bloque).not.toContain("FECAESolicitar");
  });

  it("reusa el Ticket de Acceso vigente", () => {
    // WSAA rechaza pedir otro mientras el anterior viva, y con certificado
    // compartido eso choca apenas haya dos comercios verificando el mismo día.
    const bloque = fn.slice(fn.indexOf('body.action === "verificar_delegacion"'));
    expect(bloque).toContain("taVigente");
  });

  it("devuelve lo que dijo ARCA, no un error genérico", () => {
    // "El CUIT no está autorizado" y "el punto de venta no existe" mandan a
    // lugares distintos.
    expect(fn).toContain("return ok({ ok: false, error: detalle })");
  });

  it("sólo el dueño o un admin pueden verificar", () => {
    const bloque = fn.slice(fn.indexOf('body.action === "verificar_delegacion"'));
    expect(bloque).toContain('.in("role", ["owner", "admin"])');
  });

  it("la pantalla aclara que no se sube ningún certificado", () => {
    expect(ui).toContain("No vas a subir ningún certificado");
    expect(ui).toContain("podés revocar");
  });
});
