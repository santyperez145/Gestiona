-- Deudas: planes de pago en la base, con cuotas que se pagan cobrando.
--
-- Páginas legacy (pedido del dueño 2026-10-14). Medido en el código: el plan
-- de cuotas de una deuda vivía en el navegador (localStorage), así que no se
-- veía desde otro equipo ni lo veía otro usuario; «marcar cuota pagada» sólo
-- cambiaba un tilde, sin registrar el cobro ni bajar la deuda (el plan podía
-- decir «3/6 pagadas» con la deuda entera); y cada cuota se redondeaba aparte,
-- así que la suma no daba el saldo.
--
-- · `planes_de_pago`: un plan por deuda. Los miembros lo leen; sólo se crea o
--   cambia con `guardar_plan_de_pago` y lo borran el dueño o un administrador
--   (los mismos que manejan deudas).
-- · `guardar_plan_de_pago` reparte el saldo de la deuda en N cuotas (la última
--   absorbe el redondeo, así suman exacto), con fechas semanales, quincenales o
--   mensuales, y guarda lo ya pagado al crearlo. Una cuota está pagada cuando lo
--   cobrado a la deuda desde entonces la cubre: el estado sale de los cobros
--   reales (cobrar_cuenta_corriente), no de un tilde.
-- Idempotente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.planes_de_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL UNIQUE REFERENCES public.debts(id) ON DELETE CASCADE,
  frecuencia text NOT NULL CHECK (frecuencia IN ('semanal', 'quincenal', 'mensual')),
  cuotas jsonb NOT NULL CHECK (jsonb_typeof(cuotas) = 'array' AND jsonb_array_length(cuotas) BETWEEN 1 AND 36),
  pagado_al_crear numeric(14,2) NOT NULL DEFAULT 0,
  creado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planes_de_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planes_de_pago_leer ON public.planes_de_pago;
CREATE POLICY planes_de_pago_leer ON public.planes_de_pago
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS planes_de_pago_borrar ON public.planes_de_pago;
CREATE POLICY planes_de_pago_borrar ON public.planes_de_pago
  FOR DELETE TO authenticated USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']));
REVOKE ALL ON public.planes_de_pago FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE ON public.planes_de_pago FROM authenticated;
GRANT SELECT, DELETE ON public.planes_de_pago TO authenticated;
GRANT ALL ON public.planes_de_pago TO service_role;
CREATE INDEX IF NOT EXISTS planes_de_pago_org_idx ON public.planes_de_pago (org_id);

CREATE OR REPLACE FUNCTION public.guardar_plan_de_pago(p_debt_id uuid, p_cantidad int, p_frecuencia text, p_desde date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d record;
  v_n int := coalesce(p_cantidad, 0);
  v_frec text := lower(btrim(coalesce(p_frecuencia, '')));
  v_base numeric(14,2);
  v_cuotas jsonb := '[]'::jsonb;
  v_fecha date;
  v_monto numeric(14,2);
  i int;
  v_plan public.planes_de_pago;
BEGIN
  SELECT id, org_id, remaining_ars, paid_ars, status INTO d FROM public.debts WHERE id = p_debt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la deuda' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_org_role(d.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden armar planes de pago' USING ERRCODE = '42501';
  END IF;
  IF d.status NOT IN ('pending', 'partial') OR coalesce(d.remaining_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'La deuda no tiene saldo para repartir en cuotas' USING ERRCODE = '22023';
  END IF;
  IF v_n < 1 OR v_n > 36 THEN
    RAISE EXCEPTION 'Elegí entre 1 y 36 cuotas' USING ERRCODE = '22023';
  END IF;
  IF v_frec NOT IN ('semanal', 'quincenal', 'mensual') THEN
    RAISE EXCEPTION 'Frecuencia no válida: %', p_frecuencia USING ERRCODE = '22023';
  END IF;
  IF p_desde IS NULL THEN
    RAISE EXCEPTION 'Elegí la fecha de la primera cuota' USING ERRCODE = '22023';
  END IF;

  -- Cuotas iguales al centavo; la última absorbe la diferencia y la suma da exacto.
  v_base := floor(d.remaining_ars * 100 / v_n) / 100;
  FOR i IN 0 .. v_n - 1 LOOP
    v_fecha := CASE v_frec WHEN 'semanal' THEN p_desde + i * 7
                           WHEN 'quincenal' THEN p_desde + i * 14
                           ELSE (p_desde + make_interval(months => i))::date END;
    v_monto := CASE WHEN i = v_n - 1 THEN d.remaining_ars - v_base * (v_n - 1) ELSE v_base END;
    v_cuotas := v_cuotas || jsonb_build_array(jsonb_build_object('fecha', v_fecha, 'monto', v_monto));
  END LOOP;

  INSERT INTO public.planes_de_pago (org_id, debt_id, frecuencia, cuotas, pagado_al_crear, creado_por)
  VALUES (d.org_id, d.id, v_frec, v_cuotas, coalesce(d.paid_ars, 0), auth.uid())
  ON CONFLICT (debt_id) DO UPDATE
    SET frecuencia = EXCLUDED.frecuencia, cuotas = EXCLUDED.cuotas, pagado_al_crear = EXCLUDED.pagado_al_crear,
        creado_por = EXCLUDED.creado_por, updated_at = now()
  RETURNING * INTO v_plan;
  RETURN to_jsonb(v_plan);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_plan_de_pago(uuid, int, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_plan_de_pago(uuid, int, text, date) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'guardar_plan_de_pago', pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige dueño o administrador del negocio de la deuda (has_org_role) y sólo escribe el plan de esa deuda.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-14'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'guardar_plan_de_pago'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
