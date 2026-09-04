import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guarda: una función `SECURITY DEFINER` que recibe una organización por
 * parámetro tiene que verificar quién la llama, o no ser llamable desde el
 * navegador.
 *
 * ── Por qué existe este test ──────────────────────────────────────────────
 *
 * **Postgres otorga EXECUTE a PUBLIC por default.** Toda función nueva nace
 * llamable por `anon` — el rol de la clave anónima, que viaja en el bundle y
 * cualquiera puede leer. Eso convirtió los motores H1, H2 y H3 en un agujero
 * apenas se escribieron, y se comprobó asumiendo el rol `anon`: seis de seis
 * ataques funcionaron, incluido acreditarse veinte millones de pesos en la
 * billetera de un comercio y leerlos como disponibles.
 *
 * Es la misma forma que el agujero de las políticas `USING (true)` que este
 * repo ya cerró una vez: algo que se creyó interno y era público.
 *
 * ── Qué chequea ──────────────────────────────────────────────────────────
 *
 * Lee las migraciones y busca funciones `SECURITY DEFINER` con un parámetro de
 * organización. Cada una tiene que hacer una de dos cosas:
 *
 *   - verificar permisos adentro (`is_org_member`, `is_platform_admin`,
 *     `has_permission` o una consulta a `memberships`), **o**
 *   - estar revocada de PUBLIC en alguna migración.
 *
 * ⚠️ Es análisis estático: no reemplaza a la vista `audit_funciones_expuestas`,
 * que mira los permisos **reales** de la base. Un `GRANT` hecho a mano no lo ve
 * este test. Las dos guardas se complementan y ninguna sobra.
 */

const DIR = join(process.cwd(), "supabase", "migrations");

/** Funciones que reciben org y son públicas a propósito. */
const PERMITIDAS = new Set([
  // Superficie de la tienda: el comprador no tiene sesión y todo se resuelve
  // por slug, que el servidor valida. Ninguna escribe fuera de su propio flujo.
  "resolve_store_line",
  "store_promo_price",
  "store_promo_2x_discount",
  "store_volume_discount",
  "store_cart_weight_kg",
  "store_payment_discount_pct",
  "get_public_promotions",
  // El catálogo público lo mira un comprador anónimo, y necesita saber en
  // cuántas cuotas puede pagar. Expone lo mostrable —cuántas, si son sin
  // interés y desde qué monto— y nada más; `org_installment_plans` sigue
  // siendo de los miembros. Antes de esto, el catálogo prometía «3 cuotas»
  // escrito a mano, sin mirar lo que el comercio ofrece.
  "cuotas_publicas",
  "platform_commission_amount",
  // Se ejecutan desde triggers de alta de organización, nunca desde el cliente.
  "seed_return_reasons",
  "seed_store_categories",
  // ⚠️ **No existe en la base.** Verificado consultando `pg_proc`: la definió
  // `20260523000060_audit_log.sql` y el objeto no está — la migración que la
  // sigue rehizo la auditoría con otra forma. Queda anotada acá en vez de
  // borrarse del archivo viejo, que ya está aplicado y no se reescribe. Si
  // algún día se crea de verdad, hay que sacarla de esta lista y darle guarda.
  "log_audit_event",
]);

/**
 * Se lee una sola vez.
 *
 * `estaRevocada()` llama a esto por cada función sospechosa, así que sin cache
 * el costo es funciones x 346 migraciones de I/O y el test se pasa de los 5
 * segundos por defecto de vitest. Falló apenas el repo cruzó las ~340
 * migraciones — y un test que se cae por lento enseña a ignorar los rojos igual
 * que uno que se cae por el sistema operativo.
 */
let _cache: { archivo: string; sql: string }[] | null = null;

function migraciones(): { archivo: string; sql: string }[] {
  if (_cache) return _cache;
  _cache = readdirSync(DIR)
    .filter(f => f.endsWith(".sql"))
    .map(f => ({ archivo: f, sql: readFileSync(join(DIR, f), "utf8") }));
  return _cache;
}

interface FuncionSospechosa {
  nombre: string;
  archivo: string;
}

/**
 * Encuentra las definiciones de función con `SECURITY DEFINER` que reciben una
 * organización y no verifican nada.
 */
function funcionesSinGuarda(): FuncionSospechosa[] {
  // ⚠️ **Gana la última definición.** Las migraciones se aplican en orden y una
  // posterior reemplaza a la anterior, así que juzgar cada archivo por separado
  // marca como agujero algo que la migración siguiente ya arregló. Pasó con
  // `wallet_saldo`: la definió sin guarda en una migración y la corrigió en
  // otra, y el test la acusaba igual.
  const ultima = new Map<string, FuncionSospechosa & { verifica: boolean }>();

  for (const { archivo, sql } of migraciones()) {
    // Cada bloque de definición: desde CREATE FUNCTION hasta el cierre del
    // cuerpo. Se corta en el siguiente CREATE para no arrastrar la función que
    // sigue y darla por verificada de prestado.
    const bloques = sql.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i).slice(1);

    for (const bloque of bloques) {
      const nombre = (bloque.match(/^(?:public\.)?(\w+)/) ?? [])[1];
      if (!nombre || PERMITIDAS.has(nombre)) continue;

      // La firma llega hasta el primer `)` que cierra los parámetros.
      const firma = bloque.slice(0, bloque.indexOf("RETURNS"));
      const recibeOrg = /\bp_org\w*\s+uuid/i.test(firma);
      if (!recibeOrg) continue;

      if (!/SECURITY\s+DEFINER/i.test(bloque.slice(0, 400))) continue;

      const verifica =
        /is_org_member|is_platform_admin|has_permission|has_org_role|exigir_permiso|public\.memberships/i.test(bloque);

      ultima.set(nombre, { nombre, archivo, verifica });
    }
  }

  return [...ultima.values()]
    .filter(f => !f.verifica)
    .map(({ nombre, archivo }) => ({ nombre, archivo }));
}

/** ¿Alguna migración le revoca el permiso a PUBLIC? */
function estaRevocada(nombre: string): boolean {
  return migraciones().some(({ sql }) => {
    // Revocación explícita, o por el bloque que recorre un array de nombres.
    const explicita = new RegExp(
      `REVOKE[\\s\\S]{0,120}FUNCTION\\s+public\\.${nombre}\\s*\\(`, "i");
    if (explicita.test(sql)) return true;

    // El bloque de endurecimiento revoca recorriendo una lista de nombres.
    return /REVOKE ALL ON FUNCTION public\.%I/.test(sql)
      && new RegExp(`'${nombre}'`).test(sql);
  });
}

describe("funciones SECURITY DEFINER expuestas", () => {
  it("hay migraciones para revisar", () => {
    expect(migraciones().length).toBeGreaterThan(100);
  });

  // El corazón del test.
  it("toda función que recibe una organización verifica permisos o está revocada", () => {
    const sinGuarda = funcionesSinGuarda().filter(f => !estaRevocada(f.nombre));

    const detalle = sinGuarda
      .map(f => `  ${f.nombre}  (${f.archivo})`)
      .join("\n");

    expect(
      sinGuarda,
      sinGuarda.length === 0 ? "" :
      `Estas funciones son SECURITY DEFINER, reciben una organización y no la validan.\n` +
      `Postgres las hace llamables por 'anon' —la clave del bundle— por default.\n` +
      `Agregales una verificación de membresía, o revocalas de PUBLIC:\n\n${detalle}\n`,
    ).toHaveLength(0);
  });

  it("los motores nuevos quedaron revocados", () => {
    // Los que el ataque probado logró usar. Si alguno vuelve a quedar abierto,
    // este test lo dice antes de que llegue a producción.
    for (const fn of [
      "emitir_evento", "ledger_asentar", "wallet_liberar",
      "suscripcion_registrar_pago", "outbox_tomar", "idempotencia_reservar",
    ]) {
      expect(estaRevocada(fn), `${fn} tiene que estar revocada de PUBLIC`).toBe(true);
    }
  });

  it("las operaciones internas no heredan grants de navegador", () => {
    for (const fn of [
      "avisar_trial_por_vencer",
      "costo_unitario_ars",
      "is_email_suppressed",
      "seed_default_alert_rules",
      "seed_default_automation_flows",
      "seed_default_price_list",
      "seed_demo_data",
      "usos_de_cupon_por_persona",
    ]) {
      expect(estaRevocada(fn), `${fn} tiene que estar revocada de roles web`).toBe(true);
    }
  });

  it("lo interno del outbox no se puede apuntar a cualquier función", () => {
    // Un `destino = 'interno'` de un comercio sería una puerta de atrás para
    // ejecutar cualquier función que reciba un jsonb.
    const sql = migraciones().map(m => m.sql).join("\n");
    expect(sql).toMatch(/destino <> 'interno' OR org_id IS NULL/);
  });

  it("un webhook no puede apuntar a la red interna", () => {
    // SSRF: el servidor visita esa URL. `src/lib/outbox.ts` ya lo validaba, pero
    // el cliente no es la autoridad — un INSERT por PostgREST se lo saltea.
    const endurecimiento = migraciones()
      .find(m => m.archivo.includes("endurecer_motores"))?.sql ?? "";

    expect(endurecimiento).toContain("event_subscriptions_webhook_publico");

    // Los rangos que la constraint bloquea. Se buscan como texto suelto y no
    // con un patrón: en el SQL los puntos van escapados (`169\.254`) y armar el
    // regex equivalente en TypeScript es una fuente de falsos negativos —
    // la primera versión de este test los tuvo dos veces.
    for (const rango of ["localhost", "127", "169", "254", "192", "168", "172"]) {
      expect(endurecimiento, `falta bloquear ${rango}`).toContain(rango);
    }
  });
});
