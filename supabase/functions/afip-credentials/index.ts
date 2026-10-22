/**
 * afip-credentials — el certificado de ARCA de cada comercio (2026-10-22).
 *
 * Decisión del dueño: cada comercio factura con su propio certificado (ver la
 * migración 20261022000100 y ADR 007). Es el modelo del Facturador de Mercado
 * Libre:
 *
 *   1. `generar_pedido`: Nerqia genera la clave RSA y el pedido (CSR) en el
 *      servidor. La clave queda cifrada en `afip_credentials.pedido_clave` y
 *      no sale nunca; el comercio sólo descarga el CSR.
 *   2. El comercio, con su clave fiscal, sube el CSR en «Administración de
 *      Certificados Digitales» (alias `nerqia`), descarga el .crt y asocia el
 *      alias a Facturación Electrónica en el Administrador de Relaciones.
 *   3. `cargar_certificado`: se comprueba que el .crt corresponda a la clave
 *      del pedido y al CUIT, y se prueba contra WSAA. Si ARCA lo acepta queda
 *      activo y verificado. Si el único problema es que todavía no lo asoció a
 *      Facturación Electrónica, se guarda igual (es suyo y es válido) y queda
 *      «falta asociar»: no hay que volver a subirlo.
 *   4. `verificar`: repite la prueba (también la corre el cron cada día).
 *
 * La tabla tiene RLS sin políticas: el navegador nunca lee certificado, clave
 * ni ticket. La pantalla mira `afip_connection_status`.
 *
 * Por qué no hay OAuth: ARCA no lo ofrece. Y no se pide nunca la clave fiscal
 * del comercio: con ella se puede hacer cualquier trámite en su nombre.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { requireEnv } from "../_shared/env.ts";
import { esPem, ERROR_CERT, ERROR_CLAVE } from "../_shared/pem.ts";
import { cifrarSecreto, descifrarSecreto } from "../_shared/secretos.ts";
import { esLlamadaDeCron } from "../_shared/cronAuth.ts";
import { pedirTicketWsaa } from "../_shared/wsaaLogin.ts";
import { generarClaveYPedido, leerCertificado } from "../_shared/certificadoArca.ts";
import {
  ALIAS_ARCA, clasificarRechazoWsaa, esAmbienteArca, esEmisorDeHomologacion, explicarRechazoWsaa, wsaaUrl,
  type AmbienteArca,
} from "../_shared/certificadoArcaReglas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// deno-lint-ignore no-explicit-any
type Admin = any;
type Resultado = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // El cron sólo verifica: no genera pedidos ni carga certificados.
    if (esLlamadaDeCron(req)) return json(await verificarTodos(admin));

    // Usuario real: `verify_jwt` no alcanza, la anon key es un JWT válido y
    // viaja en el bundle.
    const { user, response } = await requireUser(req, corsHeaders);
    if (response) return response;

    const body = await req.json().catch(() => ({}));
    const orgId = body?.org_id;
    if (typeof orgId !== "string") return json({ error: "Falta la organización a configurar" }, 400);

    // Sólo dueño o administrador de LA organización elegida. Elegir la primera
    // membresía del usuario guardaría datos fiscales en otro comercio cuando
    // un mismo dueño administra más de uno.
    const { data: membership, error: errMembership } = await admin
      .from("memberships").select("role")
      .eq("user_id", user.id).eq("org_id", orgId).in("role", ["owner", "admin"])
      .maybeSingle();
    if (errMembership) return json({ error: "No se pudo verificar el permiso. Reintentá." }, 500);
    if (!membership) return json({ error: "Sólo el dueño o un administrador pueden configurar el certificado de ARCA" }, 403);

    switch (body.action) {
      case "generar_pedido": return json(await generarPedido(admin, orgId, body.environment));
      case "cargar_certificado": return json(await cargarCertificado(admin, orgId, body.certificate));
      case "verificar": return json(await verificarComercio(admin, orgId));
      case "delete": return json(await borrar(admin, orgId));
      case "subir_par": return json(await subirPar(admin, orgId, body.certificate, body.privateKey));
      default: return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    console.error("afip-credentials:", e);
    return json({ error: "Error inesperado. Tus datos se conservan; reintentá." }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function leerFila(admin: Admin, orgId: string): Promise<{ fila?: any; error?: string }> {
  const { data, error } = await admin.from("afip_credentials").select("*").eq("org_id", orgId).maybeSingle();
  if (error) return { error: "No se pudo leer tu configuración fiscal. Reintentá." };
  if (!data?.cuit || !/^\d{11}$/.test(String(data.cuit).replace(/\D/g, ""))) {
    return { error: "Primero cargá tu CUIT en «Datos fiscales»." };
  }
  return { fila: data };
}

/** Pedido nuevo. Reemplaza a uno anterior sin tocar el certificado activo. */
async function generarPedido(admin: Admin, orgId: string, ambientePedido: unknown): Promise<Resultado> {
  const { fila, error } = await leerFila(admin, orgId);
  if (error) return { ok: false, motivo: error };
  const ambiente: AmbienteArca = esAmbienteArca(ambientePedido) ? ambientePedido
    : esAmbienteArca(fila.environment) ? fila.environment : "produccion";
  const cuit = String(fila.cuit).replace(/\D/g, "");
  const { clavePem, csrPem } = await generarClaveYPedido({ cuit, razonSocial: fila.razon_social });
  const { error: errGuardar } = await admin.from("afip_credentials").update({
    pedido_clave: await cifrarSecreto(admin, clavePem),
    pedido_csr: csrPem,
    pedido_ambiente: ambiente,
    pedido_creado_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("org_id", orgId);
  if (errGuardar) return { ok: false, motivo: "No se pudo guardar el pedido. Reintentá." };
  return { ok: true, csr: csrPem, alias: ALIAS_ARCA, cuit, ambiente };
}

/**
 * Pide un ticket a WSAA con el candado del certificado del comercio (el mismo
 * que usa afip-authorize): ARCA rechaza un segundo pedido mientras el primero
 * siga vivo.
 */
async function probarContraArca(admin: Admin, orgId: string, ambiente: string, certPem: string, clavePem: string) {
  const clave = `afip:ta:${orgId}`;
  const { data: gane } = await admin.rpc("afip_ta_lease_tomar", { p_clave: clave, p_segundos: 45 });
  if (!gane) return { ok: false as const, tipo: "ticket_vigente" as const, motivo: explicarRechazoWsaa("ticket_vigente", ambiente) };
  try {
    const ta = await pedirTicketWsaa(wsaaUrl(ambiente), certPem, clavePem, "wsfe");
    return { ok: true as const, ta };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    const tipo = clasificarRechazoWsaa(mensaje);
    return { ok: false as const, tipo, motivo: tipo === "otro" ? mensaje : explicarRechazoWsaa(tipo, ambiente) };
  } finally {
    const { error } = await admin.rpc("afip_ta_lease_soltar", { p_clave: clave });
    if (error) console.error("afip-credentials: no se soltó el candado del ticket", error.message);
  }
}

async function cargarCertificado(admin: Admin, orgId: string, certificado: unknown): Promise<Resultado> {
  if (typeof certificado !== "string" || !esPem(certificado, "CERTIFICATE")) return { ok: false, motivo: ERROR_CERT };
  const { fila, error } = await leerFila(admin, orgId);
  if (error) return { ok: false, motivo: error };
  if (!fila.pedido_clave || !fila.pedido_ambiente) {
    return { ok: false, motivo: "No hay un pedido pendiente: generá el pedido primero y subí el certificado que ARCA te dio para ese pedido." };
  }
  const ambiente = fila.pedido_ambiente as AmbienteArca;
  const certPem = certificado.trim();
  const clavePem = await descifrarSecreto(admin, fila.pedido_clave);

  let leido;
  try {
    leido = leerCertificado(certPem, clavePem, String(fila.cuit));
  } catch (e) {
    const detalle = e instanceof Error ? e.message : "";
    return {
      ok: false,
      motivo: /mismo par/.test(detalle)
        ? "Ese certificado no es el de tu último pedido. Subí el que descargaste de ARCA después de cargar el pedido más reciente."
        : detalle || "No se pudo leer el certificado.",
    };
  }
  if (ambiente === "produccion" && esEmisorDeHomologacion(leido.emisor)) {
    return { ok: false, motivo: explicarRechazoWsaa("no_confiable", ambiente) };
  }

  const prueba = await probarContraArca(admin, orgId, ambiente, certPem, clavePem);
  // Sin asociar a Facturación Electrónica, o ARCA sin responder: el certificado
  // es del comercio y es válido, se guarda para no pedirle que lo suba de nuevo.
  const seGuarda = prueba.ok || ["no_asociado", "no_disponible", "ticket_vigente"].includes(prueba.tipo);
  if (!seGuarda) return { ok: false, motivo: prueba.motivo, emisor: leido.emisor };

  const ahora = new Date().toISOString();
  const { error: errActivar } = await admin.from("afip_credentials").update({
    certificate: await cifrarSecreto(admin, certPem),
    private_key: fila.pedido_clave,
    modo: "propio",
    environment: ambiente,
    certificate_not_before: leido.notBefore,
    certificate_expires_at: leido.expiresAt,
    certificate_fingerprint_sha256: leido.fingerprintSha256,
    certificado_emisor: leido.emisor,
    ta_token: prueba.ok ? prueba.ta.token : null,
    ta_sign: prueba.ok ? prueba.ta.sign : null,
    ta_expires_at: prueba.ok ? prueba.ta.expiresAt : null,
    certificado_verificado_at: ahora,
    certificado_verificado_ok: prueba.ok ? true : prueba.tipo === "no_asociado" ? false : null,
    certificado_verificado_motivo: prueba.ok ? null : prueba.motivo,
    pedido_clave: null, pedido_csr: null, pedido_ambiente: null, pedido_creado_at: null,
    updated_at: ahora,
  }).eq("org_id", orgId);
  if (errActivar) return { ok: false, motivo: "No se pudo guardar el certificado. Reintentá: el pedido sigue pendiente." };

  return prueba.ok
    ? { ok: true, verificado: true, ambiente, certificado_vence: leido.expiresAt }
    : { ok: true, verificado: false, paso: prueba.tipo === "no_asociado" ? "asociar" : "reintentar", motivo: prueba.motivo, certificado_vence: leido.expiresAt };
}

/** Prueba el certificado activo contra ARCA y deja el resultado guardado. */
async function verificarComercio(admin: Admin, orgId: string): Promise<Resultado> {
  const { data: fila, error } = await admin.from("afip_credentials").select("*").eq("org_id", orgId).maybeSingle();
  if (error) return { ok: false, motivo: "No se pudo leer tu configuración fiscal. Reintentá." };
  if (!fila?.certificate || !fila?.private_key) return { ok: false, motivo: "Todavía no cargaste tu certificado." };

  const guardar = async (cambios: Record<string, unknown>) => {
    const { error: e } = await admin.from("afip_credentials").update({
      ...cambios, certificado_verificado_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("org_id", orgId);
    if (e) console.error("afip-credentials: no se guardó la verificación", orgId, e.message);
  };

  let certPem: string; let clavePem: string;
  try {
    [certPem, clavePem] = await Promise.all([descifrarSecreto(admin, fila.certificate), descifrarSecreto(admin, fila.private_key)]);
  } catch {
    return { ok: false, motivo: "No se pudo leer el certificado guardado." };
  }

  let leido;
  try {
    leido = leerCertificado(certPem, clavePem, String(fila.cuit));
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "El certificado no es válido.";
    await guardar({ certificado_verificado_ok: false, certificado_verificado_motivo: /venció/.test(motivo) ? explicarRechazoWsaa("vencido", fila.environment) : motivo });
    return { ok: false, motivo };
  }
  const metadatos = {
    certificate_not_before: leido.notBefore,
    certificate_expires_at: leido.expiresAt,
    certificate_fingerprint_sha256: leido.fingerprintSha256,
    certificado_emisor: leido.emisor,
  };

  const ticketVivo = fila.ta_expires_at && new Date(fila.ta_expires_at) > new Date(Date.now() + 5 * 60_000);
  if (ticketVivo) {
    await guardar({ ...metadatos, certificado_verificado_ok: true, certificado_verificado_motivo: null });
    return { ok: true, certificado_vence: leido.expiresAt, ticket: "vigente" };
  }

  const prueba = await probarContraArca(admin, orgId, fila.environment, certPem, clavePem);
  if (prueba.ok) {
    await guardar({
      ...metadatos, certificado_verificado_ok: true, certificado_verificado_motivo: null,
      ta_token: prueba.ta.token, ta_sign: prueba.ta.sign, ta_expires_at: prueba.ta.expiresAt,
    });
    return { ok: true, certificado_vence: leido.expiresAt };
  }
  // ARCA sin responder no cambia lo que se sabía del certificado.
  const pasajero = prueba.tipo === "no_disponible" || prueba.tipo === "ticket_vigente";
  await guardar({
    ...metadatos,
    ...(pasajero ? {} : { certificado_verificado_ok: false }),
    certificado_verificado_motivo: prueba.motivo,
  });
  return { ok: false, paso: prueba.tipo === "no_asociado" ? "asociar" : undefined, motivo: prueba.motivo };
}

/** Cron diario: todos los certificados de comercios, los menos recientes primero. */
async function verificarTodos(admin: Admin): Promise<Resultado> {
  const { data, error } = await admin.from("afip_credentials")
    .select("org_id")
    .eq("modo", "propio")
    .not("certificate", "is", null)
    .order("certificado_verificado_at", { ascending: true, nullsFirst: true })
    .limit(40);
  if (error) {
    console.error("afip-credentials cron: no se pudieron leer los comercios", error.message);
    return { ok: false, error: "lectura" };
  }
  let aceptados = 0; let rechazados = 0;
  for (const { org_id } of data ?? []) {
    try {
      const r = await verificarComercio(admin, org_id);
      if (r.ok) aceptados++; else rechazados++;
    } catch (e) {
      rechazados++;
      console.error("afip-credentials cron:", org_id, e);
    }
  }
  return { ok: true, revisados: (data ?? []).length, aceptados, rechazados };
}

async function borrar(admin: Admin, orgId: string): Promise<Resultado> {
  const { error } = await admin.from("afip_credentials").update({
    certificate: null, private_key: null,
    ta_token: null, ta_sign: null, ta_expires_at: null,
    certificate_not_before: null, certificate_expires_at: null, certificate_fingerprint_sha256: null,
    certificado_emisor: null, certificado_verificado_at: null, certificado_verificado_ok: null, certificado_verificado_motivo: null,
    updated_at: new Date().toISOString(),
  }).eq("org_id", orgId);
  if (error) return { ok: false, motivo: "No se pudo borrar el certificado; sigue guardado. Reintentá." };
  return { ok: true, removed: true };
}

/**
 * Para quien ya tiene certificado y clave (por ejemplo, de otro sistema). Se
 * valida igual que el pedido: par, CUIT, ambiente y prueba contra ARCA.
 */
async function subirPar(admin: Admin, orgId: string, certificado: unknown, clave: unknown): Promise<Resultado> {
  if (typeof certificado !== "string" || !esPem(certificado, "CERTIFICATE")) return { ok: false, motivo: ERROR_CERT };
  if (typeof clave !== "string" || !esPem(clave, "PRIVATE KEY")) return { ok: false, motivo: ERROR_CLAVE };
  const { fila, error } = await leerFila(admin, orgId);
  if (error) return { ok: false, motivo: error };
  let leido;
  try {
    leido = leerCertificado(certificado, clave, String(fila.cuit));
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "No se pudo leer el certificado." };
  }
  const ambiente: AmbienteArca = esEmisorDeHomologacion(leido.emisor) ? "homologacion" : "produccion";
  const prueba = await probarContraArca(admin, orgId, ambiente, certificado.trim(), clave.trim());
  const seGuarda = prueba.ok || ["no_asociado", "no_disponible", "ticket_vigente"].includes(prueba.tipo);
  if (!seGuarda) return { ok: false, motivo: prueba.motivo };
  const ahora = new Date().toISOString();
  const { error: errGuardar } = await admin.from("afip_credentials").update({
    certificate: await cifrarSecreto(admin, certificado.trim()),
    private_key: await cifrarSecreto(admin, clave.trim()),
    modo: "propio",
    environment: ambiente,
    certificate_not_before: leido.notBefore,
    certificate_expires_at: leido.expiresAt,
    certificate_fingerprint_sha256: leido.fingerprintSha256,
    certificado_emisor: leido.emisor,
    ta_token: prueba.ok ? prueba.ta.token : null,
    ta_sign: prueba.ok ? prueba.ta.sign : null,
    ta_expires_at: prueba.ok ? prueba.ta.expiresAt : null,
    certificado_verificado_at: ahora,
    certificado_verificado_ok: prueba.ok ? true : prueba.tipo === "no_asociado" ? false : null,
    certificado_verificado_motivo: prueba.ok ? null : prueba.motivo,
    updated_at: ahora,
  }).eq("org_id", orgId);
  if (errGuardar) return { ok: false, motivo: "No se pudo guardar el certificado. Reintentá." };
  return prueba.ok ? { ok: true, verificado: true, ambiente } : { ok: true, verificado: false, paso: prueba.tipo === "no_asociado" ? "asociar" : "reintentar", motivo: prueba.motivo };
}
