import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const hardening = leer("supabase/migrations/20260922000800_security_hardening_creator_anon.sql");
const encrypt = leer("supabase/migrations/20260922000900_encryption_at_rest_tenant_secrets.sql");
const secretos = leer("supabase/functions/_shared/secretos.ts");
const smtpSender = leer("supabase/functions/_shared/smtpSender.ts");
const smtpEdge = leer("supabase/functions/test-smtp/index.ts");
const webhook = leer("supabase/functions/_shared/outboundWebhook.ts");
const afipCreed = leer("supabase/functions/_shared/afipCredenciales.ts");
const afipEdge = leer("supabase/functions/afip-credentials/index.ts");

describe("endurecimiento de superficie (anon ≠ creador)", () => {
  it("revoca anon de las funciones de creador y negocio", () => {
    // El REVOKE de PUBLIC no alcanza en Supabase: los default privileges
    // conceden a anon y authenticated por separado. Hay que revocar de anon
    // explícitamente o la función queda invocable sin sesión.
    expect(hardening).toContain("REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon");
    expect(hardening).toContain("creator_campaigns");
    expect(hardening).toContain("creator_submit_deliverable");
  });

  it("expire_influencer_invitations queda exclusiva de service_role", () => {
    // Sin argumentos y SECURITY DEFINER: con anon podía expirar todas las
    // invitaciones del sistema de una llamada. Se revoca de los tres roles web
    // y se concede sólo a service_role.
    const bloque = hardening.split("expire_influencer_invitations: exclusiva")[1] ?? hardening;
    expect(bloque).toContain("FROM PUBLIC, anon, authenticated");
    expect(hardening).toContain("GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role");
  });

  it("creator_linked_profiles se ata a auth.uid()", () => {
    // Antes aceptaba cualquier uuid y devolvía los perfiles ligados de esa
    // cuenta: un enumerador de creadores ajenos.
    expect(hardening).toContain("JOIN public.creator_accounts ca ON ca.user_id = auth.uid()");
    expect(hardening).toContain("p_user_id IS NULL OR p_user_id = auth.uid()");
  });

  it("registra contratos con el hash vivo, no transcrito", () => {
    // El hash se calcula de pg_get_functiondef: cambiar el cuerpo reabre la
    // auditoría sola, sin que nadie tenga que acordarse de actualizarlo.
    expect(hardening).toContain("md5(pg_get_functiondef(p.oid))");
    expect(hardening).toContain("public.security_function_contracts");
  });
});

describe("cifrado en reposo de secretos por tenant", () => {
  it("la clave vive en Vault, nunca en una tabla legible", () => {
    expect(encrypt).toContain("vault.create_secret(");
    expect(encrypt).toContain("nerqia_data_encryption_key");
    // La clave no se escribe en ninguna tabla del esquema public.
    expect(encrypt).not.toMatch(/INSERT INTO public\.\w*(key|clave)\w*/i);
  });

  it("el envelope es versionado y el descifrado es transparente con el legado", () => {
    expect(encrypt).toContain("nerqia:v1:");
    // Un valor sin envelope se devuelve tal cual: la migración no rompe filas
    // viejas y un rollback del código sigue funcionando.
    expect(encrypt).toContain("IF p_value NOT LIKE 'nerqia:v1:%' THEN RETURN p_value; END IF");
    // Idempotente: no envuelve dos veces.
    expect(encrypt).toContain("IF p_value LIKE 'nerqia:v1:%' THEN RETURN p_value; END IF");
  });

  it("cifrar y descifrar son exclusivas de service_role", () => {
    expect(encrypt).toMatch(/REVOKE ALL ON FUNCTION public\.secret_encrypt\(text\) FROM PUBLIC, anon, authenticated/);
    expect(encrypt).toMatch(/REVOKE ALL ON FUNCTION public\.secret_decrypt\(text\) FROM PUBLIC, anon, authenticated/);
    expect(encrypt).toContain("GRANT EXECUTE ON FUNCTION public.secret_decrypt(text) TO service_role");
  });

  it("los lectores server-side descifran; los escritores cifran", () => {
    // Lectores: el secreto sólo se descifra dentro de la Edge con service_role.
    expect(smtpSender).toContain("descifrarSecreto(admin, data.password)");
    expect(webhook).toContain("descifrarSecreto(admin, secretRow.secret)");
    expect(afipCreed).toContain("descifrarSecreto(supabase, org.certificate)");
    expect(afipCreed).toContain("descifrarSecreto(supabase, plat.private_key)");
    // Escritores: nunca se persiste en claro.
    expect(smtpEdge).toContain("password: await cifrarSecreto(admin, pass)");
    expect(afipEdge).toContain("certificate: await cifrarSecreto(admin, certificate.trim())");
    expect(afipEdge).toContain("private_key: await cifrarSecreto(admin, privateKey.trim())");
  });

  it("el helper es transparente con el legado, como el propio cifrado", () => {
    expect(secretos).toContain('if (!valor.startsWith("nerqia:v1:")) return valor;');
    expect(secretos).toContain('rpc("secret_decrypt"');
    expect(secretos).toContain('rpc("secret_encrypt"');
  });

  it("los generadores de secretos de webhook persisten cifrado", () => {
    expect(encrypt).toContain("public.secret_encrypt(v_secret)");
    // El secreto en claro se devuelve una vez al llamador, no se guarda así.
    expect(encrypt).toContain("'signing_secret', v_secret");
  });
});

describe("search_path fijado en funciones privilegiadas", () => {
  const searchPath = leer("supabase/migrations/20260922001000_search_path_definer_hardening.sql");

  it("fija search_path en las SECURITY DEFINER que lo tenían suelto", () => {
    // Sin search_path fijo, una función SECURITY DEFINER resuelve con el path
    // del llamador: un esquema anterior puede hacer que memberships resuelva a
    // una tabla del atacante y saltarse la guarda.
    expect(searchPath).toContain("SET search_path = public, pg_temp");
    expect(searchPath).toContain("has_permission");
    expect(searchPath).toContain("is_email_suppressed");
  });

  it("la certificación exige cero funciones sin path", () => {
    expect(searchPath).toContain("p.prosecdef");
    expect(searchPath).toMatch(/ASSERT v_sin_path = 0/);
  });

  it("refresca el hash del contrato que el ALTER invalida", () => {
    // Cambiar la definición cambia el hash: sin refresco, la auditoría vuelve a
    // marcar una función que sólo ganó un search_path seguro.
    expect(searchPath).toContain("SET definition_hash = md5(pg_get_functiondef(p.oid))");
  });
});
