import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * El cron se identifica.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28 mandando una request **sin una sola credencial** a
 * `weekly-performance-digest`: contestó `{"sent":0}`. Se ejecutó.
 *
 * 19 funciones de cron se deployan con `--no-verify-jwt` —el cron de Postgres
 * no tiene sesión de usuario— y `invoke_edge_function` les mandaba **sólo la
 * anon key**, que va en el bundle del navegador. No había nada que
 * distinguiera al cron de cualquiera con la URL.
 *
 * Lo que permitía, con un `curl`: disparar `send-drip-emails`,
 * `send-scheduled-campaigns` y `send-birthday-whatsapp` cuantas veces se
 * quisiera —spam a los clientes de todos los comercios, con la cuenta a la
 * plataforma—, crear gastos ajenos con `auto-recurring-expenses`, y correr
 * `execute-automations`.
 *
 * 📌 No es una fuga de datos: es la capacidad de **hacer que el sistema actúe**
 * en nombre de todos los comercios, gratis y desde afuera.
 *
 * Esta guarda falla si una función que se deploya sin JWT no exige el secreto
 * de cron ni está en la allowlist con el motivo escrito.
 */

const FUNCIONES = join(process.cwd(), "supabase", "functions");
const DEPLOY = join(process.cwd(), "scripts", "deploy-functions.ps1");

/**
 * Funciones sin JWT que **no** exigen el secreto de cron, con el motivo.
 *
 * ⚠️ Cada entrada tiene que explicar quién más puede llamarla y qué la
 * protege. «Es pública» no es un motivo: es la descripción del riesgo.
 */
const PUBLICAS: Record<string, string> = {
  "stripe-webhook":
    "Webhook de un tercero: lo llama Stripe, no el cron. Valida el secreto de " +
    "firma que Stripe manda en su propio header.",
  "mercadopago-webhook":
    "Webhook de un tercero: lo llama MercadoPago. Valida firma HMAC y secreto. " +
    "Su firma dejó de validar una vez y toda compra quedaba pagada de un lado " +
    "e impaga del otro, así que acá el control es la firma, no el JWT.",
  "resend-webhook":
    "Webhook de un tercero: lo llama Resend con firma y secreto propios.",
  "meli-webhook":
    "Webhook de un tercero: lo llama MercadoLibre con su propio secreto, que " +
    "la funcion valida antes de tocar nada. El cron no la dispara.",
  "shipping-quote":
    "Storefront público: el comprador anónimo no tiene sesión. Recalcula el " +
    "envío contra la base y no escribe nada.",
  "store-pay":
    "Storefront público: el comprador anónimo no tiene sesión. Revalida " +
    "precios, stock, cupones y comisión server-side; el cliente sólo manda " +
    "ids y cantidades.",
  "store-order-email":
    "Storefront público: confirma una orden que el propio checkout acaba de " +
    "crear, y sólo escribe al email de esa orden.",
  "drip-unsubscribe":
    "Link de un solo uso en un email: el destinatario no tiene cuenta. La " +
    "puerta es el token del link, que identifica a una sola persona.",
  "whatsapp-unsubscribe":
    "Link de un solo uso en un WhatsApp: quien se da de baja no tiene cuenta " +
    "y el token del link identifica a una sola persona. Exigir sesión acá " +
    "haría imposible desuscribirse, que es peor que dejarlo abierto.",
  "public-api":
    "API pública con su propio esquema: claves emitidas por api_key_emitir, " +
    "guardadas como SHA-256 y con scopes por endpoint.",
  "weekly-backup":
    "Ya exigía su propio secreto desde el 2026-08-15 " +
    "(BACKUP_CRON_SECRET vía x-backup-cron-secret): es el mecanismo que este " +
    "cambio generalizó, no una excepción.",
};

/** Las funciones que el script deploya sin verificar JWT. */
function sinJwt(): string[] {
  const ps = readFileSync(DEPLOY, "utf8");
  const i = ps.indexOf("$noJwt = @(");
  expect(i, "no se encontró la allowlist $noJwt en deploy-functions.ps1")
    .toBeGreaterThan(-1);
  const bloque = ps.slice(i, ps.indexOf("\n)", i));
  return [...bloque.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** El cuerpo sin comentarios: un `exigirCron` citado no protege nada. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("el cron se identifica", () => {
  const lista = sinJwt();

  it("hay funciones sin JWT que revisar", () => {
    // Si esto da 0, el parseo de la allowlist se rompió y el resto pasa vacío.
    expect(lista.length).toBeGreaterThan(15);
  });

  it("toda función sin JWT exige el secreto de cron, o está explicada", () => {
    const abiertas: string[] = [];

    for (const fn of lista) {
      if (fn in PUBLICAS) continue;
      const archivo = join(FUNCIONES, fn, "index.ts");
      if (!existsSync(archivo)) continue;

      const src = sinComentarios(readFileSync(archivo, "utf8"));
      // La llamada de verdad, no el import.
      if (!/exigirCron(OUsuario)?\s*\(\s*req/.test(src)) abiertas.push(fn);
    }

    expect(
      abiertas,
      `Estas funciones se deployan sin JWT y no exigen el secreto de cron, así ` +
        `que cualquiera con la URL puede hacer que el sistema actúe en nombre ` +
        `de todos los comercios: ${abiertas.join(", ")}. Se arregla llamando a ` +
        `exigirCron (o exigirCronOUsuario si el panel también la usa) antes de ` +
        `cualquier trabajo, o agregándola a PUBLICAS con el motivo escrito.`,
    ).toEqual([]);
  });

  it("la guarda va antes de cualquier trabajo", () => {
    /**
     * ⚠️ Chequear después de leer la base o de mandar el primer email es no
     * chequear: el trabajo ya se hizo. Se exige que aparezca en el primer
     * tercio del handler.
     */
    for (const fn of lista) {
      if (fn in PUBLICAS) continue;
      const archivo = join(FUNCIONES, fn, "index.ts");
      if (!existsSync(archivo)) continue;

      /**
       * 📌 Se mide **desde que arranca el handler**, no desde el principio del
       * archivo: un `createClient(...)` a nivel de módulo no es actuar, y
       * medir desde arriba marcaba `execute-automations` por código que corre
       * al cargar. Lo que importa es qué pasa cuando llega el request.
       */
      const src = sinComentarios(readFileSync(archivo, "utf8"));
      const handler = src.search(/(serve|Deno\.serve)\(\s*async/);
      if (handler < 0) continue;

      const cuerpo = src.slice(handler);
      const guarda = cuerpo.search(/exigirCron(OUsuario)?\s*\(\s*req/);
      if (guarda < 0) continue;

      const primerTrabajo = cuerpo.search(/\.from\(|fetch\(|sendEmail|enviarWhatsApp/);
      if (primerTrabajo < 0) continue;

      expect(
        guarda,
        `${fn} hace trabajo antes de verificar quién la llamó`,
      ).toBeLessThan(primerTrabajo);
    }
  });

  it("la guarda recibe el request que el handler realmente tiene", () => {
    /**
     * ⚠️ Dos funciones declaraban `async (_req) => {` y la guarda escribía
     * `exigirCron(req, …)`: `req` no existe, así que el módulo reventaba con un
     * ReferenceError y devolvía **500 en vez de 401**.
     *
     * 📌 Y un 500 se lee como «la función está rota», no como «la seguridad
     * está mal cableada» — es la misma confusión que hizo perder una tarde con
     * `cancel-subscription`, donde un módulo que no cargaba se leía como un
     * problema de CORS. Se encontró llamándola, no leyéndola.
     */
    for (const fn of lista) {
      if (fn in PUBLICAS) continue;
      const archivo = join(FUNCIONES, fn, "index.ts");
      if (!existsSync(archivo)) continue;

      const src = sinComentarios(readFileSync(archivo, "utf8"));
      const handler = src.match(/(?:serve|Deno\.serve)\(\s*async\s*\(\s*(\w+)/);
      const guarda = src.match(/exigirCron(?:OUsuario)?\s*\(\s*(\w+)/);
      if (!handler || !guarda) continue;

      expect(
        guarda[1],
        `${fn} pasa «${guarda[1]}» a la guarda pero el handler recibe ` +
          `«${handler[1]}»: la función revienta con un ReferenceError y ` +
          `devuelve 500 en lugar de rechazar al que no debe pasar`,
      ).toBe(handler[1]);
    }
  });

  it("la guarda no queda encerrada en el bloque de OPTIONS", () => {
    /**
     * ⚠️ Dos quedaron con la guarda **dentro** de
     * `if (req.method === "OPTIONS") { … }`. Es JavaScript válido y no falla
     * en ningún lado: sencillamente el chequeo corre sólo para el preflight y
     * un POST se lo saltea entero.
     *
     * 📌 `execute-automations` contestaba `{"ok":true,"flows_processed":0}` a
     * una request sin credenciales — 200, corriendo automatizaciones ajenas.
     * Se encontró **llamándola**, no leyéndola: el test anterior la daba por
     * protegida porque el texto estaba ahí.
     */
    for (const fn of lista) {
      if (fn in PUBLICAS) continue;
      const archivo = join(FUNCIONES, fn, "index.ts");
      if (!existsSync(archivo)) continue;

      const src = readFileSync(archivo, "utf8");
      const opts = src.match(/if\s*\(\s*req\.method\s*===\s*['"]OPTIONS['"]\s*\)\s*\{/);
      const guarda = src.search(/exigirCron(?:OUsuario)?\s*\(\s*req/);
      if (!opts || guarda < 0) continue;

      // Dónde cierra el bloque de OPTIONS.
      let i = (opts.index ?? 0) + opts[0].length - 1;
      let prof = 0;
      for (; i < src.length; i++) {
        if (src[i] === "{") prof++;
        else if (src[i] === "}") { prof--; if (prof === 0) break; }
      }

      expect(
        guarda > (opts.index ?? 0) && guarda < i,
        `${fn} tiene la guarda dentro del if(OPTIONS): sólo protege el ` +
          `preflight, y un POST entra sin que nadie lo mire`,
      ).toBe(false);
    }
  });

  it("cada excepción tiene un motivo escrito, no un nombre suelto", () => {
    for (const [fn, motivo] of Object.entries(PUBLICAS)) {
      expect(motivo.length, `${fn} está exceptuada sin explicar por qué`)
        .toBeGreaterThan(60);
    }
  });

  it("el secreto se compara sin filtrar por tiempo", () => {
    // Un `===` sobre secretos deja medir cuántos caracteres coinciden por lo
    // que tarda en fallar.
    const helper = readFileSync(join(FUNCIONES, "_shared", "cronAuth.ts"), "utf8");
    expect(helper).toMatch(/\^/);
    expect(
      /return\s+esperado\s*===\s*recibido/.test(sinComentarios(helper)),
      "el secreto se compara con === y eso filtra por tiempo",
    ).toBe(false);
  });

  it("falla cerrado: sin el secreto configurado no pasa nadie", () => {
    /**
     * ⚠️ Un control que se apaga solo cuando falta su configuración no es un
     * control. `secretosCoinciden` devuelve false con `esperado` undefined.
     */
    const helper = sinComentarios(
      readFileSync(join(FUNCIONES, "_shared", "cronAuth.ts"), "utf8"),
    );
    expect(helper).toMatch(/if\s*\(\s*!esperado\s*\|\|\s*!recibido\s*\)\s*return false/);
  });
});
