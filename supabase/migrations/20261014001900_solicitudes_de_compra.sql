-- Solicitudes de compra: del pedido interno a una orden de compra real.
--
-- Funciones incoherentes (pedido del dueño 2026-10-14). Medido en el código:
-- · La pantalla insertaba `request_number: 'temp'` y set_request_number sólo
--   numera si viene vacío: toda solicitud se iba a llamar «temp».
-- · Cabecera y renglones se insertaban por separado: si fallaban los
--   renglones quedaba una solicitud vacía.
-- · La política deja todo a cualquier miembro: quien pedía podía aprobar su
--   propia solicitud, y `approved_by` no se llenaba nunca. Y al revés, los
--   renglones exigían dueño o administrador: un vendedor dejaba una vacía.
-- · «Marcar pedida» y «Recibida» eran etiquetas: no creaban una orden de
--   compra ni entraba mercadería.
--
-- Ahora:
-- · `guardar_solicitud_de_compra`: cualquier miembro pide, en una operación,
--   con productos del catálogo (o un ítem libre que no está en el catálogo);
--   la numeración la pone la base.
-- · Aprobar o rechazar sólo el dueño o un administrador, y queda quién.
-- · `convertir_solicitud_en_orden`: una solicitud aprobada se convierte en una
--   orden de compra en borrador (guardar_orden_de_compra) y queda vinculada;
--   «pedida» sólo se llega así. Cuando la orden se recibe completa, la
--   solicitud pasa a «recibida» sola.
-- Idempotente.
BEGIN;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS purchase_requests_order_idx ON public.purchase_requests (purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- Cualquier miembro pide (la cabecera ya lo permitía), pero los renglones
-- exigían dueño o administrador: un vendedor dejaba una solicitud vacía. Se
-- agregan renglones sólo a una solicitud abierta; editarlos o borrarlos sigue
-- siendo del dueño o un administrador.
DROP POLICY IF EXISTS purchase_request_items_crear ON public.purchase_request_items;
CREATE POLICY purchase_request_items_crear ON public.purchase_request_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_requests p
                       WHERE p.id = purchase_request_items.request_id
                         AND p.status IN ('draft', 'submitted')
                         AND public.is_org_member(p.org_id, auth.uid())));

-- ───────────────────────── pedir ─────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_solicitud_de_compra(p_org uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  it jsonb;
  v_n int := 0;
  v_cant numeric;
  v_precio numeric;
  v_prod uuid;
  v_nombre text;
  v_fila public.purchase_requests;
  v_titulo text := left(nullif(btrim(coalesce(p_datos->>'title', '')), ''), 200);
  v_quien text := left(nullif(btrim(coalesce(p_datos->>'requested_by', '')), ''), 120);
  v_prioridad text := coalesce(nullif(p_datos->>'priority', ''), 'normal');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de este negocio' USING ERRCODE = '42501';
  END IF;
  IF v_titulo IS NULL THEN RAISE EXCEPTION 'Poné un título a la solicitud' USING ERRCODE = '22023'; END IF;
  IF v_prioridad NOT IN ('low', 'normal', 'high', 'urgent') THEN v_prioridad := 'normal'; END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un producto' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 200 THEN
    RAISE EXCEPTION 'Una solicitud puede tener hasta 200 renglones' USING ERRCODE = '22023';
  END IF;
  IF v_quien IS NULL THEN
    SELECT nullif(btrim(display_name), '') INTO v_quien FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    v_quien := coalesce(v_quien, 'Sin nombre');
  END IF;

  INSERT INTO public.purchase_requests (org_id, request_number, title, requested_by, department, priority, status, notes, needed_by)
  VALUES (p_org, NULL, v_titulo, v_quien, nullif(btrim(coalesce(p_datos->>'department', '')), ''), v_prioridad, 'submitted',
          left(nullif(btrim(coalesce(p_datos->>'notes', '')), ''), 2000), nullif(p_datos->>'needed_by', '')::date)
  RETURNING * INTO v_fila;

  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_n := v_n + 1;
    v_cant := public._numero_o_nulo(it->>'quantity');
    v_precio := coalesce(public._numero_o_nulo(it->>'estimated_price'), 0);
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Renglón %: la cantidad tiene que ser mayor a cero', v_n USING ERRCODE = '22023';
    END IF;
    IF v_precio < 0 THEN RAISE EXCEPTION 'Renglón %: el precio no puede ser negativo', v_n USING ERRCODE = '22023'; END IF;
    v_prod := CASE WHEN coalesce(it->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (it->>'product_id')::uuid END;
    v_nombre := left(nullif(btrim(coalesce(it->>'product_name', '')), ''), 300);
    IF v_prod IS NOT NULL THEN
      SELECT coalesce(v_nombre, name) INTO v_nombre FROM public.products WHERE id = v_prod AND org_id = p_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Renglón %: el producto no es de este negocio', v_n USING ERRCODE = '22023'; END IF;
    END IF;
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'Renglón %: elegí un producto o escribí qué se necesita', v_n USING ERRCODE = '22023'; END IF;
    INSERT INTO public.purchase_request_items (request_id, product_id, product_name, description, quantity, unit, estimated_price, preferred_supplier)
    VALUES (v_fila.id, v_prod, v_nombre, nullif(btrim(coalesce(it->>'description', '')), ''), round(v_cant, 3),
            coalesce(nullif(btrim(coalesce(it->>'unit', '')), ''), 'un'), round(v_precio, 2),
            nullif(btrim(coalesce(it->>'preferred_supplier', '')), ''));
  END LOOP;

  SELECT * INTO v_fila FROM public.purchase_requests WHERE id = v_fila.id;
  RETURN to_jsonb(v_fila) || jsonb_build_object('renglones', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_solicitud_de_compra(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_solicitud_de_compra(uuid, jsonb) TO authenticated, service_role;

-- ───────────────────── aprobar, rechazar, pedir ─────────────────────
-- Quién cambia el estado y a dónde. «ordered» sólo con la orden vinculada
-- (convertir_solicitud_en_orden) y «received» sólo cuando esa orden se
-- recibió completa (disparador de purchase_orders).
CREATE OR REPLACE FUNCTION public.guard_estado_solicitud_de_compra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
                     OR (auth.uid() IS NOT NULL AND public.has_org_role(NEW.org_id, auth.uid(), ARRAY['owner', 'admin']));
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF coalesce(current_setting('gestiona.organization_deleting', true), '') = 'on' THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved', 'rejected') THEN
    IF OLD.status <> 'submitted' THEN
      RAISE EXCEPTION 'Sólo se aprueba o rechaza una solicitud enviada' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Sólo el dueño o un administrador aprueban o rechazan solicitudes' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_by := auth.uid()::text;
      NEW.approved_at := now();
      NEW.rejected_reason := NULL;
    ELSIF nullif(btrim(coalesce(NEW.rejected_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Escribí el motivo del rechazo' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'ordered' THEN
    IF OLD.status <> 'approved' OR NEW.purchase_order_id IS NULL
       OR coalesce(current_setting('gestiona.solicitud_a_orden', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Una solicitud pasa a «pedida» al convertirla en orden de compra' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'received' THEN
    IF OLD.status <> 'ordered' OR coalesce(current_setting('gestiona.solicitud_recibida', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Una solicitud pasa a «recibida» cuando se recibe su orden de compra' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'cancelled' THEN
    IF OLD.status IN ('ordered', 'received') THEN
      RAISE EXCEPTION 'Una solicitud ya pedida se cancela desde su orden de compra' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cambio de estado no permitido (% → %)', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_estado_solicitud_de_compra() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_estado_solicitud ON public.purchase_requests;
CREATE TRIGGER trg_guard_estado_solicitud
BEFORE UPDATE OF status ON public.purchase_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_estado_solicitud_de_compra();

CREATE OR REPLACE FUNCTION public.convertir_solicitud_en_orden(p_org uuid, p_solicitud uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol public.purchase_requests;
  v_orden jsonb;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador convierten solicitudes en órdenes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.purchase_requests WHERE id = p_solicitud AND org_id = p_org FOR UPDATE;
  IF v_sol.id IS NULL THEN RAISE EXCEPTION 'La solicitud no existe en este negocio' USING ERRCODE = 'P0002'; END IF;
  IF v_sol.status <> 'approved' THEN
    RAISE EXCEPTION 'Sólo una solicitud aprobada se convierte en orden (está %)', v_sol.status USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'product_name', i.product_name,
                                      'quantity_ordered', i.quantity, 'unit_cost', i.estimated_price, 'tax_rate', 0)
                   ORDER BY i.id)
    INTO v_items FROM public.purchase_request_items i WHERE i.request_id = v_sol.id;
  IF v_items IS NULL THEN RAISE EXCEPTION 'La solicitud no tiene productos' USING ERRCODE = '22023'; END IF;

  v_orden := public.guardar_orden_de_compra(p_org, NULL, jsonb_build_object(
    'supplier_id', p_datos->>'supplier_id',
    'supplier_name', p_datos->>'supplier_name',
    'supplier_email', p_datos->>'supplier_email',
    'currency', coalesce(nullif(p_datos->>'currency', ''), 'ARS'),
    'expected_date', v_sol.needed_by,
    'internal_notes', 'Solicitud ' || v_sol.request_number || ': ' || v_sol.title,
    'items', v_items));

  PERFORM set_config('gestiona.solicitud_a_orden', 'on', true);
  UPDATE public.purchase_requests SET status = 'ordered', purchase_order_id = (v_orden->>'id')::uuid WHERE id = v_sol.id;
  PERFORM set_config('gestiona.solicitud_a_orden', 'off', true);
  RETURN v_orden;
END;
$$;
REVOKE ALL ON FUNCTION public.convertir_solicitud_en_orden(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convertir_solicitud_en_orden(uuid, uuid, jsonb) TO authenticated, service_role;

-- Cuando la orden se recibe completa, la solicitud queda recibida.
CREATE OR REPLACE FUNCTION public.solicitud_recibida_con_su_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received' THEN
    PERFORM set_config('gestiona.solicitud_recibida', 'on', true);
    UPDATE public.purchase_requests SET status = 'received' WHERE purchase_order_id = NEW.id AND status = 'ordered';
    PERFORM set_config('gestiona.solicitud_recibida', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.solicitud_recibida_con_su_orden() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_solicitud_recibida_con_su_orden ON public.purchase_orders;
CREATE TRIGGER trg_solicitud_recibida_con_su_orden
AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.solicitud_recibida_con_su_orden();

COMMIT;
