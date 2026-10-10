-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que reemplaza Nerqia: uso real por producto y lo que el comercio pagaba
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Experimento E5 de docs/TESIS.md: «ofrecer Starter a comercios con 4 semanas
-- de uso, mostrando lo que dejan de pagar». Hasta hoy Mi plan sólo listaba
-- límites (productos, ventas, usuarios); no decía qué herramientas sueltas
-- reemplaza el comercio ni cuánto le cuestan. Medido 2026-10-10: el único
-- comercio activo usa sólo Business (3 ventas en 30 días) y no hay ningún
-- dato de cuánto paga hoy por otras herramientas.
--
-- Dos piezas:
--   · `uso_de_nerqia(p_org)`: qué productos Nerqia usa el comercio, con la
--     señal medida (no una suposición) y la ventana. Sirve también para la
--     métrica «productos por comercio» de TESIS §6.
--   · `herramientas_reemplazadas`: lo que el propio comercio declara que paga
--     por mes por la herramienta equivalente. Nunca se inventa un precio de un
--     competidor: si no lo cargó, no hay ahorro que mostrar. Se escribe sólo
--     por `guardar_herramienta_reemplazada` (dueño o administrador).
--
-- Idempotente. Reversible: DROP FUNCTION x2 y DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.herramientas_reemplazadas (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  producto text NOT NULL CHECK (producto IN ('commerce', 'business', 'finance', 'creators', 'profit', 'growth')),
  herramienta text CHECK (herramienta IS NULL OR char_length(herramienta) BETWEEN 1 AND 80),
  monto_mensual_ars numeric(14, 2) NOT NULL CHECK (monto_mensual_ars >= 0 AND monto_mensual_ars <= 100000000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, producto)
);

ALTER TABLE public.herramientas_reemplazadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS herramientas_reemplazadas_select ON public.herramientas_reemplazadas;
CREATE POLICY herramientas_reemplazadas_select ON public.herramientas_reemplazadas
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE ALL ON public.herramientas_reemplazadas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.herramientas_reemplazadas FROM authenticated;
GRANT SELECT ON public.herramientas_reemplazadas TO authenticated;

COMMENT ON TABLE public.herramientas_reemplazadas IS
  'Lo que el comercio declara pagar por mes por la herramienta que cada producto Nerqia reemplaza (E5 de docs/TESIS.md). Sólo se escribe por guardar_herramienta_reemplazada.';

CREATE OR REPLACE FUNCTION public.uso_de_nerqia(p_org uuid)
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
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
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

  RETURN jsonb_build_object(
    'medido_at', now(),
    'productos', jsonb_build_array(
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
    ),
    'herramientas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'producto', h.producto,
        'herramienta', h.herramienta,
        'monto_mensual_ars', h.monto_mensual_ars,
        'updated_at', h.updated_at) ORDER BY h.producto)
      FROM public.herramientas_reemplazadas h
      WHERE h.org_id = p_org), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.uso_de_nerqia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.uso_de_nerqia(uuid) TO authenticated;

COMMENT ON FUNCTION public.uso_de_nerqia(uuid) IS
  'Qué productos Nerqia usa el comercio (señales medidas en 30 días, Creators en 90) y lo que declaró pagar por las herramientas que reemplazan. E5 de docs/TESIS.md.';

CREATE OR REPLACE FUNCTION public.guardar_herramienta_reemplazada(
  p_org uuid,
  p_producto text,
  p_herramienta text,
  p_monto_mensual_ars numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_herramienta text := NULLIF(btrim(p_herramienta), '');
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org, v_actor, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden cargar lo que paga el comercio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_producto IS NULL OR p_producto NOT IN ('commerce', 'business', 'finance', 'creators', 'profit', 'growth') THEN
    RAISE EXCEPTION 'Producto desconocido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_herramienta IS NOT NULL AND char_length(v_herramienta) > 80 THEN
    RAISE EXCEPTION 'El nombre de la herramienta puede tener hasta 80 caracteres' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Sin monto no hay nada que comparar: se borra lo que hubiera.
  IF p_monto_mensual_ars IS NULL THEN
    DELETE FROM public.herramientas_reemplazadas WHERE org_id = p_org AND producto = p_producto;
    RETURN;
  END IF;
  IF p_monto_mensual_ars < 0 OR p_monto_mensual_ars > 100000000 OR p_monto_mensual_ars = 'NaN'::numeric THEN
    RAISE EXCEPTION 'El monto tiene que estar entre $0 y $100.000.000 por mes' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.herramientas_reemplazadas (org_id, producto, herramienta, monto_mensual_ars, updated_by, updated_at)
  VALUES (p_org, p_producto, v_herramienta, round(p_monto_mensual_ars, 2), v_actor, now())
  ON CONFLICT (org_id, producto) DO UPDATE
    SET herramienta = EXCLUDED.herramienta,
        monto_mensual_ars = EXCLUDED.monto_mensual_ars,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_herramienta_reemplazada(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_herramienta_reemplazada(uuid, text, text, numeric) TO authenticated;

COMMENT ON FUNCTION public.guardar_herramienta_reemplazada(uuid, text, text, numeric) IS
  'Guarda (o borra con monto NULL) lo que el comercio paga por mes por la herramienta que reemplaza un producto Nerqia. Dueño o administrador.';

COMMIT;
