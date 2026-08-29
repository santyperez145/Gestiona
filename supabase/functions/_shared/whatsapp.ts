import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Mandar un WhatsApp desde el número de la plataforma.
 *
 * ── Por qué se reemplaza Evolution ────────────────────────────────────────
 *
 * Evolution API es un puente no oficial: se enlaza un teléfono real escaneando
 * un QR, como WhatsApp Web. Funciona hasta que deja de funcionar.
 *
 * ⚠️ Tres problemas, y el tercero es el que decide:
 *
 *   1. **Meta bloquea números** que detecta usando un cliente no oficial, sin
 *      aviso y sin apelación. El número que se pierde es el del comercio.
 *   2. **Cada comercio necesitaba su propia instancia** —`evolution_connections`
 *      guarda `api_url`, `api_key` e `instance` por organización—, o sea que
 *      montar un servidor y escanear un QR era parte del alta.
 *   3. **Se cae el enlace y nadie se entera**: el teléfono se queda sin batería,
 *      alguien cierra la sesión desde el celular, y los avisos dejan de salir en
 *      silencio.
 *
 * Medido el 2026-08-27: **0 conexiones y 0 campañas**. Nunca lo usó nadie, así
 * que reemplazarlo no le saca WhatsApp a ningún comercio.
 *
 * ── Lo que lo reemplaza ───────────────────────────────────────────────────
 *
 * La API oficial de WhatsApp Business (Meta Cloud API), **desde el número de la
 * plataforma**, igual que el correo. El comercio no conecta ni configura nada.
 *
 * 📌 Y el envío vive acá y no en seis archivos. Antes cada cron tenía su propia
 * copia del `fetch` a Evolution — el mismo patrón que dejó nueve remitentes de
 * correo distintos, ninguno funcionando.
 *
 * ⚠️ **El token es un secreto y va en el entorno** (`WHATSAPP_TOKEN`), no en la
 * base. Lo que sí vive en `platform_messaging_config` es el identificador del
 * número, que no es secreto y hoy es lo único que no se puede cambiar sin
 * tocar código.
 */

export interface ResultadoWhatsApp {
  ok: boolean;
  /** Por qué no salió, textual. Es lo único que sirve para arreglarlo. */
  error?: string;
  /** `false` cuando no hay WhatsApp configurado: no es un fallo, es que no hay. */
  configurado: boolean;
  /** ID de Meta; permite correlacionar el estado posterior sin guardar PII. */
  messageId?: string;
}

/** Deja el teléfono como lo quiere Meta: sólo dígitos, con código de país. */
export function normalizarTelefono(crudo: string, paisPorDefecto = "54"): string | null {
  const digitos = (crudo || "").replace(/\D/g, "");
  if (digitos.length < 8) return null;
  // Un número argentino escrito como 11..., 011... o 9 11... llega sin país.
  if (digitos.startsWith(paisPorDefecto)) return digitos;
  return paisPorDefecto + digitos.replace(/^0+/, "");
}

async function enviarPayloadWhatsApp(
  telefono: string,
  payload: Record<string, unknown>,
): Promise<ResultadoWhatsApp> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("WHATSAPP_TOKEN");
  if (!url || !serviceRole) {
    return { ok: false, configurado: false, error: "Configuración de Supabase no disponible" };
  }

  const admin = createClient(url, serviceRole);
  const { data, error } = await admin.rpc("mensajeria_de_plataforma");
  if (error || !data) {
    console.error("no se pudo leer la configuración de mensajería", error);
    return { ok: false, configurado: false, error: "No se pudo leer la configuración" };
  }

  const proveedor = data.whatsapp_proveedor as string | null;
  const phoneNumberId = data.whatsapp_phone_number_id as string | null;

  // 📌 «Sin WhatsApp» no es un error: es una decisión. Devolverlo como fallo
  // llenaría los logs de todos los crons con algo que nadie tiene que arreglar.
  if (proveedor !== "meta_cloud" || !phoneNumberId) {
    return { ok: false, configurado: false };
  }
  if (!token) {
    return {
      ok: false, configurado: true,
      error: "Falta WHATSAPP_TOKEN en el entorno de las funciones. Es un secreto: se carga en Supabase.",
    };
  }

  const destino = normalizarTelefono(telefono);
  if (!destino) return { ok: false, configurado: true, error: `Teléfono inválido: ${telefono}` };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destino,
          ...payload,
        }),
      },
    );

    const crudo = await res.text().catch(() => "");
    if (res.ok) {
      let messageId: string | undefined;
      try {
        messageId = JSON.parse(crudo)?.messages?.[0]?.id;
      } catch { /* una respuesta 2xx sin JSON sigue siendo aceptada */ }
      return { ok: true, configurado: true, messageId };
    }

    let motivo = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(crudo);
      // Meta pone el mensaje útil en `error.message`, y el detalle accionable
      // —«el número no está registrado», «fuera de la ventana de 24 h»— en
      // `error.error_data.details`. Cortar el JSON crudo esconde justo eso.
      motivo = j?.error?.error_data?.details || j?.error?.message || motivo;
    } catch { /* no era JSON: queda el status */ }
    console.error("WhatsApp rechazado", res.status, crudo.slice(0, 500));
    return { ok: false, configurado: true, error: motivo };
  } catch (e) {
    return {
      ok: false, configurado: true,
      error: e instanceof Error ? e.message : "Error de red",
    };
  }
}

export async function enviarWhatsApp(
  telefono: string, texto: string,
): Promise<ResultadoWhatsApp> {
  return enviarPayloadWhatsApp(telefono, {
    type: "text",
    text: { preview_url: false, body: texto },
  });
}

/**
 * Envía una plantilla aprobada por Meta. Las notificaciones proactivas —como
 * cumpleaños— no son texto libre: el nombre, idioma y orden de parámetros son
 * parte del contrato aprobado en WhatsApp Manager.
 */
export async function enviarPlantillaWhatsApp(
  telefono: string,
  templateName: string,
  languageCode: string,
  bodyParameters: string[],
): Promise<ResultadoWhatsApp> {
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) {
    return { ok: false, configurado: true, error: "Nombre de plantilla inválido" };
  }
  if (!/^[a-z]{2,3}_[A-Z]{2}$/.test(languageCode)) {
    return { ok: false, configurado: true, error: "Idioma de plantilla inválido" };
  }

  return enviarPayloadWhatsApp(telefono, {
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [{
        type: "body",
        parameters: bodyParameters.map((text) => ({ type: "text", text })),
      }],
    },
  });
}
