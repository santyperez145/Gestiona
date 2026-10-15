/**
 * afip-platform-cert — el certificado de AFIP de la plataforma (C14).
 *
 * Es el gemelo de `afip-credentials`, pero de la **otra superficie**: acá no
 * hay `org_id` y no se acepta ninguno. Quien puede tocar esto es staff de
 * plataforma, y ser staff de plataforma no da permisos dentro de ninguna
 * organización — por eso son dos funciones y no dos ramas de la misma.
 *
 * ⚠️ **Este es el secreto más valioso del sistema.** La clave privada de acá
 * adentro es el permiso para emitir comprobantes fiscales en nombre de todos
 * los comercios que delegaron `wsfe`. Vive en `afip_platform_credentials`, con
 * RLS habilitada y **cero policies**: no se lee desde el navegador, ni siendo
 * superadmin. La UI mira `afip_platform_status`, que dice si está cargado y
 * cuándo vence el ticket, nunca el contenido.
 *
 * Por qué no hay OAuth: AFIP no lo ofrece. WSAA se autentica firmando con un
 * certificado X.509 que se saca de la Clave Fiscal. Lo más parecido al modelo
 * marketplace es exactamente esto — un certificado de la plataforma, y cada
 * comercio delegándole el servicio desde "Administrador de Relaciones".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { requireEnv } from "../_shared/env.ts";
import { esPem, ERROR_CERT, ERROR_CLAVE } from "../_shared/pem.ts";
import { cifrarSecreto, descifrarSecreto } from "../_shared/secretos.ts";
import { esLlamadaDeCron } from "../_shared/cronAuth.ts";
import { pedirTicketWsaa } from "../_shared/wsaaLogin.ts";
import { validateAfipCertificateMetadata } from "../_shared/afipCertificate.ts";
// @ts-ignore node-forge no publica tipos ESM compatibles con Deno.
import forge from "https://esm.sh/node-forge@1.3.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // El cron (secreto del vault) sólo puede verificar: nunca cargar ni borrar.
    if (esLlamadaDeCron(req)) return json(await verificarCertificado(admin));

    // Usuario real: `verify_jwt` no alcanza, la anon key es un JWT válido y
    // viaja en el bundle de la app.
    const { user, response } = await requireUser(req, corsHeaders);
    if (response) return response;

    // ⚠️ La autorización se pregunta a la base, no al cliente. Es la misma
    // función que usan las políticas de RLS de plataforma.
    const { data: esAdmin, error: errAdmin } = await admin
      .rpc("is_platform_admin", { _user_id: user.id });
    if (errAdmin) {
      console.error("afip-platform-cert is_platform_admin:", errAdmin.message);
      return json({ error: "No se pudo verificar el permiso" }, 500);
    }
    if (!esAdmin) return json({ error: "Solo el staff de plataforma puede tocar este certificado" }, 403);

    const body = await req.json().catch(() => ({}));
    const { action, certificate, privateKey, cuit, razonSocial, environment } = body;

    if (action === "verificar") return json(await verificarCertificado(admin));
    if (action === "generar_pedido") return json(await generarPedido(admin, body.environment));
    if (action === "cargar_certificado") return json(await cargarCertificadoDelPedido(admin, body.certificate));

    if (action === "delete") {
      // No se borra la fila: se vacían el certificado y la clave. Así el CUIT
      // y el ambiente quedan cargados, y `afip_platform_status` puede seguir
      // diciendo "hay identidad, falta el certificado" en vez de "no hay nada".
      const { error } = await admin
        .from("afip_platform_credentials")
        .update({
          certificate: null, private_key: null,
          certificate_not_before: null,
          certificate_expires_at: null,
          certificate_fingerprint_sha256: null,
          ta_token: null, ta_sign: null, ta_expires_at: null,
          certificado_emisor: null, verificado_at: null, verificado_ok: null, verificado_motivo: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) return json({ error: "No se pudo borrar el certificado" }, 500);
      return json({ ok: true, removed: true });
    }

    const cuitLimpio = String(cuit ?? "").replace(/[^0-9]/g, "");
    if (cuitLimpio.length !== 11) {
      return json({ error: "El CUIT de la plataforma debe tener 11 dígitos" }, 400);
    }
    if (environment !== "homologacion" && environment !== "produccion") {
      return json({ error: "El ambiente debe ser homologacion o produccion" }, 400);
    }
    if (typeof certificate !== "string" || !esPem(certificate, "CERTIFICATE")) {
      return json({ error: ERROR_CERT }, 400);
    }
    if (typeof privateKey !== "string" || !esPem(privateKey, "PRIVATE KEY")) {
      return json({ error: ERROR_CLAVE }, 400);
    }

    let certificateMetadata;
    let emisor = "";
    try {
      const parsedCertificate = forge.pki.certificateFromPem(certificate.trim());
      const parsedPrivateKey = forge.pki.privateKeyFromPem(privateKey.trim());
      const publicKey = parsedCertificate.publicKey;
      const digest = forge.md.sha256.create();
      digest.update(forge.asn1.toDer(forge.pki.certificateToAsn1(parsedCertificate)).getBytes());
      certificateMetadata = validateAfipCertificateMetadata({
        notBefore: parsedCertificate.validity.notBefore,
        notAfter: parsedCertificate.validity.notAfter,
        subjectSerialNumber: parsedCertificate.subject.getField("serialNumber")?.value ?? null,
        certificateModulus: publicKey.n.toString(16),
        certificateExponent: publicKey.e.toString(16),
        privateKeyModulus: parsedPrivateKey.n.toString(16),
        privateKeyExponent: parsedPrivateKey.e.toString(16),
        fingerprintSha256: digest.digest().toHex(),
      }, cuitLimpio);
      emisor = textoDeEmisor(parsedCertificate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "No se pudo leer el certificado o la clave privada";
      return json({ error: detail }, 400);
    }

    // 2026-10-15: así se cargó un certificado de homologación como producción
    // y ningún comercio pudo facturar. ARCA firma los de prueba como
    // «Computadores Test»; no hace falta ir a WSAA para saber que no sirve.
    if (environment === "produccion" && /test/i.test(emisor)) {
      return json({ error: `Este certificado es de homologación (lo emitió «${emisor}»): no sirve para producción. Generá el pedido de producción.` }, 400);
    }

    const [encryptedCertificate, encryptedPrivateKey] = await Promise.all([
      cifrarSecreto(admin, certificate.trim()),
      cifrarSecreto(admin, privateKey.trim()),
    ]);

    const { error } = await admin
      .from("afip_platform_credentials")
      .upsert({
        id: true,
        cuit: cuitLimpio,
        razon_social: typeof razonSocial === "string" && razonSocial.trim() ? razonSocial.trim() : null,
        certificate: encryptedCertificate,
        private_key: encryptedPrivateKey,
        certificate_not_before: certificateMetadata.notBefore,
        certificate_expires_at: certificateMetadata.expiresAt,
        certificate_fingerprint_sha256: certificateMetadata.fingerprintSha256,
        environment,
        // Cambiar el certificado invalida el ticket anterior: se firmó con el
        // que ya no está. Dejarlo haría que la próxima factura use un TA que
        // WSAA ya no reconoce, y el error llegaría del lado del comercio.
        ta_token: null,
        ta_sign: null,
        ta_expires_at: null,
        // La prueba anterior era de otro certificado: no vale para este.
        certificado_emisor: emisor || null,
        verificado_at: null,
        verificado_ok: null,
        verificado_motivo: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) {
      console.error("afip-platform-cert upsert:", error.message);
      return json({ error: "No se pudo guardar el certificado" }, 500);
    }

    // Se prueba contra ARCA en el acto: la pantalla muestra si lo aceptó en vez
    // de dar por bueno lo que sólo está guardado. Nunca se devuelve lo guardado.
    const verificacion = await verificarCertificado(admin);
    return json({ ok: true, configured: true, verificado: verificacion.ok === true, motivo: verificacion.motivo ?? null });
  } catch (e) {
    console.error("afip-platform-cert:", e);
    return json({ error: "Error inesperado" }, 500);
  }
});

/**
 * Verifica el certificado de la plataforma contra ARCA (2026-10-15).
 *
 * El certificado productivo se había cargado antes de que existiera la
 * validación: no tenía vigencia, huella ni CUIT comprobados, y nunca se había
 * pedido un ticket con él. La pantalla decía «Nerqia puede pedir autorización
 * a ARCA» sin saberlo. Acá se descifra en la Edge, se comprueba que la clave
 * corresponda al certificado y al CUIT, se guardan vigencia y huella, y se pide
 * un ticket real a WSAA para wsfe. El ticket se guarda (es el mismo que usa
 * afip-authorize), así la primera factura no pide otro. Nunca devuelve el
 * certificado ni la clave: sólo el resultado.
 */
// deno-lint-ignore no-explicit-any
async function verificarCertificado(admin: any): Promise<Record<string, unknown>> {
  const r = await verificarSinGuardar(admin);
  // Lo que pasó queda guardado: la pantalla lo muestra tal cual, en vez de
  // suponer que «hay algo cargado» es lo mismo que «ARCA lo acepta».
  const { error } = await admin.from("afip_platform_credentials").update({
    verificado_at: new Date().toISOString(),
    verificado_ok: r.ok === true,
    verificado_motivo: r.ok === true ? null : String(r.motivo ?? "Sin detalle"),
    ...(typeof r.emisor === "string" && r.emisor ? { certificado_emisor: r.emisor } : {}),
  }).eq("id", true);
  if (error) console.error("afip-platform-cert: no se guardó la verificación", error.message);
  return r;
}

// deno-lint-ignore no-explicit-any
async function verificarSinGuardar(admin: any): Promise<Record<string, unknown>> {
  const { data: plat, error } = await admin.from("afip_platform_credentials").select("*").maybeSingle();
  if (error) return { ok: false, paso: "lectura", motivo: "No se pudo leer el certificado de la plataforma" };
  if (!plat?.certificate || !plat?.private_key) return { ok: false, paso: "carga", motivo: "La plataforma no tiene certificado cargado" };

  let certPem: string; let keyPem: string;
  try {
    [certPem, keyPem] = await Promise.all([descifrarSecreto(admin, plat.certificate), descifrarSecreto(admin, plat.private_key)]);
  } catch {
    return { ok: false, paso: "descifrado", motivo: "No se pudo descifrar el certificado guardado" };
  }

  let meta: { notBefore: string; expiresAt: string; fingerprintSha256: string };
  // Quién lo emitió: el de producción lo firma «Computadores» y el de
  // homologación «AFIP Testing». Es un dato público del certificado.
  let emisor = "";
  try {
    const cert = forge.pki.certificateFromPem(certPem.trim());
    emisor = cert.issuer.attributes.map((a: { shortName?: string; name?: string; value: string }) => `${a.shortName ?? a.name}=${a.value}`).join(", ");
    const key = forge.pki.privateKeyFromPem(keyPem.trim());
    const digest = forge.md.sha256.create();
    digest.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
    meta = validateAfipCertificateMetadata({
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      subjectSerialNumber: cert.subject.getField("serialNumber")?.value ?? null,
      certificateModulus: cert.publicKey.n.toString(16),
      certificateExponent: cert.publicKey.e.toString(16),
      privateKeyModulus: key.n.toString(16),
      privateKeyExponent: key.e.toString(16),
      fingerprintSha256: digest.digest().toHex(),
    }, String(plat.cuit));
  } catch (e) {
    return { ok: false, paso: "certificado", motivo: e instanceof Error ? e.message : "El certificado no es válido" };
  }

  const { error: errMeta } = await admin.from("afip_platform_credentials").update({
    certificate_not_before: meta.notBefore,
    certificate_expires_at: meta.expiresAt,
    certificate_fingerprint_sha256: meta.fingerprintSha256,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (errMeta) console.error("afip-platform-cert verificar metadata:", errMeta.message);

  const vigente = plat.ta_expires_at && new Date(plat.ta_expires_at) > new Date(Date.now() + 5 * 60_000);
  if (vigente) {
    return { ok: true, ambiente: plat.environment, certificado_vence: meta.expiresAt, emisor, ticket: "vigente", ticket_vence: plat.ta_expires_at };
  }

  // Mismo candado que afip-authorize: ARCA da un solo ticket por certificado.
  const { data: gane } = await admin.rpc("afip_ta_lease_tomar", { p_clave: "afip:ta:plataforma", p_segundos: 45 });
  if (!gane) return { ok: true, ambiente: plat.environment, certificado_vence: meta.expiresAt, ticket: "otro proceso lo está pidiendo; reintentar en un minuto" };
  try {
    const wsaaUrl = plat.environment === "produccion"
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
    const ta = await pedirTicketWsaa(wsaaUrl, certPem, keyPem, "wsfe");
    const { error: errTa } = await admin.from("afip_platform_credentials").update({
      ta_token: ta.token, ta_sign: ta.sign, ta_expires_at: ta.expiresAt, updated_at: new Date().toISOString(),
    }).eq("id", true);
    if (errTa) return { ok: false, paso: "guardar_ticket", motivo: "ARCA dio el ticket pero no se pudo guardar", certificado_vence: meta.expiresAt };
    return { ok: true, ambiente: plat.environment, certificado_vence: meta.expiresAt, emisor, ticket: "nuevo", ticket_vence: ta.expiresAt };
  } catch (e) {
    return { ok: false, paso: "wsaa", ambiente: plat.environment, certificado_vence: meta.expiresAt, emisor, motivo: e instanceof Error ? e.message : "ARCA rechazó el pedido" };
  } finally {
    const { error: errSoltar } = await admin.rpc("afip_ta_lease_soltar", { p_clave: "afip:ta:plataforma" });
    if (errSoltar) console.error("afip-platform-cert: no se soltó el lease", errSoltar.message);
  }
}

const WSAA_URL = (ambiente: string) => ambiente === "produccion"
  ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
  : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

/** «C=AR, O=AFIP, CN=Computadores» a partir del emisor de forge. */
// deno-lint-ignore no-explicit-any
function textoDeEmisor(cert: any): string {
  return cert.issuer.attributes.map((a: { shortName?: string; name?: string; value: string }) => `${a.shortName ?? a.name}=${a.value}`).join(", ");
}

/**
 * Genera el pedido de certificado (CSR) en el servidor (2026-10-15).
 *
 * Antes el asistente pedía correr openssl en la computadora de quien tramita y
 * manejar la clave privada a mano. Ahora la clave se genera acá (WebCrypto,
 * 2048 bits), se guarda cifrada como pedido pendiente y no sale nunca: se
 * devuelve sólo el CSR, que es público, para subir a ARCA. El certificado
 * activo no se toca hasta que se cargue el CRT y ARCA lo acepte.
 */
// deno-lint-ignore no-explicit-any
async function generarPedido(admin: any, ambiente: unknown): Promise<Record<string, unknown>> {
  if (ambiente !== "produccion" && ambiente !== "homologacion") return { ok: false, motivo: "El ambiente debe ser produccion u homologacion" };
  const { data: plat, error } = await admin.from("afip_platform_credentials").select("cuit, razon_social").maybeSingle();
  if (error || !plat?.cuit) return { ok: false, motivo: "Falta el CUIT de la plataforma" };

  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  let binario = "";
  for (const byte of pkcs8) binario += String.fromCharCode(byte);
  const b64 = (btoa(binario).match(/.{1,64}/g) ?? []).join("\n");
  const clavePem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;

  const clave = forge.pki.privateKeyFromPem(clavePem);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(clave.n, clave.e);
  const organizacion = String(plat.razon_social || "Nerqia")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .,&-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64) || "Nerqia";
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: organizacion },
    { name: "commonName", value: "nerqia" },
    { type: "2.5.4.5", value: `CUIT ${plat.cuit}` },
  ]);
  csr.sign(clave, forge.md.sha256.create());
  const csrPem = forge.pki.certificationRequestToPem(csr);

  const { error: errGuardar } = await admin.from("afip_platform_credentials").update({
    pedido_clave: await cifrarSecreto(admin, clavePem),
    pedido_csr: csrPem,
    pedido_ambiente: ambiente,
    pedido_creado_at: new Date().toISOString(),
  }).eq("id", true);
  if (errGuardar) return { ok: false, motivo: "No se pudo guardar el pedido" };
  return { ok: true, csr: csrPem, alias: "nerqia", cuit: plat.cuit, ambiente };
}

/**
 * Carga el CRT que devolvió ARCA para el pedido pendiente. Se prueba contra
 * WSAA con la clave del pedido ANTES de reemplazar el certificado activo: si
 * ARCA no lo acepta, no cambia nada y el pedido sigue pendiente.
 */
// deno-lint-ignore no-explicit-any
async function cargarCertificadoDelPedido(admin: any, certificado: unknown): Promise<Record<string, unknown>> {
  if (typeof certificado !== "string" || !esPem(certificado, "CERTIFICATE")) return { ok: false, motivo: ERROR_CERT };
  const { data: plat, error } = await admin.from("afip_platform_credentials").select("cuit, pedido_clave, pedido_ambiente").maybeSingle();
  if (error) return { ok: false, motivo: "No se pudo leer el pedido" };
  if (!plat?.pedido_clave || !plat.pedido_ambiente) return { ok: false, motivo: "No hay un pedido de certificado pendiente: generá uno primero" };

  const clavePem = await descifrarSecreto(admin, plat.pedido_clave);
  let meta: { notBefore: string; expiresAt: string; fingerprintSha256: string };
  let emisor = "";
  try {
    const cert = forge.pki.certificateFromPem(certificado.trim());
    const clave = forge.pki.privateKeyFromPem(clavePem);
    const digest = forge.md.sha256.create();
    digest.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
    emisor = textoDeEmisor(cert);
    meta = validateAfipCertificateMetadata({
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      subjectSerialNumber: cert.subject.getField("serialNumber")?.value ?? null,
      certificateModulus: cert.publicKey.n.toString(16),
      certificateExponent: cert.publicKey.e.toString(16),
      privateKeyModulus: clave.n.toString(16),
      privateKeyExponent: clave.e.toString(16),
      fingerprintSha256: digest.digest().toHex(),
    }, String(plat.cuit));
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "El certificado no corresponde al pedido" };
  }

  let ta: { token: string; sign: string; expiresAt: string };
  try {
    ta = await pedirTicketWsaa(WSAA_URL(plat.pedido_ambiente), certificado.trim(), clavePem, "wsfe");
  } catch (e) {
    return { ok: false, emisor, motivo: `ARCA no aceptó el certificado; no se cambió nada. ${e instanceof Error ? e.message : ""}`.trim() };
  }

  const ahora = new Date().toISOString();
  const { error: errActivar } = await admin.from("afip_platform_credentials").update({
    certificate: await cifrarSecreto(admin, certificado.trim()),
    private_key: plat.pedido_clave,
    environment: plat.pedido_ambiente,
    certificate_not_before: meta.notBefore,
    certificate_expires_at: meta.expiresAt,
    certificate_fingerprint_sha256: meta.fingerprintSha256,
    certificado_emisor: emisor,
    ta_token: ta.token, ta_sign: ta.sign, ta_expires_at: ta.expiresAt,
    verificado_at: ahora, verificado_ok: true, verificado_motivo: null,
    pedido_clave: null, pedido_csr: null, pedido_ambiente: null, pedido_creado_at: null,
    updated_at: ahora,
  }).eq("id", true);
  if (errActivar) return { ok: false, motivo: "ARCA aceptó el certificado pero no se pudo activar; reintentá" };
  return { ok: true, ambiente: plat.pedido_ambiente, certificado_vence: meta.expiresAt, emisor };
}
