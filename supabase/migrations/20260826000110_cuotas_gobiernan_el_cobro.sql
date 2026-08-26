-- ═══════════════════════════════════════════════════════════════════════════
-- Las cuotas configuradas gobiernan lo que se cobra
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `org_installment_plans` dejaba al comercio elegir en cuántas cuotas vende,
-- pero **el cobro no lo miraba**. `store-pay` toma `installments` del
-- formulario, valida sólo que esté entre 1 y 24, y lo manda a MercadoPago.
--
-- ⚠️ Con eso, un comprador que arme la request a mano puede pedir 24 cuotas y
-- el comercio se come una financiación que nunca aceptó ofrecer: en 12 cuotas
-- sin interés son 22,51% del total. Y no es un ataque sofisticado — el Brick de
-- MercadoPago ofrece los planes que MP tenga habilitados, no los que el
-- comercio quiso.
--
-- ── Por qué el chequeo no puede usar `cuotas_disponibles` ─────────────────
--
-- Esa función filtra por `is_org_member(auth.uid())`, y quien paga es un
-- comprador **sin sesión**. Corriendo con `service_role`, `auth.uid()` es NULL
-- y devolvería vacío: el cobro fallaría siempre.
--
-- Ésta es la misma lógica sin el filtro de miembro, y **sólo la puede llamar
-- `service_role`** — revocada de PUBLIC, anon y authenticated. La de la UI y la
-- del servidor comparten la regla; lo único distinto es quién puede preguntar.
--
-- ── Y qué pasa con el comercio que no configuró nada ──────────────────────
--
-- 📌 Hoy la tabla está vacía para todos. Exigir un plan configurado dejaría a
-- todo el mundo vendiendo sólo en un pago de un día para el otro — un cambio de
-- comportamiento que nadie pidió y que cuesta ventas.
--
-- Entonces: **sin planes configurados, se acepta lo que acepte el proveedor**,
-- como hasta ahora. Con al menos un plan configurado, manda la configuración.
-- Configurar deja de ser decorativo en el momento en que alguien configura.
--
-- Un pago (`installments = 1`) siempre se acepta: no es un plan de cuotas.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cuotas_permitidas(
  p_org uuid,
  p_monto numeric,
  p_cuotas int,
  p_provider text DEFAULT 'mercadopago')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_configurados int;
  v_plan public.org_installment_plans;
BEGIN
  -- Un pago no es un plan de cuotas.
  IF COALESCE(p_cuotas, 1) <= 1 THEN
    RETURN jsonb_build_object('permitido', true, 'motivo', 'un pago');
  END IF;

  SELECT count(*) INTO v_configurados
    FROM public.org_installment_plans
   WHERE org_id = p_org AND provider = p_provider AND activo;

  -- Sin configuración, se respeta lo que acepte el proveedor. Ver arriba.
  IF v_configurados = 0 THEN
    RETURN jsonb_build_object(
      'permitido', true,
      'motivo', 'el comercio no configuro planes de cuotas; se acepta lo que ofrezca el proveedor',
      'sin_configurar', true);
  END IF;

  SELECT * INTO v_plan
    FROM public.org_installment_plans
   WHERE org_id = p_org AND provider = p_provider
     AND installments = p_cuotas AND activo;

  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', false,
      'motivo', 'Este comercio no ofrece ' || p_cuotas || ' cuotas');
  END IF;

  -- ⚠️ El monto mínimo se valida CONTRA EL TOTAL DE LA ORDEN, que lo calculó la
  -- base. No contra un importe que venga del formulario: sería el mismo agujero
  -- que el precio del cliente.
  IF COALESCE(p_monto, 0) < v_plan.monto_minimo THEN
    RETURN jsonb_build_object(
      'permitido', false,
      'motivo', p_cuotas || ' cuotas requieren una compra desde $'
                || trunc(v_plan.monto_minimo)::text);
  END IF;

  RETURN jsonb_build_object(
    'permitido', true,
    'sin_interes', v_plan.sin_interes,
    'motivo', 'plan configurado por el comercio');
END;
$fn$;

-- Sólo el servidor. Un comprador no tiene por qué poder preguntar esto, y la
-- UI del comercio usa `cuotas_disponibles`, que sí filtra por membresía.
REVOKE ALL ON FUNCTION public.cuotas_permitidas(uuid, numeric, int, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.cuotas_permitidas(uuid, numeric, int, text) IS
  'Valida en el SERVIDOR si el comercio ofrece esa cantidad de cuotas para ese monto. Sin planes configurados acepta lo que acepte el proveedor, para no cambiar el comportamiento de quien no configuro nada.';
