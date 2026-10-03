import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260821000020_afip_delegacion_guiada.sql");
const autorizacionFiscal = leer("supabase/migrations/20260828000150_anon_no_verifica_una_delegacion_fiscal.sql");
const contextoFiscal = leer("supabase/migrations/20261002000400_arca_connection_context_runtime.sql");
const activacionFiscal = leer("supabase/migrations/20261003000120_arca_delegation_activation_queue.sql");
const fn = leer("supabase/functions/afip-authorize/index.ts");
const ui = leer("src/components/afip/ConectarAfip.tsx");
const platformUi = leer("src/pages/PlatformAfipPage.tsx");

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
    expect(autorizacionFiscal).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(autorizacionFiscal).toContain("FROM PUBLIC, anon, authenticated");
    expect(autorizacionFiscal).toContain("TO service_role");
    expect(ui).not.toContain("afip_marcar_delegacion");
  });

  it("anon no aprovecha auth.uid NULL para autoverificarse", () => {
    // La guarda anterior empezaba con `auth.uid() IS NOT NULL`: para anon era
    // falsa y dejaba pasar justo al rol que pretendía bloquear.
    const bloque = autorizacionFiscal.slice(
      autorizacionFiscal.indexOf("CREATE OR REPLACE FUNCTION public.afip_marcar_delegacion"),
      autorizacionFiscal.indexOf("REVOKE ALL ON FUNCTION public.afip_marcar_delegacion"),
    );
    expect(bloque).not.toContain("auth.uid() IS NOT NULL AND");
    expect(bloque).toContain("insufficient_privilege");
  });

  it("la identidad fiscal exige invoices.edit y deja auditoría sin secretos", () => {
    expect(autorizacionFiscal).toMatch(/exigir_permiso\([\s\S]*?'invoices'[\s\S]*?'edit'/);
    expect(autorizacionFiscal).toContain("entity_type, entity_id");
    expect(autorizacionFiscal).toContain("'fiscal_configuration'");
    expect(autorizacionFiscal).not.toMatch(/jsonb_build_object\([\s\S]{0,300}'(ta_token|ta_sign|certificate|private_key)'/);
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

  it("devuelve diagnóstico accionable sin SOAP ni detalles internos", () => {
    expect(fn).toContain("return ok({ ok: false, code, error: detalle })");
    expect(fn).toContain('code === "point_not_enabled"');
    expect(fn).toContain("assertEnabledPoint(points, cred.punto_venta)");
    expect(fn).toContain("leerUltimoAutorizadoWsfe(xml)");
  });

  it("la verificación de terceros la ejecuta Platform, no el solicitante", () => {
    const bloque = fn.slice(fn.indexOf('body.action === "verificar_delegacion"'));
    expect(bloque).toContain('.from("platform_admins")');
    expect(bloque).toContain('.in("role", ["owner", "admin"])');
    expect(bloque).toContain("Nerqia debe aceptar la designación");
    expect(ui).toContain('afip_solicitar_revision_delegacion');
    expect(ui).not.toContain('Ya lo hice, verificar');
  });

  it("mantiene una cola auditable y estados distintos para comercio y staff", () => {
    expect(activacionFiscal).toContain("delegacion_solicitada_at");
    expect(activacionFiscal).toContain("delegacion_revisada_at");
    expect(activacionFiscal).toContain("platform_afip_delegation_queue");
    expect(activacionFiscal).toContain("esperando_plataforma");
    expect(activacionFiscal).toContain("requiere_correccion");
    expect(activacionFiscal).toContain("afip_solicitar_revision_delegacion");
    expect(activacionFiscal).toContain("exigir_permiso");
    expect(activacionFiscal).toContain("'invoices', 'edit'");
    expect(ui).toContain("Activación solicitada a Nerqia");
    expect(platformUi).toContain("Activaciones solicitadas");
    expect(platformUi).toContain("Verificar con ARCA");
    expect(platformUi).toContain("autorizá el computador fiscal");
  });

  it("no guarda una verificación contra una configuración fiscal vieja", () => {
    expect(fn).toContain('supabase.rpc("afip_confirmar_contexto"');
    expect(fn).toContain("cred.conexion_version");
    expect(fn).toContain("La configuración fiscal cambió");
    expect(contextoFiscal).toContain("v_config.conexion_version <> p_version");
    expect(contextoFiscal).toContain("'configuration_changed'");
    expect(contextoFiscal).toContain("NEW.certificate, NEW.private_key");
    expect(contextoFiscal).toContain("v_config.modo <> 'propio'");
    expect(contextoFiscal).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("la pantalla aclara que no se sube ningún certificado", () => {
    expect(ui).toContain("No vas a subir ningún certificado");
    expect(ui).toContain("podés revocar");
  });
});
