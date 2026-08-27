-- El segundo comercio perdía el asiento de su primera venta
--
-- ── Cómo apareció ─────────────────────────────────────────────────────────
--
-- Auditando qué ve un comercio nuevo. Hay un proxy exacto sin inventar nada:
-- `pruebas Workspace` existe desde el 2026-08-04 con cero productos. Se le
-- cargó un producto y se le vendió una unidad por el camino real del POS
-- (`create_sales_transaction_v3`), todo dentro de una transacción revertida:
--
--     vender en el POS        PUDO
--     stock del producto      5 → 4
--     movimientos de Kardex   1
--     ventas registradas      1
--     asientos en el ledger   0        ← acá
--
-- Llamando a `ledger_asentar_venta` directo para que el error hable:
--
--     La cuenta 1.1.01 no existe en el plan
--
--     organización   plan de cuentas   asientos
--     santiago       25                48
--     pruebas        0                 0
--
-- ── La causa, y es mía ────────────────────────────────────────────────────
--
-- La versión vieja `ledger_asentar_venta_pos` sembraba el plan antes de
-- asentar. Al escribir `ledger_asentar_venta` y `ledger_asentar_gasto` el
-- 2026-08-26 (`20260826000260`) esa línea no se llevó.
--
-- Para Exentry no se notó: ya tenía sus 25 cuentas de antes. **Aparece con el
-- segundo comercio, el primer día**, y no hace ruido: `trg_asentar_venta`
-- atrapa la excepción a propósito —una venta no puede caerse por
-- contabilidad— así que el comercio vende bien y su libro queda vacío.
--
-- 📌 Es la misma familia que el descuento doble de stock: con una sola
-- organización no se puede reproducir. Al medir cualquier cosa del Business
-- Core hay que pensar en dos comercios, no en uno.
--
-- ── Dónde va el arreglo ───────────────────────────────────────────────────
--
-- En `ledger_asentar`, que es la puerta única de todo asiento: cubre de una
-- sola vez la venta, el gasto, el retiro de billetera y lo que venga. Ponerlo
-- en cada función que asienta sería la misma decisión escrita en cinco
-- lugares — que es exactamente cómo se perdió esta vez.
--
-- `ledger_plan_default` es idempotente (`ON CONFLICT`), así que llamarla en
-- cada asiento no cuesta nada.

CREATE OR REPLACE FUNCTION public.ledger_asentar(p_org uuid, p_descripcion text, p_lineas jsonb, p_fecha date DEFAULT CURRENT_DATE, p_ref_tipo text DEFAULT NULL::text, p_ref_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'ARS'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_numero bigint;
  v_id     uuid;
  v_l      jsonb;
  v_cta    uuid;
  v_debe   numeric;
  v_haber  numeric;
  v_sum_debe  numeric;
  v_sum_haber numeric;
BEGIN
  IF p_org IS NULL OR btrim(COALESCE(p_descripcion, '')) = '' THEN
    RAISE EXCEPTION 'ledger_asentar: falta organizacion o descripcion';
  END IF;
  IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 2 THEN
    -- Menos de dos partidas no puede cuadrar contra nada.
    RAISE EXCEPTION 'ledger_asentar: un asiento necesita al menos dos partidas';
  END IF;

    -- ── El plan de cuentas existe antes de necesitarlo ───────────────────
  --
  -- ⚠️ Una organización nueva no tiene plan de cuentas, y sin él **el asiento
  -- de su primera venta se pierde en silencio**: `ledger_asentar` corta con
  -- «La cuenta 1.1.01 no existe en el plan» y `trg_asentar_venta` se traga el
  -- error para que la contabilidad no voltee una venta.
  --
  -- Se sembraba en `ledger_asentar_venta_pos` y se perdió al reescribir
  -- `ledger_asentar_venta` el 2026-08-26. Para Exentry no se notó: ya tenía
  -- sus 25 cuentas. Aparece con el segundo comercio, el primer día.
  --
  -- Va acá y no en cada función que asienta porque ésta es la puerta única:
  -- cubre venta, gasto, retiro y lo que venga. `ledger_plan_default` es
  -- idempotente (`ON CONFLICT`), así que llamarla siempre no cuesta nada.
  PERFORM public.ledger_plan_default(p_org);

  -- Candado por organización para el correlativo: sin esto, dos asientos
  -- simultáneos eligen el mismo número y uno falla contra el índice único.
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || p_org::text, 0));

  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
    FROM public.ledger_entries WHERE org_id = p_org;

  INSERT INTO public.ledger_entries (
    org_id, numero, fecha, descripcion, moneda, referencia_tipo, referencia_id, created_by)
  VALUES (p_org, v_numero, p_fecha, btrim(p_descripcion), p_moneda, p_ref_tipo, p_ref_id, auth.uid())
  RETURNING id INTO v_id;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    -- La cuenta se pasa por código y no por id: un asiento escrito con códigos
    -- se lee, se revisa y sobrevive a que se regenere el plan.
    SELECT a.id INTO v_cta FROM public.ledger_accounts a
     WHERE a.org_id = p_org AND a.codigo = v_l->>'cuenta';

    IF v_cta IS NULL THEN
      RAISE EXCEPTION 'La cuenta % no existe en el plan de esta organizacion', v_l->>'cuenta';
    END IF;

    v_debe  := ROUND(COALESCE((v_l->>'debe')::numeric, 0), 2);
    v_haber := ROUND(COALESCE((v_l->>'haber')::numeric, 0), 2);

    -- Una partida en cero no aporta nada y ensucia el libro. Se saltea en vez
    -- de fallar: quien arma el asiento no tiene por qué filtrar los ceros.
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.ledger_lines (
      entry_id, org_id, account_id, debe, haber, descripcion, metadata)
    VALUES (
      v_id, p_org, v_cta, v_debe, v_haber,
      NULLIF(btrim(COALESCE(v_l->>'detalle', '')), ''),
      COALESCE(v_l->'metadata', '{}'::jsonb));
  END LOOP;

  -- ⚠️ Se verifica que cuadre **acá también**, no sólo en el trigger diferido.
  --
  -- El trigger corre al cerrar la transacción, y eso tiene dos problemas para
  -- quien llama: el error llega tarde —cuando ya no se sabe qué asiento lo
  -- causó— y no se puede atrapar con un EXCEPTION alrededor de esta llamada,
  -- porque todavía no ocurrió. Se descubrió verificando: el bloque de prueba
  -- que esperaba el rechazo no lo veía nunca.
  --
  -- El trigger diferido se queda igual, como red para quien inserte partidas
  -- sin pasar por esta función.
  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0)
    INTO v_sum_debe, v_sum_haber
    FROM public.ledger_lines WHERE entry_id = v_id;

  IF v_sum_debe = 0 AND v_sum_haber = 0 THEN
    RAISE EXCEPTION 'El asiento no tiene partidas con importe' USING ERRCODE = '23514';
  END IF;

  IF v_sum_debe <> v_sum_haber THEN
    RAISE EXCEPTION
      'El asiento no cuadra: debe % contra haber % (diferencia %)',
      v_sum_debe, v_sum_haber, v_sum_debe - v_sum_haber
      USING ERRCODE = '23514';
  END IF;

  RETURN v_id;
END;
$function$
;
-- ── trg_asentar_venta ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_asentar_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ⚠️ Acá había una salida temprana: «sin plan de cuentas no hay libro donde
  -- asentar, RETURN NEW». Sonaba prudente y era un círculo cerrado — sin plan
  -- no se asienta, y nada más sembraba el plan — así que **un comercio nuevo
  -- nunca empezaba a asentar**. Vendía bien y su libro quedaba vacío.
  --
  -- Se sacó el 2026-08-27: `ledger_asentar` siembra el plan por su cuenta y
  -- es idempotente, así que «todavía no tiene plan» dejó de ser un motivo para
  -- no registrar nada.
  IF COALESCE(NEW.total_ars, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar_venta(NEW.id);
  EXCEPTION WHEN others THEN
    -- La venta se guarda igual. Lo pendiente queda visible en
    -- `operaciones_sin_asentar`, no en un log que nadie mira.
    RAISE WARNING 'la venta % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

-- ── trg_asentar_gasto ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_asentar_gasto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ⚠️ Acá había una salida temprana: «sin plan de cuentas no hay libro donde
  -- asentar, RETURN NEW». Sonaba prudente y era un círculo cerrado — sin plan
  -- no se asienta, y nada más sembraba el plan — así que **un comercio nuevo
  -- nunca empezaba a asentar**. Vendía bien y su libro quedaba vacío.
  --
  -- Se sacó el 2026-08-27: `ledger_asentar` siembra el plan por su cuenta y
  -- es idempotente, así que «todavía no tiene plan» dejó de ser un motivo para
  -- no registrar nada.
  IF COALESCE(NEW.amount_ars, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar_gasto(NEW.id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'el gasto % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

-- ── trg_asentar_cobranza ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_asentar_cobranza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delta numeric;
BEGIN
  -- ⚠️ Acá había una salida temprana: «sin plan de cuentas no hay libro donde
  -- asentar, RETURN NEW». Sonaba prudente y era un círculo cerrado — sin plan
  -- no se asienta, y nada más sembraba el plan — así que **un comercio nuevo
  -- nunca empezaba a asentar**. Vendía bien y su libro quedaba vacío.
  --
  -- Se sacó el 2026-08-27: `ledger_asentar` siembra el plan por su cuenta y
  -- es idempotente, así que «todavía no tiene plan» dejó de ser un motivo para
  -- no registrar nada.

  v_delta := ROUND(COALESCE(NEW.paid_ars, 0) - COALESCE(OLD.paid_ars, 0), 2);

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  IF v_delta < 0 THEN
    -- Una corrección no es una cobranza negativa: es un contraasiento que
    -- alguien tiene que decidir. Se avisa y no se inventa.
    RAISE WARNING 'la deuda % bajo su pagado en %: corresponde contraasiento manual', NEW.id, -v_delta;
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar(
      p_org         := NEW.org_id,
      p_descripcion := 'Cobranza' || COALESCE(' — ' || NEW.customer_name, ''),
      p_lineas      := jsonb_build_array(
        jsonb_build_object('cuenta', '1.1.01', 'debe', v_delta,
          'detalle', 'Cobro de deuda',
          'metadata', jsonb_build_object('debt_id', NEW.id, 'medio', 'sin registrar: ver debt_payments')),
        jsonb_build_object('cuenta', '1.2.01', 'haber', v_delta,
          'detalle', 'Cancelacion de deudores')),
      p_fecha       := CURRENT_DATE,
      p_ref_tipo    := 'cobranza',
      p_ref_id      := NEW.id);
  EXCEPTION WHEN others THEN
    -- El cobro se guarda igual: la contabilidad nunca voltea la operación.
    RAISE WARNING 'la cobranza de la deuda % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;
-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — con un comercio SIN plan de cuentas, que es el caso
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user     uuid;
  v_prod     uuid := gen_random_uuid();
  v_venta    uuid;
  v_plan     int;
  v_asientos int;
  v_antes    int;
  v_restos   int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;

  -- Un comercio recién nacido: sin plan de cuentas, como cualquiera que se
  -- registre mañana.
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ comercio nuevo', 'zz-nuevo-' || substr(v_org::text,1,8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  SELECT count(*) INTO v_plan FROM public.ledger_accounts WHERE org_id = v_org;
  ASSERT v_plan = 0, 'el comercio ZZ ya venia con plan de cuentas: el caso no es el que se quiere probar';

  INSERT INTO public.products (id, org_id, user_id, name, sale_price_ars, stock)
  VALUES (v_prod, v_org, v_user, 'ZZ primer producto', 5000, 5);

  -- Su primera venta, por el camino real (el trigger asienta).
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
    unit_price_ars, total_ars, cost_of_goods_ars, profit_ars, customer_name,
    date, paid, payment_method, source)
  VALUES (v_org, v_user, v_prod, 'ZZ primer producto', 1,
          5000, 5000, 2000, 3000, 'ZZ', CURRENT_DATE, true, 'efectivo', 'pos')
  RETURNING id INTO v_venta;

  -- ── a. La primera venta SÍ llega al libro ───────────────────────────────
  SELECT count(*) INTO v_plan     FROM public.ledger_accounts WHERE org_id = v_org;
  SELECT count(*) INTO v_asientos FROM public.ledger_entries  WHERE org_id = v_org;

  ASSERT v_plan > 0,  'el plan de cuentas no se sembro solo';
  ASSERT v_asientos > 0,
    'la primera venta de un comercio nuevo NO llego al libro: el P&L le arranca vacio';

  -- ── b. ⚠️ Y no se duplica al asentar de nuevo ───────────────────────────
  -- `ledger_asentar_venta` es idempotente; sembrar el plan en cada asiento no
  -- puede romper eso. Sin esta mitad, un plan resembrado podria generar un
  -- segundo asiento y el P&L contaria la venta dos veces.
  v_antes := v_asientos;
  PERFORM public.ledger_asentar_venta(v_venta);
  SELECT count(*) INTO v_asientos FROM public.ledger_entries WHERE org_id = v_org;
  ASSERT v_asientos = v_antes,
    'asentar dos veces la misma venta creo ' || (v_asientos - v_antes) || ' asiento(s) de mas';

  -- ── c. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.sales           WHERE org_id = v_org;
  DELETE FROM public.stock_movements WHERE org_id = v_org;
  DELETE FROM public.organizations   WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ comercio nuevo';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: el comercio nuevo asienta su primera venta, sin duplicar, sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000120', 'el_segundo_comercio_perdia_su_primer_asiento')
ON CONFLICT DO NOTHING;
