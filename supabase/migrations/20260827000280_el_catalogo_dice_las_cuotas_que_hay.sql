-- El catálogo dice las cuotas que el comercio ofrece, no las que estaban escritas
--
-- ── El problema ───────────────────────────────────────────────────────────
--
-- ⚠️ El catálogo prometía **«Tarjeta 3 cuotas sin interés»** escrito a mano, en
-- tres lugares: la pantalla, el PDF que se manda por WhatsApp y el catálogo
-- público. Sin mirar nada.
--
-- Medido el 2026-08-27, el comercio tenía configuradas **3 y 12 cuotas sin
-- interés**. O sea que el texto fijo además le **subestimaba** la oferta: podía
-- ofrecer 12 y el catálogo decía 3.
--
-- 📌 Y al revés es peor: un comercio que no ofrece cuotas igual las prometía.
-- Una financiación que se promete y no existe no es un detalle de redacción —
-- es lo que hace que alguien decida comprar y después no pueda.
--
-- ── Por qué hace falta un RPC ─────────────────────────────────────────────
--
-- `org_installment_plans` sólo la leen los miembros del comercio, y el catálogo
-- público lo mira un comprador anónimo. Se expone lo justo para mostrar —
-- cuántas cuotas, si son sin interés y desde qué monto— y nada más.
--
-- Es el mismo patrón que `get_store_categories`: una función `SECURITY DEFINER`
-- que devuelve lo mostrable, en vez de abrir la tabla entera con una policy.

CREATE OR REPLACE FUNCTION public.cuotas_publicas(p_org uuid)
RETURNS TABLE (installments int, sin_interes boolean, monto_minimo numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.installments, p.sin_interes, COALESCE(p.monto_minimo, 0)
    FROM public.org_installment_plans p
   WHERE p.org_id = p_org
     AND p.activo
   ORDER BY p.installments;
$$;

COMMENT ON FUNCTION public.cuotas_publicas(uuid) IS
  'Las cuotas que un comercio ofrece, para mostrar en el catálogo. Devuelve '
  'sólo lo mostrable: cuántas, si son sin interés y desde qué monto. La tabla '
  'entera sigue siendo de los miembros.';

GRANT EXECUTE ON FUNCTION public.cuotas_publicas(uuid) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org uuid;
  v_n   int;
  v_tabla_abierta boolean;
BEGIN
  SELECT org_id INTO v_org FROM public.org_installment_plans WHERE activo LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'no hay planes de cuotas configurados: nada que verificar';
    RETURN;
  END IF;

  SET LOCAL ROLE anon;

  -- ── a. Un comprador anónimo ve las cuotas que se ofrecen ────────────────
  SELECT count(*) INTO v_n FROM public.cuotas_publicas(v_org);
  ASSERT v_n > 0, 'el catálogo público no puede saber qué cuotas hay';

  -- ── b. ⚠️ Pero NO puede leer la tabla ───────────────────────────────────
  -- Sin esta mitad, «funciona» pasaría igual con la tabla abierta a cualquiera.
  BEGIN
    PERFORM 1 FROM public.org_installment_plans LIMIT 1;
    v_tabla_abierta := FOUND;
  EXCEPTION WHEN insufficient_privilege THEN
    v_tabla_abierta := false;
  END;
  RESET ROLE;

  ASSERT NOT v_tabla_abierta,
    'la configuración de cuotas quedó legible por cualquiera';

  RAISE NOTICE 'OK: el catálogo público ve % opción(es) y la tabla sigue cerrada', v_n;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000280', 'el_catalogo_dice_las_cuotas_que_hay')
ON CONFLICT DO NOTHING;
