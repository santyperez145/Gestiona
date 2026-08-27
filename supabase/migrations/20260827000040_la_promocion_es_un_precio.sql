-- P1-04 (2/2) — El cobro y el precio también tienen puerta
--
-- ── Qué faltaba ───────────────────────────────────────────────────────────
--
-- `20260827000030` cerró las nueve funciones que mueven stock o plata. Al
-- volver a medir qué queda llamable por cualquier miembro sin permiso ni rol
-- quedaban seis, y sólo dos merecían puerta:
--
--   · `medio_de_pago_habilitar` — prende y apaga un medio de cobro. Hasta hoy
--     se frenaba, pero por «Primero conectá tu cuenta de MercadoPago»: una
--     precondición de negocio, no una autorización. El día que la cuenta está
--     conectada —que es siempre, en un comercio que vende— deja de frenar.
--
--   · `promotions` — no es una RPC: se escribe derecho contra la tabla, así
--     que la puerta es la policy. Y la policy era `ALL` con
--     `org_id IN (SELECT ... WHERE user_id = auth.uid())`: **cualquier
--     miembro** podía crear una promoción. Una promoción es un precio —se
--     resuelve dentro del precio de la línea, no como descuento aparte— así
--     que eso es dejar que un vendedor fije precios.
--
-- 📌 Lo raro no era que faltara: es que `quantity_discounts`, que hace lo
-- mismo, exige `has_org_role(owner/admin/manager)` desde que se creó. Dos
-- mecánicas de precio hermanas con dos puertas distintas, y la que valía era
-- la más floja. La ruta `/promociones` ya es `SOLO_ADMIN` en el manifest: la
-- UI decía una cosa y la base otra, otra vez.
--
-- ⚠️ **La lectura NO se toca, y no es un detalle.** El POS lee `promotions`
-- para cobrar el precio correcto (`loadActivePromotions` en
-- `src/lib/promotions.ts`, usado por POSPage y el catálogo). Apretar la policy
-- `ALL` entera le habría sacado la lectura al vendedor —que es justamente
-- quien atiende el mostrador— y el POS habría cobrado **sin la promoción**,
-- en silencio y a favor del comercio. Por eso se parte en dos, igual que
-- `quantity_discounts`: SELECT para miembros, escritura para el rol.
--
-- `promotions` tiene 0 filas hoy, así que apretarla no deja nada afuera.
--
-- ── Lo que queda abierto, dicho de frente ─────────────────────────────────
--
-- `expire_batches` y `expire_stock_reservations` (mantenimiento idempotente
-- por fecha), `marketing_template_sumar_uso` / `_like` (contadores, que
-- existen justamente para no abrir un UPDATE ancho) y `run_abc_analysis`
-- (recalcula una clasificación de lectura). Ninguna fija precio, mueve stock
-- ni saca plata.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. El medio de cobro
-- ═══════════════════════════════════════════════════════════════════════════

-- ── medio_de_pago_habilitar ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.medio_de_pago_habilitar(p_org uuid, p_provider text, p_activo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pp public.payment_providers; v_conectado boolean;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Cobros y comisiones» desmarcado en Admin → Permisos podía habilitar o apagar un medio de cobro.
  PERFORM public.exigir_permiso(p_org, 'payments', 'edit', 'habilitar o apagar un medio de cobro');

  SELECT * INTO v_pp FROM public.payment_providers WHERE codigo = p_provider AND is_active;
  IF v_pp.codigo IS NULL THEN
    RAISE EXCEPTION 'Ese medio de pago no existe';
  END IF;

  -- ⚠️ No se puede habilitar algo que no cobra. Dejarlo pasar haría que el
  -- comprador elija ese medio y el checkout falle en el último paso.
  IF p_activo AND v_pp.integracion = 'declarado' THEN
    RAISE EXCEPTION '% todavía no está integrado. Está en la lista para que sepas que viene.', v_pp.nombre;
  END IF;

  SELECT (o.conectado_at IS NOT NULL) INTO v_conectado
    FROM public.org_payment_providers o
   WHERE o.org_id = p_org AND o.provider = p_provider;

  IF p_activo AND v_pp.conexion <> 'ninguna' AND NOT COALESCE(v_conectado, false) THEN
    RAISE EXCEPTION 'Primero conectá tu cuenta de %', v_pp.nombre;
  END IF;

  INSERT INTO public.org_payment_providers (org_id, provider, habilitado)
  VALUES (p_org, p_provider, p_activo)
  ON CONFLICT (org_id, provider) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, updated_at = now();

  PERFORM public.emitir_evento(p_org, 'medio_de_pago', gen_random_uuid(),
    CASE WHEN p_activo THEN 'medio_de_pago.habilitado' ELSE 'medio_de_pago.deshabilitado' END,
    jsonb_build_object('provider', p_provider));

  RETURN jsonb_build_object('ok', true, 'provider', p_provider, 'habilitado', p_activo);
END;
$function$
;
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. La promoción es un precio: se lee entre todos, se escribe con rol
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS org_promotions          ON public.promotions;
DROP POLICY IF EXISTS promotions_org_select   ON public.promotions;
DROP POLICY IF EXISTS promotions_org_write    ON public.promotions;

-- El vendedor tiene que poder LEERLAS: sin esto el POS cobra sin la promoción.
CREATE POLICY promotions_org_select ON public.promotions
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- Escribir un precio es otra cosa. Mismo rol que `quantity_discounts`.
CREATE POLICY promotions_org_write ON public.promotions
  FOR ALL
  USING      (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']));

COMMENT ON TABLE public.promotions IS
  'Promociones del comercio. Se leen entre todos los miembros —el POS las '
  'necesita para cobrar— y se escriben con rol owner/admin/manager, igual que '
  'quantity_discounts: una promoción es un precio.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_leidas int;
  v_paso   boolean;
  v_filas  int;
  v_msg    text;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ verificacion precio',
          'zz-precio-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'vendedor');
  -- Como superusuario, saltea RLS: es la promo que el vendedor tiene que ver.
  INSERT INTO public.promotions (org_id, name) VALUES (v_org, 'ZZ promo');

  -- ── a. El vendedor SÍ la lee: el POS sigue cobrando bien ────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_leidas FROM public.promotions WHERE org_id = v_org;
  RESET ROLE;
  ASSERT v_leidas = 1,
    'el vendedor NO puede leer las promociones: el POS cobraria sin promo (vio '
    || v_leidas || ')';

  -- ── b. ...pero NO la escribe ────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.promotions (org_id, name) VALUES (v_org, 'ZZ del vendedor');
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_paso := false;
  END;
  -- Un UPDATE bloqueado por RLS no falla: filtra y afecta cero filas.
  UPDATE public.promotions SET discount_value = 90 WHERE org_id = v_org;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RESET ROLE;
  ASSERT NOT v_paso, 'un vendedor TODAVIA puede crear una promocion (fijar precio)';
  ASSERT v_filas = 0, 'un vendedor TODAVIA puede editar una promocion: ' || v_filas || ' fila(s)';

  -- ── c. Un admin sí puede: la puerta no puede cerrarle a todos ───────────
  UPDATE public.memberships SET role = 'admin'
   WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.promotions (org_id, name) VALUES (v_org, 'ZZ del admin');
    v_paso := true;
  EXCEPTION WHEN OTHERS THEN
    v_paso := false; v_msg := SQLERRM;
  END;
  RESET ROLE;
  ASSERT v_paso, 'un admin NO puede crear una promocion — ' || COALESCE(v_msg, '');

  -- ── d. Y el medio de cobro ──────────────────────────────────────────────
  UPDATE public.memberships SET role = 'vendedor'
   WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.medio_de_pago_habilitar(v_org, 'efectivo', true);
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_paso := false;
  WHEN OTHERS THEN
    -- Cualquier otro error significa que se frenó por otra cosa, y eso no
    -- prueba nada: es exactamente el falso negativo de la primera medición.
    v_paso := true; v_msg := SQLERRM;
  END;
  RESET ROLE;
  ASSERT NOT v_paso,
    'medio_de_pago_habilitar no lo freno el permiso — ' || COALESCE(v_msg, 'paso');

  -- ── e. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.organizations WHERE id = v_org;   -- el resto va en CASCADE
  SELECT count(*) INTO v_filas
    FROM public.promotions WHERE name LIKE 'ZZ %';
  ASSERT v_filas = 0, 'quedaron promociones ZZ: ' || v_filas;

  RAISE NOTICE 'OK: vendedor lee y no escribe; admin escribe; cobro con permiso; sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000040', 'la_promocion_es_un_precio')
ON CONFLICT DO NOTHING;
