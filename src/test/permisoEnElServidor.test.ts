import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Las RPC que mueven stock o plata exigen permiso, y siguen exigiéndolo.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * La app tiene una matriz de permisos por rol y módulo, y la base tiene
 * `has_permission()` que la lee. Hasta el 2026-08-27 las funciones que mueven
 * el stock no la llamaban: chequeaban membresía —«sos de este comercio»— y
 * nada más. Medido contra producción como `authenticated` real, con una
 * membresía `vendedor` real:
 *
 *     matriz: puede editar inventario  →  false
 *     abrir_conteo(...)                →  PASÓ
 *
 * El comercio desmarcaba «Inventario» para un empleado, la pantalla
 * desaparecía del menú, y el empleado reescribía el stock igual llamando la
 * RPC. `20260827000030` lo cerró.
 *
 * ── Qué vigila este test, y qué NO ────────────────────────────────────────
 *
 * La vista `audit_rpc_sin_permiso` es la guardia de verdad: mira la base y
 * tiene que estar vacía. Pero sólo avisa si alguien la consulta.
 *
 * Este test cubre el agujero de tiempo: una migración futura que regenere una
 * de estas nueve funciones desde `pg_get_functiondef` —que es el
 * procedimiento recomendado— y se lleve puesta la línea de la guarda sin que
 * nadie lo note. Por eso mira la ÚLTIMA definición de cada una, que es la que
 * queda aplicada, y no todas.
 */

const MIGRACIONES = resolve(__dirname, "../../supabase/migrations");

/** Las nueve, con el permiso que cada una tiene que exigir. */
const EXIGEN_PERMISO: Record<string, string> = {
  abrir_conteo: "inventory",
  registrar_conteo: "inventory",
  cerrar_conteo: "inventory",
  cancelar_conteo: "inventory",
  transfer_stock_between_locations: "inventory",
  asignar_a_ubicacion: "inventory",
  adjust_stock: "inventory",
  record_member_stock_movement: "inventory",
  wallet_solicitar_retiro: "finance",
  medio_de_pago_habilitar: "payments",
  save_afip_config: "invoices",
  facturar_venta_pos: "invoices",
};

/** El archivo más nuevo que define esa función, que es el que manda. */
function ultimaDefinicion(fn: string): { archivo: string; cuerpo: string } | null {
  const archivos = readdirSync(MIGRACIONES).filter(f => f.endsWith(".sql")).sort();
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "i");

  for (let i = archivos.length - 1; i >= 0; i--) {
    const texto = readFileSync(resolve(MIGRACIONES, archivos[i]), "utf8");
    const m = re.exec(texto);
    if (!m) continue;
    // Desde la definición hasta el cierre del cuerpo.
    const desde = m.index;
    const fin = texto.indexOf("$function$", texto.indexOf("$function$", desde) + 1);
    const hasta = fin === -1 ? texto.indexOf("$$;", desde) : fin;
    return { archivo: archivos[i], cuerpo: texto.slice(desde, hasta === -1 ? undefined : hasta) };
  }
  return null;
}

describe("las RPC que mueven stock o plata exigen permiso en el servidor", () => {
  it("el escaneo encuentra las migraciones", () => {
    const n = readdirSync(MIGRACIONES).filter(f => f.endsWith(".sql")).length;
    expect(n).toBeGreaterThan(400);
  });

  for (const [fn, modulo] of Object.entries(EXIGEN_PERMISO)) {
    it(`${fn} exige el permiso de ${modulo}`, () => {
      const def = ultimaDefinicion(fn);
      expect(def, `ninguna migración define ${fn}`).not.toBeNull();

      expect(
        def!.cuerpo,
        [
          `${fn} se redefinió en ${def!.archivo} SIN la guarda de permiso.`,
          "",
          "Ser miembro del comercio no es tener el permiso del módulo. Sin esta",
          "línea, un vendedor con el módulo desmarcado en Admin → Permisos puede",
          "llamar la RPC igual y mover stock o plata.",
          "",
          `Va después del chequeo de membresía y antes de escribir nada:`,
          `  PERFORM public.exigir_permiso(<org>, '${modulo}', 'edit', '<qué>');`,
        ].join("\n"),
      ).toContain("exigir_permiso");

      // Y el módulo correcto: exigir `inventory` para un retiro de plata
      // pasaría este test sin proteger nada de lo que importa.
      expect(def!.cuerpo, `${fn} exige un módulo que no es ${modulo}`)
        .toMatch(new RegExp(`exigir_permiso\\([^)]*'${modulo}'`));
    });
  }

  it("una promoción se lee entre todos pero se escribe con rol", () => {
    // Una promoción es un precio: se resuelve dentro del precio de la línea.
    // Hasta el 2026-08-27 la policy era `ALL` con sólo membresía, así que
    // cualquier vendedor podía fijar precios — mientras `quantity_discounts`,
    // que hace lo mismo, exigía rol desde el día uno.
    //
    // ⚠️ Y la lectura tiene que quedar abierta: el POS lee `promotions` para
    // cobrar. Cerrar la policy entera habría hecho que el mostrador cobrara
    // SIN la promoción, en silencio.
    const archivos = readdirSync(MIGRACIONES).filter(f => f.endsWith(".sql")).sort();
    let ultima: { archivo: string; texto: string } | null = null;
    for (let i = archivos.length - 1; i >= 0; i--) {
      const texto = readFileSync(resolve(MIGRACIONES, archivos[i]), "utf8");
      if (/CREATE\s+POLICY[\s\S]{0,200}?ON\s+public\.promotions/i.test(texto)) {
        ultima = { archivo: archivos[i], texto };
        break;
      }
    }
    expect(ultima, "ninguna migración define policies sobre promotions").not.toBeNull();

    const { archivo, texto } = ultima!;
    expect(texto, `${archivo}: la escritura de promociones no exige rol`)
      .toMatch(/FOR\s+ALL[\s\S]{0,200}?has_org_role/i);
    expect(texto, `${archivo}: el POS se quedó sin leer promociones`)
      .toMatch(/FOR\s+SELECT[\s\S]{0,120}?is_org_member/i);
  });

  it("la guarda va DESPUÉS de la membresía, no en su lugar", () => {
    // Son dos preguntas distintas: de qué comercio sos, y qué podés hacer
    // adentro. Reemplazar una por la otra deja entrar a un extraño con el
    // permiso puesto en su propia organización.
    for (const fn of Object.keys(EXIGEN_PERMISO)) {
      const def = ultimaDefinicion(fn);
      if (!def) continue;
      const membresia = def.cuerpo.indexOf("is_org_member");
      const permiso = def.cuerpo.indexOf("exigir_permiso");
      expect(membresia, `${fn} perdió el chequeo de membresía`).toBeGreaterThan(-1);
      expect(permiso, `${fn}: la guarda de permiso quedó ANTES de la de membresía`)
        .toBeGreaterThan(membresia);
    }
  });
});
