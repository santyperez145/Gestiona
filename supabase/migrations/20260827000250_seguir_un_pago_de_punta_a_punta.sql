-- Seguir un pago de punta a punta, y ver dónde se cortó
--
-- ── Lo que se midió antes de construir ────────────────────────────────────
--
-- El ROADMAP pide «correlation ID desde checkout hasta proveedor, webhook,
-- orden y ledger» como si no existiera. Medido el 2026-08-27:
--
--     payment_transactions      2 filas, 2 con correlation_id   ✅
--     payment_operation_trace   5 filas, 5 con correlation_id   ✅
--     ecommerce_orders          6 filas, sin columna            ❌
--     ledger_entries           55 filas, sin columna            ❌
--
-- O sea que estaba **construido a medias**: se sigue checkout → pago, y ahí se
-- corta. Empezar por el código lo habría construido de nuevo entero.
--
-- ── Por qué una vista y no una columna ────────────────────────────────────
--
-- El impulso era agregar `correlation_id` a `ecommerce_orders` y a
-- `ledger_entries`. ⚠️ Una columna denormalizada hay que **escribirla en cada
-- camino** —checkout, webhook, POS, ajuste manual— y el día que un camino nuevo
-- se olvide, la traza miente sin avisar. Es el mismo modo de falla que este repo
-- ya pagó con el mapa de permisos, el reparto de roles y los nueve remitentes.
--
-- 📌 Los enlaces **ya existen**: `payment_transactions.source/source_id`,
-- `sales.ecommerce_order_id`, `sales.sale_transaction_id` y
-- `ledger_entries.referencia_tipo/referencia_id`. Una vista que los recorre no
-- se puede desincronizar, porque no guarda nada.
--
-- ── La pregunta que contesta ──────────────────────────────────────────────
--
-- «El cliente dice que pagó y no aparece la orden» / «se cobró y no está en el
-- libro». La vista muestra los cinco eslabones y **cuál falta**, que es lo
-- único que hace falta para saber dónde mirar.

CREATE OR REPLACE VIEW public.traza_de_pago AS
WITH pago AS (
  SELECT pt.correlation_id,
         pt.org_id,
         pt.id            AS pago_id,
         pt.status        AS pago_estado,
         pt.gross_amount  AS monto,
         pt.external_id   AS id_del_proveedor,
         pt.provider,
         pt.created_at,
         CASE WHEN pt.source = 'ecommerce' THEN pt.source_id END AS orden_id
    FROM public.payment_transactions pt
   WHERE pt.correlation_id IS NOT NULL
)
SELECT p.correlation_id,
       p.org_id,
       p.created_at,
       p.provider,
       p.monto,
       p.pago_estado,
       p.id_del_proveedor,
       -- Los cinco eslabones. NULL significa «no llegó hasta acá».
       p.pago_id,
       o.id                         AS orden_id,
       o.payment_status             AS orden_estado,
       s.id                         AS venta_id,
       (SELECT count(*) FROM public.ledger_entries le
         WHERE le.referencia_tipo = 'venta' AND le.referencia_id = s.id) AS asientos,
       (SELECT count(*) FROM public.payment_operation_trace t
         WHERE t.correlation_id = p.correlation_id)                      AS pasos_registrados,
       -- ⚠️ El veredicto se calcula, no se guarda: decir «completo» sobre algo
       -- que no se volvió a mirar es cómo un tablero verde tapa un problema.
       CASE
         WHEN o.id IS NULL THEN 'se cobró y no hay orden'
         WHEN s.id IS NULL THEN 'hay orden y no hay venta'
         WHEN NOT EXISTS (SELECT 1 FROM public.ledger_entries le
                           WHERE le.referencia_tipo = 'venta' AND le.referencia_id = s.id)
              THEN 'hay venta y no llegó al libro'
         ELSE 'completo'
       END AS donde_se_corto
  FROM pago p
  LEFT JOIN public.ecommerce_orders o ON o.id = p.orden_id
  LEFT JOIN public.sales s            ON s.ecommerce_order_id = o.id
 WHERE public.is_org_member(p.org_id, auth.uid())
    OR public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.traza_de_pago IS
  'Un pago y sus cinco eslabones: cobro, orden, venta, asientos y pasos '
  'registrados. `donde_se_corto` contesta «el cliente pagó y no aparece la '
  'orden». No guarda nada: recorre los enlaces que ya existen, así que no se '
  'puede desincronizar como se desincronizaría una columna copiada.';

GRANT SELECT ON public.traza_de_pago TO authenticated;

-- ── Lo que hay que mirar ──────────────────────────────────────────────────
--
-- Un pago cobrado que no llegó al libro es plata que entró y no está en el
-- resultado. Esta vista tiene que estar **vacía**.

CREATE OR REPLACE VIEW public.audit_pago_sin_llegar AS
SELECT * FROM public.traza_de_pago
 WHERE donde_se_corto <> 'completo'
   AND pago_estado IN ('approved', 'accredited', 'paid');

COMMENT ON VIEW public.audit_pago_sin_llegar IS
  'Pagos aprobados cuya cadena se cortó antes del libro. Tiene que estar '
  'vacía: una fila es plata cobrada que no está en el resultado del mes.';

GRANT SELECT ON public.audit_pago_sin_llegar TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_user uuid;
  v_org  uuid;
  v_propios int;
  v_ajenos  int;
BEGIN
  SELECT m.user_id, m.org_id INTO v_user, v_org
    FROM public.memberships m
    JOIN public.payment_transactions pt ON pt.org_id = m.org_id
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE NOTICE 'no hay pagos para verificar la traza';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── a. El comercio ve sus propios pagos ─────────────────────────────────
  SELECT count(*) INTO v_propios FROM public.traza_de_pago WHERE org_id = v_org;
  ASSERT v_propios > 0, 'el comercio no puede seguir sus propios pagos';

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── b. ⚠️ Y alguien ajeno no ve ninguno ─────────────────────────────────
  -- Sin esta mitad, una vista que devuelve todo pasaría (a) igual y expondría
  -- los cobros de todos los comercios.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_ajenos FROM public.traza_de_pago;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  ASSERT v_ajenos = 0,
    'un usuario ajeno vio ' || v_ajenos || ' pagos de otros comercios';

  RAISE NOTICE 'OK: el comercio sigue sus pagos (%), un ajeno no ve ninguno', v_propios;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000250', 'seguir_un_pago_de_punta_a_punta')
ON CONFLICT DO NOTHING;
