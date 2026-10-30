-- Ajustes de precio con historial y deshacer (2026-10-30).
--
-- Con inflación, el comercio ajusta precios todas las semanas: por porcentaje
-- (`ajustar_precios_en_bloque`), por cotización
-- (`actualizar_precios_por_cotizacion`) o desde el costo en dólares
-- (`recalcular_precios_desde_costo_usd`). Un ajuste equivocado (un 80% en vez
-- de 8%, la categoría que no era) dejaba miles de precios mal y la única
-- salida era otro ajuste a ojo. Ni Mercado Libre ni Tiendanube lo resuelven.
--
--   1. `aplicar_ajuste_de_precios` envuelve los tres ajustes sin cambiarlos:
--      saca una foto de precios y costos del negocio, aplica, y guarda antes
--      y después de cada producto que cambió, como una operación con nombre.
--   2. `deshacer_ajuste_de_precios` vuelve cada producto a su foto anterior
--      salvo los que alguien volvió a tocar después (no pisa trabajo
--      posterior; los cuenta). Una vez, dentro de los 30 días, con permiso de
--      editar productos. El historial de precios registra la vuelta.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ajustes_de_precio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('porcentaje', 'cotizacion', 'costo_usd')),
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  productos integer NOT NULL DEFAULT 0,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deshecho_at timestamptz,
  deshecho_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deshecho_resumen jsonb
);
CREATE INDEX IF NOT EXISTS ajustes_de_precio_org_idx ON public.ajustes_de_precio(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ajustes_de_precio_items (
  ajuste_id uuid NOT NULL REFERENCES public.ajustes_de_precio(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  antes jsonb NOT NULL,
  despues jsonb NOT NULL,
  PRIMARY KEY (ajuste_id, product_id)
);

ALTER TABLE public.ajustes_de_precio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ajustes_de_precio_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "miembros leen ajustes de precio" ON public.ajustes_de_precio;
CREATE POLICY "miembros leen ajustes de precio" ON public.ajustes_de_precio
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
-- Los ítems sólo los leen las funciones (pueden ser miles por ajuste).
REVOKE ALL ON public.ajustes_de_precio, public.ajustes_de_precio_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ajustes_de_precio TO authenticated;

-- Las columnas que tocan los ajustes, como jsonb comparable.
CREATE OR REPLACE FUNCTION public.foto_precio_producto(p public.products)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'sale_price_ars', p.sale_price_ars, 'discount_price_ars', p.discount_price_ars,
    'price_2x_ars', p.price_2x_ars, 'cost_ars', p.cost_ars, 'cost_usd', p.cost_usd,
    'customs_fee', p.customs_fee, 'total_cost_usd', p.total_cost_usd,
    'profit_per_unit_ars', p.profit_per_unit_ars, 'profit_per_unit_usd', p.profit_per_unit_usd);
$fn$;
REVOKE ALL ON FUNCTION public.foto_precio_producto(public.products) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aplicar_ajuste_de_precios(p_org uuid, p_origen text, p_parametros jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_antes jsonb;
  v_resultado jsonb;
  v_ajuste uuid;
  v_productos integer;
  a jsonb := COALESCE(p_parametros, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organización' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'products', 'edit', 'ajustar precios');
  IF p_origen NOT IN ('porcentaje', 'cotizacion', 'costo_usd') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido' USING ERRCODE = '22023';
  END IF;
  -- Un ajuste a la vez por negocio: la foto tiene que ser la de verdad.
  PERFORM pg_advisory_xact_lock(hashtextextended('ajuste_de_precios:' || p_org::text, 0));

  SELECT COALESCE(jsonb_object_agg(p.id::text, public.foto_precio_producto(p)), '{}'::jsonb)
    INTO v_antes FROM public.products p WHERE p.org_id = p_org;

  IF p_origen = 'porcentaje' THEN
    v_resultado := public.ajustar_precios_en_bloque(
      p_org, (a->>'porcentaje')::numeric, a->>'que', NULLIF(a->>'categoria', ''), NULLIF(a->>'marca', ''),
      NULLIF(a->>'proveedor', '')::uuid, COALESCE((a->>'redondeo')::integer, 1), true);
  ELSIF p_origen = 'cotizacion' THEN
    v_resultado := public.actualizar_precios_por_cotizacion(
      p_org, a->>'nombre', (a->>'rate_before')::numeric, (a->>'rate_after')::numeric,
      a->>'margin_type', (a->>'margin_value')::numeric, NULLIF(a->>'categoria', ''));
  ELSE
    v_resultado := public.recalcular_precios_desde_costo_usd(
      p_org, (a->>'tipo_cambio')::numeric, (a->>'markup_pct')::numeric, NULLIF(a->>'categoria', ''));
  END IF;

  INSERT INTO public.ajustes_de_precio (org_id, origen, parametros, creado_por)
  VALUES (p_org, p_origen, a, auth.uid()) RETURNING id INTO v_ajuste;

  INSERT INTO public.ajustes_de_precio_items (ajuste_id, product_id, antes, despues)
  SELECT v_ajuste, p.id, v_antes->(p.id::text), public.foto_precio_producto(p)
    FROM public.products p
   WHERE p.org_id = p_org AND v_antes ? p.id::text
     AND v_antes->(p.id::text) IS DISTINCT FROM public.foto_precio_producto(p);
  GET DIAGNOSTICS v_productos = ROW_COUNT;
  UPDATE public.ajustes_de_precio SET productos = v_productos WHERE id = v_ajuste;

  RETURN COALESCE(v_resultado, '{}'::jsonb) || jsonb_build_object('ajuste_id', v_ajuste, 'productos_cambiados', v_productos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.aplicar_ajuste_de_precios(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_ajuste_de_precios(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.deshacer_ajuste_de_precios(p_ajuste uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ajuste public.ajustes_de_precio%ROWTYPE;
  v_item public.ajustes_de_precio_items%ROWTYPE;
  v_actual jsonb;
  v_restaurados integer := 0;
  v_respetados integer := 0;
  v_resumen jsonb;
BEGIN
  SELECT * INTO v_ajuste FROM public.ajustes_de_precio WHERE id = p_ajuste FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajuste inexistente' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_ajuste.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organización' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(v_ajuste.org_id, 'products', 'edit', 'deshacer un ajuste de precios');
  IF v_ajuste.deshecho_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este ajuste ya se deshizo' USING ERRCODE = '22023';
  END IF;
  IF v_ajuste.created_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'Pasaron más de 30 días: hacé un ajuste nuevo' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ajuste_de_precios:' || v_ajuste.org_id::text, 0));

  FOR v_item IN SELECT * FROM public.ajustes_de_precio_items WHERE ajuste_id = p_ajuste LOOP
    SELECT public.foto_precio_producto(p) INTO v_actual FROM public.products p
     WHERE p.id = v_item.product_id AND p.org_id = v_ajuste.org_id FOR UPDATE;
    IF v_actual IS NULL THEN CONTINUE; END IF;
    IF v_actual = v_item.despues THEN
      UPDATE public.products p SET
        sale_price_ars = (v_item.antes->>'sale_price_ars')::numeric,
        discount_price_ars = (v_item.antes->>'discount_price_ars')::numeric,
        price_2x_ars = (v_item.antes->>'price_2x_ars')::numeric,
        cost_ars = (v_item.antes->>'cost_ars')::numeric,
        cost_usd = (v_item.antes->>'cost_usd')::numeric,
        customs_fee = (v_item.antes->>'customs_fee')::numeric,
        total_cost_usd = (v_item.antes->>'total_cost_usd')::numeric,
        profit_per_unit_ars = (v_item.antes->>'profit_per_unit_ars')::numeric,
        profit_per_unit_usd = (v_item.antes->>'profit_per_unit_usd')::numeric
      WHERE p.id = v_item.product_id;
      v_restaurados := v_restaurados + 1;
    ELSE
      v_respetados := v_respetados + 1;
    END IF;
  END LOOP;

  v_resumen := jsonb_build_object('restaurados', v_restaurados, 'con_cambios_posteriores', v_respetados);
  UPDATE public.ajustes_de_precio SET deshecho_at = now(), deshecho_por = auth.uid(), deshecho_resumen = v_resumen
   WHERE id = p_ajuste;
  RETURN jsonb_build_object('ok', true) || v_resumen;
END;
$fn$;
REVOKE ALL ON FUNCTION public.deshacer_ajuste_de_precios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deshacer_ajuste_de_precios(uuid) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('aplicar_ajuste_de_precios', 'authenticated_delegate', 'Envuelve los ajustes de precio existentes con su permiso de editar productos y guarda antes/después para poder deshacer.'),
  ('deshacer_ajuste_de_precios', 'authenticated_delegate', 'Vuelve un ajuste de precios a la foto anterior sin pisar cambios posteriores; una vez, 30 días, permiso de editar productos.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
