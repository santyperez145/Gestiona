import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * El WhatsApp sale por la API oficial, desde el número de la plataforma.
 *
 * ── Por qué se reemplazó Evolution ────────────────────────────────────────
 *
 * Evolution API es un puente **no oficial**: se enlaza un teléfono real
 * escaneando un QR, como WhatsApp Web. Tres problemas, y el tercero decide:
 *
 *   1. Meta **bloquea los números** que detecta usando un cliente no oficial,
 *      sin aviso y sin apelación. El número que se pierde es el del comercio.
 *   2. Cada comercio necesitaba **su propia instancia** —`evolution_connections`
 *      guarda `api_url`, `api_key` e `instance` por organización—, así que
 *      montar un servidor y escanear un QR era parte del alta.
 *   3. **Se cae el enlace y nadie se entera.** El teléfono se queda sin
 *      batería, alguien cierra la sesión, y los avisos dejan de salir en
 *      silencio.
 *
 * 📌 Medido el 2026-08-27 antes de tocar nada: **0 conexiones y 0 campañas**.
 * Nunca lo usó nadie, así que reemplazarlo no le sacó WhatsApp a ningún
 * comercio — y esa medición es la que hizo que fuera seguro hacerlo.
 */

const ROOT = resolve(__dirname, "../..");
const FUNCS = resolve(ROOT, "supabase/functions");

function funcionesConIndex(): string[] {
  return readdirSync(FUNCS, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_"))
    .map(d => d.name)
    .filter(n => existsSync(resolve(FUNCS, n, "index.ts")))
    .sort();
}

/**
 * Las que existen sólo para administrar la conexión vieja. Se dejan mientras
 * la tabla siga estando; borrarlas es otro slice, y no cambian nada porque
 * nadie manda por ahí.
 */
const SOLO_ADMINISTRAN_LA_VIEJA = new Set(["evolution-qr", "evolution-credentials"]);

describe("nadie manda WhatsApp por el puente no oficial", () => {
  it("ninguna función llama a Evolution API para enviar", () => {
    const culpables = funcionesConIndex().filter(n => {
      if (SOLO_ADMINISTRAN_LA_VIEJA.has(n)) return false;
      const src = readFileSync(resolve(FUNCS, n, "index.ts"), "utf8");
      // El endpoint de envío de Evolution. Se busca la ruta, no el nombre:
      // «evolution» aparece en comentarios que explican por qué se sacó.
      return src.includes("/message/sendText/");
    });

    expect(
      culpables,
      `estas funciones mandan WhatsApp por el puente no oficial: ${culpables.join(", ")}. ` +
      "Usá `enviarWhatsApp` de _shared/whatsapp.ts.",
    ).toEqual([]);
  });

  it("y el envío vive en un solo lugar", () => {
    // Había **seis** copias del mismo `fetch`, una por cron. Es el mismo patrón
    // que dejó nueve remitentes de correo distintos, ninguno funcionando.
    const conEnvio = funcionesConIndex().filter(n =>
      readFileSync(resolve(FUNCS, n, "index.ts"), "utf8").includes("graph.facebook.com"));
    expect(conEnvio, `el envío se volvió a copiar en: ${conEnvio.join(", ")}`).toEqual([]);
  });

  // Shopify Flow / HubSpot no ofrecen un canal cuya puerta es un puente muerto.
  // El gate a Evolution dejaba skipped para siempre (0 conexiones medido).
  it("las automatizaciones no piden Evolution como puerta de WhatsApp", () => {
    for (const n of ["run-automation-flows", "execute-automations"]) {
      const src = readFileSync(resolve(FUNCS, n, "index.ts"), "utf8");
      expect(src, `${n} sigue importando Evolution`).not.toContain("getEvolutionCredentials");
      expect(src, `${n} no manda por Meta`).toContain("enviarWhatsApp");
    }
    const ui = readFileSync(resolve(ROOT, "src/components/marketing/AutomationFlowsTab.tsx"), "utf8");
    expect(ui).toContain("whatsappCampaignChannelReady");
    expect(ui).toContain("Meta Cloud");
    expect(ui).not.toMatch(/Evolution\/Twilio/);
  });
});

describe("el envío oficial está bien armado", () => {
  const helper = readFileSync(resolve(FUNCS, "_shared/whatsapp.ts"), "utf8");

  it("⚠️ el token es un secreto del entorno, no de la base", () => {
    // `platform_messaging_config` la lee el staff desde el navegador. Un token
    // de WhatsApp ahí sería un secreto en una tabla que la UI consulta — la
    // misma clase de error que puso la clave privada de AFIP en `settings`.
    expect(helper, "el token dejó de salir del entorno")
      .toContain('Deno.env.get("WHATSAPP_TOKEN")');
    // ⚠️ La versión anterior de esta línea prohibía `whatsapp_token` con `/i`,
    // y eso matchea `WHATSAPP_TOKEN` — o sea el nombre correcto de la variable.
    // El test fallaba contra sí mismo. Lo que hay que prohibir es que el token
    // salga del resultado del RPC, que es lo que la pantalla puede leer.
    expect(helper, "el token empezó a leerse de la configuración de la base")
      .not.toMatch(/data\.\s*whatsapp_token|data\[["']whatsapp_token/);
  });

  it("distingue «no configurado» de «falló»", () => {
    // Son cosas distintas: una no hay que arreglarla. Confundirlas llenaría el
    // log de cada corrida con un error que nadie puede resolver mirándolo.
    expect(helper, "se perdió la distinción entre sin configurar y error")
      .toMatch(/configurado:\s*false/);
  });

  it("y guarda el motivo que sirve, no el genérico", () => {
    // Meta pone el detalle accionable —«el número no está registrado», «fuera
    // de la ventana de 24 h»— en `error.error_data.details`. Quedarse con el
    // status esconde justo eso.
    expect(helper, "dejó de leer el detalle que devuelve Meta")
      .toContain("error_data");
  });
});
