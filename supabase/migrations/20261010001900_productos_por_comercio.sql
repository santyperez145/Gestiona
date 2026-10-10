-- ═══════════════════════════════════════════════════════════════════════════
-- Productos Nerqia por comercio y lo que pagan hoy, para Platform
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §6 y §8: «productos Nerqia usados por comercio» es métrica del motor
-- pegajoso, y lo que cada comercio dice pagar por herramientas sueltas es el
-- insumo de E2 (entrevistas) y E5 (ofrecer Starter). 20261010001800 lo medía
-- sólo para el propio comercio en Mi plan; Platform no tenía cómo verlo junto.
--
--   · `_senales_uso_nerqia(p_org)` y `_herramientas_reemplazadas_json(p_org)`:
--     única definición de las señales y de los montos (antes vivían dentro de
--     `uso_de_nerqia`). Postgres chequea las funciones de una vista contra
--     quien consulta, no contra el dueño de la vista: por eso tienen EXECUTE
--     para authenticated y una guarda propia (miembro del comercio o
--     administrador de plataforma).
--   · `platform_org_productos_nerqia`: una fila por comercio con las señales,
--     cuántos productos usa, qué herramientas cargó y cuánto suman. Sólo
--     administradores de plataforma (mismo filtro que las demás vistas
--     `platform_org_*`).
--
-- Idempotente. Reversible: DROP VIEW, restaurar uso_de_nerqia de 001800.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._senales_uso_nerqia(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desde timestamptz := now() - interval '30 days';
  v_desde_creators timestamptz := now() - interval '90 days';
  v_ventas bigint;
  v_facturas bigint;
  v_compras bigint;
  v_pedidos bigint;
  v_gastos bigint;
  v_comprobantes bigint;
  v_campanias bigint;
  v_canjes bigint;
  v_emails bigint;
  v_contactos bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_org_member(p_org, auth.uid())
                                OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'No tenés acceso a este comercio' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_ventas FROM public.sales WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_facturas FROM public.invoices WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_compras FROM public.purchases WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_pedidos FROM public.ecommerce_orders WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_gastos FROM public.expenses WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_comprobantes FROM public.finance_documents WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_campanias FROM public.influencer_campaigns WHERE org_id = p_org AND created_at >= v_desde_creators;
  SELECT count(*) INTO v_canjes FROM public.influencer_exchanges WHERE org_id = p_org AND created_at >= v_desde_creators;
  SELECT count(*) INTO v_emails FROM public.email_campaigns WHERE org_id = p_org AND created_at >= v_desde;
  SELECT count(*) INTO v_contactos FROM public.crm_contacts WHERE org_id = p_org AND created_at >= v_desde;

  RETURN jsonb_build_array(
    jsonb_build_object('producto', 'commerce', 'dias', 30,
      'senales', jsonb_build_object('pedidos_online', v_pedidos)),
    jsonb_build_object('producto', 'business', 'dias', 30,
      'senales', jsonb_build_object('ventas', v_ventas, 'facturas', v_facturas, 'compras', v_compras)),
    jsonb_build_object('producto', 'finance', 'dias', 30,
      'senales', jsonb_build_object('gastos', v_gastos, 'comprobantes', v_comprobantes)),
    jsonb_build_object('producto', 'creators', 'dias', 90,
      'senales', jsonb_build_object('campanias', v_campanias, 'canjes', v_canjes)),
    -- Profit no tiene registros propios: calcula el margen de las ventas y
    -- pedidos. Se usa si hay operaciones de las que sacar margen.
    jsonb_build_object('producto', 'profit', 'dias', 30,
      'senales', jsonb_build_object('operaciones_con_margen', v_ventas + v_pedidos)),
    jsonb_build_object('producto', 'growth', 'dias', 30,
      'senales', jsonb_build_object('campanias_email', v_emails, 'contactos_nuevos', v_contactos))
  );
END;
$$;

REVOKE ALL ON FUNCTION public._senales_uso_nerqia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._senales_uso_nerqia(uuid) TO authenticated;

COMMENT ON FUNCTION public._senales_uso_nerqia(uuid) IS
  'Señales de uso por producto Nerqia (30 días, Creators 90). La usan uso_de_nerqia y platform_org_productos_nerqia; exige ser miembro o administrador de plataforma.';

CREATE OR REPLACE FUNCTION public._herramientas_reemplazadas_json(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_org_member(p_org, auth.uid())
                                OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'No tenés acceso a este comercio' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'producto', h.producto,
      'herramienta', h.herramienta,
      'monto_mensual_ars', h.monto_mensual_ars,
      'updated_at', h.updated_at) ORDER BY h.producto)
    FROM public.herramientas_reemplazadas h
    WHERE h.org_id = p_org), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public._herramientas_reemplazadas_json(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._herramientas_reemplazadas_json(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.uso_de_nerqia(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a este comercio' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'medido_at', now(),
    'productos', public._senales_uso_nerqia(p_org),
    'herramientas', public._herramientas_reemplazadas_json(p_org)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.uso_de_nerqia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.uso_de_nerqia(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.platform_org_productos_nerqia AS
SELECT
  organization.id AS org_id,
  organization.name AS org_name,
  organization.created_at AS org_creada,
  senales.productos,
  (SELECT count(*)::int
     FROM jsonb_array_elements(senales.productos) producto
    WHERE EXISTS (
      SELECT 1 FROM jsonb_each_text(producto->'senales') senal
       WHERE senal.value::numeric > 0)) AS productos_en_uso,
  public._herramientas_reemplazadas_json(organization.id) AS herramientas,
  COALESCE((SELECT sum(h.monto_mensual_ars) FROM public.herramientas_reemplazadas h
             WHERE h.org_id = organization.id), 0) AS paga_hoy_ars,
  (SELECT count(*)::int FROM public.herramientas_reemplazadas h
    WHERE h.org_id = organization.id AND h.monto_mensual_ars > 0) AS herramientas_cargadas
FROM public.organizations organization
CROSS JOIN LATERAL (SELECT public._senales_uso_nerqia(organization.id) AS productos) senales
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_org_productos_nerqia SET (security_invoker = false);
REVOKE ALL ON public.platform_org_productos_nerqia FROM PUBLIC, anon;
GRANT SELECT ON public.platform_org_productos_nerqia TO authenticated;

COMMENT ON VIEW public.platform_org_productos_nerqia IS
  'Productos Nerqia que usa cada comercio y lo que declaró pagar por las herramientas que reemplazan (TESIS §6, E2, E5). Sólo administradores de plataforma.';

COMMIT;
