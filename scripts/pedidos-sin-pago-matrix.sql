-- Simulacro de 20261015000300 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Lee la cola real de Exentry como su dueño.
--   1. Los pedidos sin pagar de más de 7 días están en `sin_pago`, no en `pago`.
--   2. No cuentan como trabajo pendiente (attention).
--   3. La vista `sin_pago` devuelve esas filas.
DO $$
DECLARE v_org uuid := '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285'; v_store uuid; v_owner uuid; r jsonb; v_viejos int; v_aw int;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.organizations WHERE id = v_org;
  SELECT id INTO v_store FROM public.ecommerce_stores WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  SELECT count(*) FILTER (WHERE payment_status IN ('pending','failed') AND created_at < now() - interval '7 days'),
         count(*) FILTER (WHERE payment_status = 'paid' AND fulfillment_status IN ('pending','unfulfilled','processing'))
    INTO v_viejos, v_aw FROM public.ecommerce_orders WHERE org_id = v_org AND store_id = v_store;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.store_order_queue(v_org, v_store, '', 'sin_pago', 'recientes', 'todos', 1, NULL);
  RESET ROLE;
  IF (r#>>'{counts,sin_pago}')::int <> v_viejos OR (r#>>'{counts,pago}')::int <> 0 THEN RAISE EXCEPTION 'FALLA 1: %', r->'counts'; END IF;
  IF (r->>'attention')::int <> v_aw THEN RAISE EXCEPTION 'FALLA 2: attention % esperado %', r->>'attention', v_aw; END IF;
  IF jsonb_array_length(r->'rows') <> v_viejos THEN RAISE EXCEPTION 'FALLA 3: % filas', jsonb_array_length(r->'rows'); END IF;
  RAISE EXCEPTION 'OK 1-3 (sin_pago %, attention %)', v_viejos, r->>'attention';
END $$;

ROLLBACK;
