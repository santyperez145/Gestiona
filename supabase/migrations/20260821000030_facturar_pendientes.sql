-- ═══════════════════════════════════════════════════════════════════════════
-- C16 — las ventas cobradas sin factura, visibles y facturables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido hoy contra producción: **2 órdenes pagadas y 0 facturas**. La vista
-- `ordenes_sin_facturar` las mostraba desde C13 y no la miraba nadie: ninguna
-- pantalla la lee. Una vista que nadie consulta no es una salvaguarda, es un
-- comentario.
--
-- Y son dos problemas distintos:
--
--   1. **Lo viejo.** C13 factura al cobrar, pero sólo desde que existe. Las
--      ventas anteriores quedaron sin comprobante y ningún evento las va a
--      volver a disparar. Necesitan una pasada explícita.
--   2. **Lo que falle.** Si el consumidor del outbox se queda sin reintentos,
--      la orden queda cobrada y sin factura, en silencio. Alguien tiene que
--      poder verlo y arreglarlo sin abrir la base.
--
-- ── Por qué no lo hace un cron ────────────────────────────────────────────
--
-- Porque emitir un comprobante es un acto fiscal del comercio, no una tarea de
-- mantenimiento. Que el sistema empiece a facturar solo ventas viejas —de un
-- período que quizá ya se declaró— es la clase de ayuda que genera un problema
-- con el contador. Lo dispara el dueño, ve cuántas son antes, y el resultado
-- dice qué pasó con cada una.
--
-- ⚠️ **Crea el comprobante, no pide el CAE.** Igual que C13, y por el mismo
-- motivo: autorizar es una llamada a ARCA y va por la Edge Function, con su
-- propia idempotencia. Acá se arma el borrador; autorizar sigue siendo un clic.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cuántas son, para poder decirlo antes de tocar nada ────────────────
--
-- La vista ya existe pero devuelve filas; para un cartel hace falta el número
-- y el monto, que es lo que vuelve la decisión concreta: "3 ventas por
-- $47.200 sin comprobante" se entiende, "hay pendientes" no.

CREATE OR REPLACE FUNCTION public.resumen_sin_facturar(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'cantidad', COUNT(*),
    'monto',    COALESCE(SUM(o.total), 0),
    'mas_vieja', MIN(o.created_at)
  )
  FROM public.ecommerce_orders o
  WHERE o.org_id = p_org
    AND o.payment_status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id = o.id)
    -- La autorización va adentro: una función SECURITY DEFINER que no la
    -- pregunta le contaría a cualquiera cuánto factura otro comercio.
    AND public.is_org_member(p_org, auth.uid());
$fn$;

REVOKE ALL ON FUNCTION public.resumen_sin_facturar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_sin_facturar(uuid) TO authenticated;

-- ── 2. La pasada ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.facturar_pendientes(p_org uuid, p_limite int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_o        record;
  v_id       uuid;
  v_creadas  int := 0;
  v_vacias   int := 0;
  v_fallas   jsonb := '[]'::jsonb;
  v_lim      int := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 500);
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'Falta la organizacion';
  END IF;
  IF NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador pueden emitir comprobantes';
  END IF;

  -- Las más viejas primero: son las que llevan más tiempo cobradas sin
  -- respaldo, y las que más urge regularizar.
  FOR v_o IN
    SELECT o.id, o.order_number
      FROM public.ecommerce_orders o
     WHERE o.org_id = p_org
       AND o.payment_status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id = o.id)
     ORDER BY o.created_at
     LIMIT v_lim
  LOOP
    -- ⚠️ Cada orden en su propio bloque: una que falle **no puede** abortar la
    -- pasada entera. Si 9 se pueden facturar y la décima tiene un dato roto,
    -- lo correcto es emitir las 9 y decir cuál falló — no dejar las diez sin
    -- comprobante por culpa de una.
    BEGIN
      v_id := public.facturar_orden_pagada(
        jsonb_build_object('org_id', p_org,
                           'data', jsonb_build_object('order_id', v_o.id)));
      IF v_id IS NULL THEN
        -- Total en cero: no es un error, es una orden que no se factura.
        v_vacias := v_vacias + 1;
      ELSE
        v_creadas := v_creadas + 1;
      END IF;
    EXCEPTION WHEN others THEN
      -- ⚠️ Y no se traga: el motivo vuelve con el número de orden. Un contador
      -- de fallas sin el motivo obliga a mirar los logs del servidor, que el
      -- dueño no tiene.
      v_fallas := v_fallas || jsonb_build_object(
        'orden', v_o.order_number, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'creadas', v_creadas,
    'sin_importe', v_vacias,
    'fallas', v_fallas,
    -- Lo que queda después de esta pasada, por si se topó con el límite.
    'restantes', (SELECT count(*) FROM public.ecommerce_orders o
                   WHERE o.org_id = p_org AND o.payment_status = 'paid'
                     AND NOT EXISTS (SELECT 1 FROM public.invoices i
                                      WHERE i.ecommerce_order_id = o.id)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.facturar_pendientes(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_pendientes(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.facturar_pendientes(uuid, int) IS
  'Crea los comprobantes de las ventas cobradas que quedaron sin factura. No pide el CAE: autorizar va por la Edge Function. Una orden que falla no aborta la pasada.';
