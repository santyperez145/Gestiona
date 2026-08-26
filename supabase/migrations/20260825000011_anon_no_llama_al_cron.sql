-- ═══════════════════════════════════════════════════════════════════════════
-- La clave anónima deja de poder ejecutar las tareas internas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Auditoría del 2026-08-25, **atacando de verdad con `SET ROLE anon`** — el rol
-- de la clave anónima, que viaja en el bundle de la app y cualquiera puede leer
-- del navegador. Seis funciones ejecutaron:
--
--   `invoke_edge_function('daily-kpi')`  → EJECUTÓ. Dispara **cualquier** Edge
--       Function del proyecto. Es el helper de los crons: lee `SUPABASE_URL` y
--       `SUPABASE_ANON_KEY` del vault y hace la llamada. Desde afuera es un
--       botón para gatillar 65 funciones a voluntad — costo, emails, webhooks.
--
--   `rls_auto_enable()`                  → EJECUTÓ. Toca la RLS del esquema.
--
--   `vencer_reservas()`                  → EJECUTÓ. Libera las reservas de
--       stock de **todos** los comercios: el stock reservado de una compra en
--       curso vuelve a estar disponible y la orden se queda sin mercadería.
--
--   `expire_overdue_trials()`            → EJECUTÓ. Vence los trials de todos
--       los comercios; es cortarle el servicio a la base entera.
--
--   `check_overdue_debts()`              → **LEYÓ 1 FILA** de deuda de clientes
--       de otra organización. Es una fuga de datos personales y comerciales, no
--       una molestia operativa.
--
--   `pending_abandoned_carts(24)`        → EJECUTÓ, 0 filas hoy porque no hay
--       carritos abandonados. Con datos, devuelve email y contenido del carrito
--       de compradores de todos los comercios.
--
-- ── Por qué pasó, otra vez ─────────────────────────────────────────────────
--
-- **PostgreSQL le da EXECUTE a PUBLIC por default.** Toda función nueva nace
-- llamable por `anon`. Este repo ya cerró esto una vez para los motores H1–H3;
-- lo que faltaba era que la regla se aplicara a las funciones de tarea interna,
-- que nadie mira porque "las llama el cron".
--
-- ⚠️ Y `REVOKE ... FROM anon` **no alcanza**: si el permiso viene por PUBLIC,
-- revocarle a `anon` no le saca nada. Hay que revocar de PUBLIC. Es el error
-- que dejó ocho funciones abiertas en el primer intento de endurecimiento.
--
-- ── Lo que NO se toca, y por qué ───────────────────────────────────────────
--
-- `confirm_payment_link_transfer(uuid)` **sigue siendo anónima a propósito.**
-- El ataque la marcó como agujero y es un falso positivo del script, no de la
-- función: la llama el comprador desde `publicDataSource.ts`, que no tiene
-- sesión; sólo pasa el link de `pending` a `pending_confirmation` —"el
-- comprador dice que transfirió"—, no marca nada como cobrado, y el id es un
-- UUID no adivinable. El comercio confirma después.
--
-- Tampoco se tocan las funciones de la tienda pública (`get_store_*`,
-- `get_order_tracking`, `get_public_*`, las bajas de email por token): el
-- comprador no tiene cuenta y ese es el diseño.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tareas internas: sólo `service_role` ────────────────────────────────
--
-- Los crons corren como superusuario vía `cron.schedule`, y las Edge Functions
-- que las llaman usan `service_role`. Ninguna necesita que la llame un
-- navegador, ni logueado.

REVOKE ALL ON FUNCTION public.invoke_edge_function(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vencer_reservas()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_overdue_trials()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_overdue_debts()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pending_abandoned_carts(integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pending_stock_alerts()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_cart_email_sent(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_oauth_states()        FROM PUBLIC, anon, authenticated;

-- `api_key_tocar` la llama `public-api` con service_role para anotar el último
-- uso de una key. Desde el navegador no tiene ningún uso legítimo.
REVOKE ALL ON FUNCTION public.api_key_tocar(uuid)                 FROM PUBLIC, anon, authenticated;

-- ── 2. Operaciones del panel: logueado, nunca anónimo ──────────────────────
--
-- Estas sí las llama la app, pero desde una pantalla con sesión. Que las pueda
-- llamar `anon` no le sirve a nadie más que a un atacante.
--
-- ⚠️ **Esto no las vuelve seguras por sí solo**: siguen sin verificar que quien
-- llama pertenezca a la organización que recibe por parámetro. Cerrarlas a
-- `anon` saca al atacante sin cuenta; falta el chequeo de tenant para el
-- atacante **con** cuenta, y eso va en su propio slice porque toca la lógica.
-- Queda anotado en `audit_funciones_expuestas`, que las sigue reportando.

REVOKE ALL ON FUNCTION public.expire_stock_reservations(uuid)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stock_reservations(uuid)  TO authenticated;

REVOKE ALL ON FUNCTION public.expire_batches(uuid)                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_batches(uuid)             TO authenticated;

REVOKE ALL ON FUNCTION public.renew_subscription(uuid)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid)         TO authenticated;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.receive_purchase_order_idem(uuid, jsonb, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_idem(uuid, jsonb, text, uuid, text)
  TO authenticated;

-- ── 3. La vista de auditoría deja de mentir ────────────────────────────────
--
-- `audit_funciones_expuestas` reportaba **115** funciones. De esas, 29 son
-- funciones de trigger —que no se pueden invocar de forma útil— y 29 sí
-- verifican permisos con `has_org_role` o `has_platform_role`, que la vista no
-- reconocía porque sólo buscaba `is_org_member`, `is_platform_admin`,
-- `has_permission` y `memberships`.
--
-- ⚠️ Una guarda que reporta 115 ítems y la mayoría está bien es una guarda que
-- nadie lee. Es la misma razón por la que este mismo día se descartó un test
-- que leía las migraciones para buscar índices faltantes: daba 87 contra una
-- verdad de 7.
--
-- Ahora reconoce las cuatro formas de verificar que usa el repo, excluye los
-- triggers, y agrega `llama_anon` primero para poder ordenar por gravedad.

CREATE OR REPLACE VIEW public.audit_funciones_expuestas AS
SELECT
  p.proname AS funcion,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS llama_anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS llama_authenticated,
  pg_get_function_identity_arguments(p.oid) ILIKE '%org%' AS recibe_org
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  -- Una función de trigger no se invoca: se dispara. Reportarla es ruido.
  AND p.prorettype <> 'trigger'::regtype
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  -- Las CUATRO formas de verificar permisos que usa el repo. Faltaban dos.
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_org_member%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_platform_admin%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_permission%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_org_role%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_platform_role%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%public.memberships%'
  -- Superficie pública de la tienda: el comprador no tiene cuenta.
  AND p.proname NOT LIKE '%store%'
  AND p.proname NOT LIKE 'get_store%'
  AND p.proname <> ALL (ARRAY['handle_new_user_create_org', 'next_store_order_number']);

COMMENT ON VIEW public.audit_funciones_expuestas IS
  'Funciones SECURITY DEFINER invocables desde el navegador que no verifican permisos por ninguno de los cuatro caminos del repo. Ordenar por llama_anon: esas son las graves. Excluye funciones de trigger, que no se invocan.';
