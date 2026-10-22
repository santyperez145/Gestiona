-- Remitos de entrega numerados, con entregas parciales.
--
-- El circuito mayorista argentino es presupuesto → venta → remito (lo que se
-- entregó, a quién y cuándo) → cobro en cuenta corriente. Nerqia tenía un PDF
-- «remito» suelto del presupuesto: sin número, sin registro, sin saber qué
-- falta entregar de una venta. Una ferretería que entrega en dos o tres viajes
-- no podía documentarlo.
--
-- Esta migración:
--   1. `remito_talonarios`: punto de venta y próximo número por negocio, y el
--      CAI de ARCA si el comercio tiene talonario autorizado. Con CAI vigente
--      el remito es «R» (vale para el traslado); sin CAI es «X» («documento no
--      válido como factura»).
--   2. `remitos` y `remito_items`. Un renglón puede salir de una venta: no se
--      entrega más de lo vendido menos lo devuelto y lo ya remitido (los
--      anulados no cuentan). El stock no se mueve: ya lo movió la venta.
--   3. Las escrituras son sólo por funciones (numeración atómica, controles):
--      emitir, marcar entregado, anular y configurar el talonario.
-- Idempotente. Reversible: DROP TABLE remito_items, remitos, remito_talonarios
-- y DROP FUNCTION de las cuatro funciones.
BEGIN;

CREATE TABLE IF NOT EXISTS public.remito_talonarios (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  punto_venta integer NOT NULL DEFAULT 1 CHECK (punto_venta BETWEEN 1 AND 99999),
  proximo_numero bigint NOT NULL DEFAULT 1 CHECK (proximo_numero >= 1),
  cai text CHECK (cai IS NULL OR cai ~ '^[0-9]{14}$'),
  cai_vence date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remito_talonarios_cai_completo CHECK ((cai IS NULL) = (cai_vence IS NULL))
);

CREATE TABLE IF NOT EXISTS public.remitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  punto_venta integer NOT NULL,
  numero bigint NOT NULL,
  letra text NOT NULL CHECK (letra IN ('R', 'X')),
  cai text,
  cai_vence date,
  fecha date NOT NULL,
  sale_transaction_id uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  cliente_nombre text NOT NULL CHECK (length(btrim(cliente_nombre)) BETWEEN 1 AND 200),
  cliente_cuit text CHECK (cliente_cuit IS NULL OR length(cliente_cuit) <= 20),
  cliente_domicilio text CHECK (cliente_domicilio IS NULL OR length(cliente_domicilio) <= 300),
  transportista text CHECK (transportista IS NULL OR length(transportista) <= 200),
  bultos integer CHECK (bultos IS NULL OR bultos > 0),
  valor_declarado numeric(15,2) CHECK (valor_declarado IS NULL OR valor_declarado >= 0),
  observaciones text CHECK (observaciones IS NULL OR length(observaciones) <= 1000),
  estado text NOT NULL DEFAULT 'emitido' CHECK (estado IN ('emitido', 'entregado', 'anulado')),
  entregado_at timestamptz,
  recibio_nombre text CHECK (recibio_nombre IS NULL OR length(recibio_nombre) <= 200),
  recibio_dni text CHECK (recibio_dni IS NULL OR length(recibio_dni) <= 20),
  anulado_at timestamptz,
  anulado_motivo text CHECK (anulado_motivo IS NULL OR length(anulado_motivo) <= 500),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remitos_numero_unico UNIQUE (org_id, punto_venta, numero)
);

CREATE TABLE IF NOT EXISTS public.remito_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remito_id uuid NOT NULL REFERENCES public.remitos(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  descripcion text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 300),
  cantidad numeric(14,3) NOT NULL CHECK (cantidad > 0),
  unidad text NOT NULL DEFAULT 'un' CHECK (length(unidad) <= 20)
);

CREATE INDEX IF NOT EXISTS remitos_org_fecha_idx ON public.remitos (org_id, fecha DESC);
CREATE INDEX IF NOT EXISTS remitos_transaccion_idx ON public.remitos (org_id, sale_transaction_id);
CREATE INDEX IF NOT EXISTS remito_items_remito_idx ON public.remito_items (remito_id);
CREATE INDEX IF NOT EXISTS remito_items_venta_idx ON public.remito_items (sale_id);

COMMENT ON TABLE public.remitos IS
  'Remitos de entrega numerados por punto de venta. «R» con CAI vigente, «X» sin CAI. Se emiten, entregan y anulan sólo por funciones.';

ALTER TABLE public.remito_talonarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remito_talonarios_leer ON public.remito_talonarios;
CREATE POLICY remito_talonarios_leer ON public.remito_talonarios
  FOR SELECT TO authenticated USING (public.has_permission(org_id, 'sales', 'view'));
DROP POLICY IF EXISTS remitos_leer ON public.remitos;
CREATE POLICY remitos_leer ON public.remitos
  FOR SELECT TO authenticated USING (public.has_permission(org_id, 'sales', 'view'));
DROP POLICY IF EXISTS remito_items_leer ON public.remito_items;
CREATE POLICY remito_items_leer ON public.remito_items
  FOR SELECT TO authenticated USING (public.has_permission(org_id, 'sales', 'view'));

REVOKE ALL ON public.remito_talonarios, public.remitos, public.remito_items FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.remito_talonarios, public.remitos, public.remito_items FROM authenticated;
GRANT SELECT ON public.remito_talonarios, public.remitos, public.remito_items TO authenticated;
GRANT ALL ON public.remito_talonarios, public.remitos, public.remito_items TO service_role;

-- ── Emitir ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emitir_remito(p_org uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  v_fecha date := coalesce(nullif(p_datos->>'fecha', '')::date, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  v_tal public.remito_talonarios;
  v_remito public.remitos;
  v_transaccion uuid;
  v_cliente uuid;
  v_sale public.sales;
  v_prod uuid;
  v_desc text;
  v_cant numeric;
  v_pendiente numeric;
  v_n int := 0;
  it jsonb;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso para emitir remitos en este negocio' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un renglón al remito' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 300 THEN
    RAISE EXCEPTION 'Un remito puede tener hasta 300 renglones' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_datos->>'sale_transaction_id', '') ~* v_uuid THEN
    v_transaccion := (p_datos->>'sale_transaction_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.org_id = p_org AND s.sale_transaction_id = v_transaccion) THEN
      RAISE EXCEPTION 'La venta no es de este negocio' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF coalesce(p_datos->>'customer_id', '') ~* v_uuid THEN
    v_cliente := (p_datos->>'customer_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_cliente AND c.org_id = p_org) THEN
      RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Numeración atómica: dos remitos a la vez no pueden tomar el mismo número.
  INSERT INTO public.remito_talonarios (org_id) VALUES (p_org) ON CONFLICT (org_id) DO NOTHING;
  SELECT * INTO v_tal FROM public.remito_talonarios WHERE org_id = p_org FOR UPDATE;

  INSERT INTO public.remitos (org_id, punto_venta, numero, letra, cai, cai_vence, fecha, sale_transaction_id, customer_id,
    cliente_nombre, cliente_cuit, cliente_domicilio, transportista, bultos, valor_declarado, observaciones, created_by)
  VALUES (p_org, v_tal.punto_venta, v_tal.proximo_numero,
    CASE WHEN v_tal.cai IS NOT NULL AND v_tal.cai_vence >= v_fecha THEN 'R' ELSE 'X' END,
    CASE WHEN v_tal.cai IS NOT NULL AND v_tal.cai_vence >= v_fecha THEN v_tal.cai END,
    CASE WHEN v_tal.cai IS NOT NULL AND v_tal.cai_vence >= v_fecha THEN v_tal.cai_vence END,
    v_fecha, v_transaccion, v_cliente,
    coalesce(left(nullif(btrim(coalesce(p_datos->>'cliente_nombre', '')), ''), 200), 'Consumidor final'),
    left(nullif(btrim(coalesce(p_datos->>'cliente_cuit', '')), ''), 20),
    left(nullif(btrim(coalesce(p_datos->>'cliente_domicilio', '')), ''), 300),
    left(nullif(btrim(coalesce(p_datos->>'transportista', '')), ''), 200),
    nullif(public._numero_o_nulo(p_datos->>'bultos'), 0)::int,
    public._numero_o_nulo(p_datos->>'valor_declarado'),
    left(nullif(btrim(coalesce(p_datos->>'observaciones', '')), ''), 1000),
    auth.uid())
  RETURNING * INTO v_remito;

  UPDATE public.remito_talonarios SET proximo_numero = proximo_numero + 1, updated_at = now() WHERE org_id = p_org;

  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_n := v_n + 1;
    v_cant := public._numero_o_nulo(it->>'cantidad');
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Renglón %: la cantidad tiene que ser mayor a cero', v_n USING ERRCODE = '22023';
    END IF;
    v_prod := NULL;
    v_desc := left(nullif(btrim(coalesce(it->>'descripcion', '')), ''), 300);

    IF coalesce(it->>'sale_id', '') ~* v_uuid THEN
      -- Se bloquea el renglón de la venta: dos remitos a la vez no entregan de más.
      SELECT * INTO v_sale FROM public.sales WHERE id = (it->>'sale_id')::uuid AND org_id = p_org FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Renglón %: la venta no es de este negocio', v_n USING ERRCODE = '22023'; END IF;
      IF v_transaccion IS NOT NULL AND v_sale.sale_transaction_id IS DISTINCT FROM v_transaccion THEN
        RAISE EXCEPTION 'Renglón %: no es de esta venta', v_n USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(v_sale.quantity, 0) - coalesce(v_sale.returned_quantity, 0) - coalesce(sum(ri.cantidad), 0)
        INTO v_pendiente
        FROM public.remito_items ri JOIN public.remitos r ON r.id = ri.remito_id
       WHERE ri.sale_id = v_sale.id AND r.estado <> 'anulado' AND r.id <> v_remito.id;
      IF v_cant > v_pendiente + 0.0005 THEN
        RAISE EXCEPTION 'Renglón %: de «%» quedan % por entregar', v_n, v_sale.product_name, greatest(v_pendiente, 0) USING ERRCODE = '22023';
      END IF;
      v_prod := v_sale.product_id;
      v_desc := coalesce(v_desc, left(v_sale.product_name, 300));
    ELSIF coalesce(it->>'product_id', '') ~* v_uuid THEN
      SELECT id, coalesce(v_desc, left(name, 300)) INTO v_prod, v_desc FROM public.products
       WHERE id = (it->>'product_id')::uuid AND org_id = p_org;
      IF v_prod IS NULL THEN RAISE EXCEPTION 'Renglón %: el producto no es de este negocio', v_n USING ERRCODE = '22023'; END IF;
    END IF;
    IF v_desc IS NULL THEN
      RAISE EXCEPTION 'Renglón %: falta qué se entrega', v_n USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.remito_items (remito_id, org_id, sale_id, product_id, descripcion, cantidad, unidad)
    VALUES (v_remito.id, p_org, CASE WHEN coalesce(it->>'sale_id', '') ~* v_uuid THEN (it->>'sale_id')::uuid END,
            v_prod, v_desc, round(v_cant, 3), coalesce(left(nullif(btrim(coalesce(it->>'unidad', '')), ''), 20), 'un'));
  END LOOP;

  RETURN to_jsonb(v_remito) || jsonb_build_object('renglones', v_n);
END;
$fn$;

-- ── Entregado ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_remito_entregado(p_remito uuid, p_recibio_nombre text, p_recibio_dni text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_r public.remitos;
BEGIN
  SELECT * INTO v_r FROM public.remitos WHERE id = p_remito FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.has_permission(v_r.org_id, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso sobre este remito' USING ERRCODE = '42501';
  END IF;
  IF v_r.estado <> 'emitido' THEN
    RAISE EXCEPTION 'El remito ya está %', v_r.estado USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_recibio_nombre, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Falta quién recibió' USING ERRCODE = '22023';
  END IF;
  UPDATE public.remitos
     SET estado = 'entregado', entregado_at = now(),
         recibio_nombre = left(btrim(p_recibio_nombre), 200),
         recibio_dni = left(nullif(btrim(coalesce(p_recibio_dni, '')), ''), 20)
   WHERE id = p_remito
  RETURNING * INTO v_r;
  RETURN to_jsonb(v_r);
END;
$fn$;

-- ── Anular ─────────────────────────────────────────────────────────────────
-- El número no se reusa; lo que estaba remitido vuelve a quedar pendiente.
CREATE OR REPLACE FUNCTION public.anular_remito(p_remito uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_r public.remitos;
BEGIN
  SELECT * INTO v_r FROM public.remitos WHERE id = p_remito FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT (
       public.has_permission(v_r.org_id, 'sales', 'delete')
       OR public.has_org_role(v_r.org_id, auth.uid(), ARRAY['owner', 'admin'])) THEN
    RAISE EXCEPTION 'No tenés permiso para anular este remito' USING ERRCODE = '42501';
  END IF;
  IF v_r.estado = 'anulado' THEN RAISE EXCEPTION 'El remito ya está anulado' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN RAISE EXCEPTION 'Contá por qué se anula' USING ERRCODE = '22023'; END IF;
  UPDATE public.remitos
     SET estado = 'anulado', anulado_at = now(), anulado_motivo = left(btrim(p_motivo), 500)
   WHERE id = p_remito
  RETURNING * INTO v_r;
  RETURN to_jsonb(v_r);
END;
$fn$;

-- ── Talonario ──────────────────────────────────────────────────────────────
-- El próximo número sólo avanza: un talonario preimpreso puede empezar en el
-- 501, pero nunca se vuelve a un número ya emitido.
CREATE OR REPLACE FUNCTION public.configurar_talonario_remitos(
  p_org uuid, p_punto_venta integer, p_cai text, p_cai_vence date, p_proximo_numero bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tal public.remito_talonarios;
  v_cai text := nullif(regexp_replace(coalesce(p_cai, ''), '\D', '', 'g'), '');
  v_minimo bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador configuran el talonario' USING ERRCODE = '42501';
  END IF;
  IF p_punto_venta IS NULL OR p_punto_venta NOT BETWEEN 1 AND 99999 THEN
    RAISE EXCEPTION 'El punto de venta va de 1 a 99999' USING ERRCODE = '22023';
  END IF;
  IF v_cai IS NOT NULL AND v_cai !~ '^[0-9]{14}$' THEN RAISE EXCEPTION 'El CAI tiene 14 dígitos' USING ERRCODE = '22023'; END IF;
  IF (v_cai IS NULL) <> (p_cai_vence IS NULL) THEN
    RAISE EXCEPTION 'El CAI y su vencimiento van juntos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.remito_talonarios (org_id) VALUES (p_org) ON CONFLICT (org_id) DO NOTHING;
  SELECT * INTO v_tal FROM public.remito_talonarios WHERE org_id = p_org FOR UPDATE;
  SELECT coalesce(max(numero), 0) + 1 INTO v_minimo FROM public.remitos WHERE org_id = p_org AND punto_venta = p_punto_venta;
  IF p_proximo_numero IS NOT NULL AND p_proximo_numero < v_minimo THEN
    RAISE EXCEPTION 'El próximo número no puede ser menor a % (ya se emitió el %)', v_minimo, v_minimo - 1 USING ERRCODE = '22023';
  END IF;

  UPDATE public.remito_talonarios
     SET punto_venta = p_punto_venta,
         proximo_numero = greatest(coalesce(p_proximo_numero, CASE WHEN p_punto_venta = v_tal.punto_venta THEN v_tal.proximo_numero ELSE 1 END), v_minimo),
         cai = v_cai, cai_vence = p_cai_vence, updated_at = now()
   WHERE org_id = p_org
  RETURNING * INTO v_tal;
  RETURN to_jsonb(v_tal);
END;
$fn$;

REVOKE ALL ON FUNCTION public.emitir_remito(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marcar_remito_entregado(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anular_remito(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_talonario_remitos(uuid, integer, text, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_remito(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_remito_entregado(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_remito(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_talonario_remitos(uuid, integer, text, date, bigint) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'emitir_remito' THEN 'Exige permiso de ventas (create) en el negocio; sólo remite ventas, clientes y productos de ese negocio y no más de lo pendiente.'
         WHEN 'marcar_remito_entregado' THEN 'Exige permiso de ventas (create) en el negocio del remito y sólo cambia un remito emitido.'
         WHEN 'anular_remito' THEN 'Exige permiso de ventas (delete) o ser dueño/administrador del negocio del remito.'
         ELSE 'Exige ser dueño o administrador del negocio; el próximo número nunca retrocede.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('emitir_remito', 'marcar_remito_entregado', 'anular_remito', 'configurar_talonario_remitos')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
