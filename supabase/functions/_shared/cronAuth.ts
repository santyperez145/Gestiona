/**
 * Quién puede disparar una tarea programada.
 *
 * ── El agujero ────────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28: **19 funciones de cron se deployan sin JWT y no
 * verificaban nada.** La prueba fue mandar un `OPTIONS` sin una sola credencial
 * a `weekly-performance-digest`: contestó `{"sent":0}`. O sea que se ejecutó.
 *
 * `--no-verify-jwt` existe porque el cron de Postgres no tiene sesión de
 * usuario. Pero `invoke_edge_function` mandaba **sólo la anon key**, que va en
 * el bundle del navegador y es pública: no había nada que distinguiera al cron
 * de cualquier persona con la URL.
 *
 * Lo que eso permitía, con un `curl`:
 *
 *   - Disparar `send-drip-emails`, `send-scheduled-campaigns` y
 *     `send-birthday-whatsapp` cuantas veces se quiera — spam a los clientes
 *     de todos los comercios, y la cuenta la paga la plataforma.
 *   - `auto-recurring-expenses`, que **crea gastos** en la contabilidad ajena.
 *   - `execute-automations` y `run-automation-flows`, que corren lo que cada
 *     comercio haya configurado.
 *
 * 📌 No es una fuga de datos: es la capacidad de **hacer que el sistema actúe**
 * en nombre de todos los comercios, gratis y desde afuera.
 *
 * ── Cómo se cierra ────────────────────────────────────────────────────────
 *
 * `invoke_edge_function` pasa a mandar un secreto del vault en `x-cron-secret`,
 * y estas funciones lo exigen. Es el mismo mecanismo que `weekly-backup` ya
 * usaba desde el 2026-08-15 — no se inventa nada, se generaliza lo que ya
 * funcionaba.
 *
 * 📌 **El secreto es `BACKUP_CRON_SECRET`, y el nombre quedó por una razón:**
 * ya existía en el vault **y** en el entorno de las funciones, con el mismo
 * valor. Crear uno nuevo habría obligado a mover un valor secreto para no
 * ganar nada — dos secretos compartidos de cron tienen el mismo radio de daño
 * que uno. Renombrarlo es trabajo del dueño cuando quiera rotarlo.
 */

/**
 * Compara sin filtrar por tiempo. Un `===` sobre secretos deja medir cuántos
 * caracteres coinciden por lo que tarda en fallar.
 */
function secretosCoinciden(esperado: string | undefined, recibido: string | null): boolean {
  if (!esperado || !recibido) return false;
  if (esperado.length !== recibido.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) {
    dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return dif === 0;
}

/** ¿Viene del cron de la base? */
export function esLlamadaDeCron(req: Request): boolean {
  return secretosCoinciden(
    Deno.env.get("BACKUP_CRON_SECRET"),
    req.headers.get("x-cron-secret"),
  );
}

const no = (corsHeaders: Record<string, string>) =>
  new Response(
    JSON.stringify({ error: "No autorizado", code: "solo_cron" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );

/**
 * Corta si la llamada no viene del cron. Va **antes** de cualquier trabajo:
 *
 *   const gate = exigirCron(req, corsHeaders);
 *   if (gate) return gate;
 *
 * ⚠️ Falla cerrado: sin `BACKUP_CRON_SECRET` en el entorno no pasa nadie. Es a
 * propósito — un control que se apaga solo cuando falta su configuración no es
 * un control, y el secreto ya está puesto en las dos puntas (medido).
 */
export function exigirCron(
  req: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  return esLlamadaDeCron(req) ? null : no(corsHeaders);
}

/**
 * Para las funciones que además se llaman desde el panel.
 *
 * ⚠️ Cuatro lo hacen —`check-alerts`, `execute-automations`, `fetch-usd-rate`
 * y `weekly-performance-digest`— y exigirles sólo el secreto les habría roto
 * el botón. Se acepta el cron **o** una persona con sesión real.
 *
 * 📌 La anon key **no** alcanza: es un JWT válido y público, así que
 * `verify_jwt` no distingue a nadie. Por eso se resuelve el usuario de verdad
 * con `auth.getUser()`, que es lo que ya hace `requireUser`.
 */
export async function exigirCronOUsuario(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (esLlamadaDeCron(req)) return null;

  const { getAuthedUser } = await import("./requireUser.ts");
  const user = await getAuthedUser(req);
  if (user?.id) return null;

  return no(corsHeaders);
}
