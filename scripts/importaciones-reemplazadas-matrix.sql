-- Simulacro de 20261014000200 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Las fechas se corren dentro de la
-- transacción para simular una semana sin tocar; nada queda cambiado.
--   1. Las sesiones de Famatina reemplazadas por una más nueva se cancelan.
--   2. La más nueva (la que hay que retomar) sigue sin tocar.
--   3. Sus lotes en espera quedan cancelados; los productos no cambian.
--   4. Las filas recién canceladas no se borran en la misma corrida.
DO $$
DECLARE v_org uuid; v_nueva uuid; v_prod_antes int; v_prod_despues int; v_r jsonb; v_n int; v_estado text;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name ILIKE '%famatina%' LIMIT 1;
  SELECT id INTO v_nueva FROM public.catalog_import_sessions
   WHERE org_id = v_org AND status NOT IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_prod_antes FROM public.products WHERE org_id = v_org;

  UPDATE public.catalog_import_sessions SET updated_at = now() - interval '8 days' WHERE org_id = v_org;
  v_r := public.podar_datos_operativos();

  SELECT count(*) INTO v_n FROM public.catalog_import_sessions
   WHERE org_id = v_org AND status NOT IN ('completed', 'cancelled');
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLA 1: quedan % sin terminar (esperaba 1)', v_n; END IF;
  SELECT status INTO v_estado FROM public.catalog_import_sessions WHERE id = v_nueva;
  IF v_estado IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'FALLA 2: se tocó la más nueva (%)', v_estado; END IF;

  SELECT count(*) INTO v_n FROM public.product_import_batches b JOIN public.catalog_import_chunks c ON c.batch_id = b.id
    JOIN public.catalog_import_sessions s ON s.id = c.session_id
   WHERE s.org_id = v_org AND s.id <> v_nueva AND b.status = 'staged';
  IF v_n > 0 THEN RAISE EXCEPTION 'FALLA 3: % lotes en espera de sesiones reemplazadas', v_n; END IF;
  SELECT count(*) INTO v_prod_despues FROM public.products WHERE org_id = v_org;
  IF v_prod_despues <> v_prod_antes THEN RAISE EXCEPTION 'FALLA 3: cambiaron los productos'; END IF;

  SELECT count(*) INTO v_n FROM public.product_import_rows r JOIN public.catalog_import_chunks c ON c.batch_id = r.batch_id
   JOIN public.catalog_import_sessions s ON s.id = c.session_id
   WHERE s.org_id = v_org AND s.status = 'cancelled' AND s.updated_at > now() - interval '1 hour';
  IF v_n = 0 THEN RAISE EXCEPTION 'FALLA 4: se borraron filas recién canceladas'; END IF;
  RAISE EXCEPTION 'OK 1-4 (%; quedan % filas en espera hasta dentro de 7 días)', v_r, v_n;
END $$;

ROLLBACK;
