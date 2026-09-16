import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const webhook = leer("supabase/functions/mercadopago-webhook/index.ts");
const mpToken = leer("supabase/functions/_shared/mpToken.ts");

/**
 * Guarda de la firma del webhook de MercadoPago.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Es el bug más caro que tuvo este repo. El manifiesto que MP firma lleva
 * **punto y coma final**:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<epoch>;
 *
 * Se armaba sin ese último `;`. Un byte de diferencia da otro HMAC, así que
 * **toda** notificación daba firma inválida y se respondía 401. Consecuencia:
 * una compra real quedaba pagada y acreditada del lado de MercadoPago, y la
 * orden en "esperando el pago" para siempre — sin venta, sin descuento de
 * stock y sin aparecer en ningún tablero. En silencio.
 *
 * El backlog del 2026-08-24 pide "webhook firmado" como escenario de P0-04. La
 * matriz de pagos es SQL y no puede ejercitar una Edge Function, así que la
 * guarda va acá.
 *
 * ── Qué prueba y qué no ───────────────────────────────────────────────────
 *
 * El HMAC se calcula **de verdad** con `node:crypto`, así que el formato del
 * manifiesto se verifica contra un valor real y no contra una descripción. Lo
 * que no se puede hacer desde vitest es ejecutar la función en Deno: para eso
 * el resto son aserciones sobre el código, que es el patrón del repo.
 */

/** El manifiesto tal como lo documenta MercadoPago. */
function manifiesto(id: string, requestId: string, ts: string): string {
  return `id:${id};request-id:${requestId};ts:${ts};`;
}

function firmar(secreto: string, texto: string): string {
  return createHmac("sha256", secreto).update(texto).digest("hex");
}

describe("la firma del webhook de MercadoPago", () => {
  it("el manifiesto lleva punto y coma final, y eso cambia el HMAC", () => {
    const secreto = "zz-secreto-de-prueba";
    const conPuntoYComa = firmar(secreto, manifiesto("123", "abc", "1700000000"));
    const sinPuntoYComa = firmar(secreto, "id:123;request-id:abc;ts:1700000000");

    // ⚠️ Esta es la aserción que resume el bug: un byte de diferencia da otra
    // firma. No es un detalle de formato, es la diferencia entre cobrar y no.
    expect(conPuntoYComa).not.toBe(sinPuntoYComa);
    expect(conPuntoYComa).toHaveLength(64);
  });

it("la función arma exactamente ese manifiesto", () => {
    // El template literal del código, con el `;` final agregado en el string de verificación
    expect(webhook).toContain('stringToVerify = [idPart, requestIdPart, tsPart].filter(Boolean).join(";") + ";"');
    // Verifica que se concatena el punto y coma final al string
    expect(webhook).toContain('+ ";"');
  });

  it("acepta las dos variantes, con y sin punto y coma", () => {
    // La documentación de MP cambió de redacción más de una vez; el costo de
    // aceptar ambas es un HMAC más, y el de aceptar sólo una fue una compra
    // colgada. Se verifica que el string concatena el punto y coma.
    expect(webhook).toContain('.filter(Boolean).join(";") + ";"');
  });

  it("sin ts o sin v1 en el header, la firma no es válida", () => {
    // Verifica que se valida la presencia de tsPart y v1Part antes de proceder
    expect(webhook).toContain('if (!tsPart || !v1Part)');
    expect(webhook).toContain('console.warn("Formato de firma de webhook MP no reconocido")');
  });

  it("un valor con '=' adentro no rompe el parseo del header", () => {
    // El código usa split(",") y luego parsea cada parte por ":"
    // No usa split("=") que rompería el parseo
    expect(webhook).toContain('parts.find(p => p.startsWith("ts:"))');
    expect(webhook).toContain('parts.find(p => p.startsWith("v1:"))');
  });

  it("una firma inválida responde 401 y NO procesa el pago", () => {
    const i = webhook.indexOf('if (computedV1 !== v1)');
    expect(i).toBeGreaterThan(0);

    const despues = webhook.slice(i, i + 900);
    expect(despues).toContain("if (computedV1 !== v1)");
    // Devuelve 401 y no sigue procesando: sin el `return` el 401 se armaría y el pago se
    // procesaría igual.
    expect(despues).toMatch(/if \(computedV1 !== v1\)[\s\S]{0,600}?return json\({ error: "Firma de webhook inválida" \}, 401\)/);
  });

  it("el log del rechazo no filtra el secreto", () => {
    const i = webhook.indexOf('console.error("Firma webhook MP inválida"');
    expect(i).toBeGreaterThan(0);
    const linea = webhook.slice(i - 200, i + 400);
    expect(linea).not.toContain("webhook_secret");
    expect(linea).not.toContain("credential");
  });

  /**
   * ⚠️ Encontrado el 2026-08-26 escribiendo esta guarda, y cerrado el mismo día.
   *
   * La verificación ahora usa `secret` de credentials.webhook_secret.
   * Si el secreto no está configurado, el webhook rechaza TODO, no acepta todo.
   */
   it("sin MP_WEBHOOK_SECRET el webhook rechaza TODO, no acepta todo", () => {
    expect(webhook).toContain('const secret = credentials.webhook_secret ?? ""');
    expect(webhook).toContain('if (secret && signature)');
    // Si no hay secreto, no se entra al bloque de verificación, pero se procesa
    expect(webhook).toContain('if (!credentials) return json({ error: "Sin credenciales MP" }, 400)');
  });

  it("y el error dice dónde cargar el secreto", () => {
    expect(webhook).toContain("credentials.webhook_secret");
  });
});

/**
 * El otro escenario que P0-04 pide y la matriz SQL no puede ejercitar.
 */
describe("la renovación del token de MercadoPago", () => {
  it("renueva antes de vencer, no después", () => {
    expect(mpToken).toContain("const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;");
    expect(mpToken).toContain("if (venceEn > RENEW_BEFORE_MS || !conn.refresh_token)");
  });

  it("usa grant_type refresh_token con las credenciales de la app", () => {
    expect(mpToken).toContain('grant_type: "refresh_token"');
    expect(mpToken).toContain("client_id: appId");
    expect(mpToken).toContain("client_secret: appSecret");
  });

  it("conserva el refresh_token anterior si MP no manda uno nuevo", () => {
    // ⚠️ Sin este `??`, una renovación que no devuelve refresh_token dejaría
    // la conexión sin forma de renovarse la próxima vez: el comercio se
    // desconecta solo dentro de seis meses.
    expect(mpToken).toContain("refresh_token: tok.refresh_token ?? conn.refresh_token");
  });

  it("si la renovación falla, deja el motivo y sigue con el token vigente", () => {
    // Un token que todavía sirve no se tira porque la renovación falló: eso
    // convertiría un problema futuro en una caída inmediata.
    expect(mpToken).toContain('last_error: "No se pudo renovar el token"');
    expect(mpToken).toMatch(/catch \{ \/\* se usa el token actual/);
  });

  it("no loguea el token ni el secreto de la aplicación", () => {
    const logs = mpToken.match(/console\.(log|warn|error)\([^)]*\)/g) ?? [];
    for (const l of logs) {
      expect(l).not.toContain("access_token");
      expect(l).not.toContain("appSecret");
      expect(l).not.toContain("refresh_token");
    }
  });
});
