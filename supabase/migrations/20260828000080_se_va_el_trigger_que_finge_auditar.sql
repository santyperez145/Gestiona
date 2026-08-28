-- Se va el trigger que fingía auditar cada venta
--
-- ── Qué se encontró ───────────────────────────────────────────────────────
--
-- `audit_sales_trigger` cuelga de `sales` en INSERT, UPDATE y DELETE, y llama
-- a `public.log_audit_event(...)`.
--
-- ⚠️ **Esa función no existe.** No está en `public`, no está en ningún esquema,
-- y ninguna migración del repo la crea. Se fue con la limpieza de módulos del
-- 2026-08-02 —la que dropeó 57 tablas huérfanas— y el trigger quedó vivo.
--
-- 📌 Y no se notó porque termina con `exception when others then return`. El
-- comentario dice «Never let an audit failure block the underlying sale
-- operation», que es la intención correcta: una venta no puede caerse por la
-- auditoría. Pero tragarse *una función que no existe* no es lo mismo que
-- tragarse un fallo transitorio: el primero no se arregla nunca y nadie se
-- entera.
--
-- ⚠️ Mientras tanto **hacía trabajo en cada venta**: consultaba `auth.users`
-- para el email y armaba `to_jsonb(NEW)` de la fila entera antes de fallar.
--
-- ── Por qué se borra en vez de arreglarse ─────────────────────────────────
--
-- La auditoría de ventas **funciona**, por otro camino: `src/lib/auditLog.ts`
-- escribe en `audit_logs` desde el cliente. Medido el 2026-08-28: **391 filas,
-- 67 de ventas**, la última del 2026-08-26.
--
-- 📌 Hacer que el trigger escriba en `audit_logs` sería mejor ingeniería —el
-- servidor no se puede saltear— pero **duplicaría cada evento** que hoy ya
-- registra el cliente, y deduplicarlos es un diseño, no un arreglo. Va como
-- slice propio si se decide mover la auditoría al servidor.
--
-- ⚠️ Lo que queda anotado, para que nadie lo confunda con que está resuelto:
-- una escritura sobre `sales` que **no pase por la UI** —una Edge Function, la
-- sincronización del POS offline, un RPC— no queda auditada. Es la limitación
-- real del camino que sí funciona.
--
-- Encontrado corriendo
-- `supabase/verificaciones/20260828_las_funciones_resuelven_sus_nombres.sql`,
-- que analiza cada función de trigger contra la tabla donde está colgada.

DROP TRIGGER IF EXISTS audit_sales_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.trg_audit_sales();

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid;
  v_user  uuid;
  v_prod  uuid;
  v_sale  uuid;
  v_n     int;
  v_antes int;
  v_restos int;
BEGIN
  -- ── a. El trigger se fue ────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgname = 'audit_sales_trigger' AND NOT tgisinternal;
  ASSERT v_n = 0, 'el trigger sigue colgado de sales';

  -- ── b. ⚠️ Y vender sigue funcionando ────────────────────────────────────
  -- Sacar un trigger de una tabla que mueve plata se comprueba vendiendo, no
  -- mirando el catálogo.
  SELECT org_id, user_id INTO v_org, v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_prod FROM public.products WHERE org_id = v_org LIMIT 1;

  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
                            total_ars, date, payment_method, source, paid)
  VALUES (v_org, v_user, v_prod, 'ZZ venta sin trigger', 1, 100, current_date,
          'efectivo', 'pos', true)
  RETURNING id INTO v_sale;

  SELECT count(*) INTO v_n FROM public.sales
   WHERE org_id = v_org AND product_name = 'ZZ venta sin trigger';
  ASSERT v_n = 1, 'la venta no se registró después de sacar el trigger';

  -- ── c. La auditoría que SÍ funciona sigue en pie ────────────────────────
  -- El camino del cliente escribe en `audit_logs`; sacar el trigger muerto no
  -- podía tocarlo, y se comprueba en vez de suponerlo.
  SELECT count(*) INTO v_antes FROM public.audit_logs WHERE entity_type = 'sale';
  ASSERT v_antes > 0,
    'no quedan registros de auditoría de ventas: se tocó el camino que funcionaba';

  -- ── d. Sin restos ───────────────────────────────────────────────────────
  --
  -- ⚠️ La venta ZZ movió stock, y **borrar la venta no borra su Kardex**:
  -- `trg_sale_stock_movement` cubre DELETE agregando un movimiento de reversa,
  -- así que quedan dos filas apuntando a una venta que ya no existe. Se
  -- limpian por `reference_id`, no por el nombre del producto — el Kardex no
  -- guarda el nombre.
  --
  -- 📌 La primera versión de esta verificación contaba los huérfanos **totales**
  -- y abortó con 8. Seis de esos son previos, del 2026-07-31 —la época del
  -- descuento doble— y no son de este cambio. Se mide el **delta**: lo que la
  -- prueba dejó, no lo que ya estaba. Contar el total habría hecho fallar la
  -- migración por un problema ajeno, y esconder el propio detrás de él.
  SELECT count(*) INTO v_antes FROM public.stock_movements
   WHERE reference_type = 'sale'
     AND reference_id NOT IN (SELECT id FROM public.sales);

  -- ⚠️ El orden importa: borrar la venta DISPARA el trigger, que agrega un
  -- movimiento de reversa. Limpiar primero y borrar después deja ese nuevo
  -- huérfano — la version anterior de esta verificacion fallaba justo por eso,
  -- con «1 movimiento NUEVO quedó huérfano». Se borra la venta y recién
  -- entonces sus movimientos, por el id que se guardó antes.
  DELETE FROM public.sales WHERE id = v_sale;

  DELETE FROM public.stock_movements
   WHERE reference_type = 'sale' AND reference_id = v_sale;

  SELECT count(*) INTO v_restos FROM public.sales WHERE id = v_sale;
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  SELECT count(*) INTO v_n FROM public.stock_movements
   WHERE reference_type = 'sale'
     AND reference_id NOT IN (SELECT id FROM public.sales);
  ASSERT v_n <= v_antes,
    (v_n - v_antes) || ' movimiento(s) de stock NUEVOS quedaron huérfanos '
    || '(había ' || v_antes || ' de antes, del 2026-07-31)';

  RAISE NOTICE 'OK: se fue el trigger muerto, vender funciona y la auditoría real sigue';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000080', 'se_va_el_trigger_que_finge_auditar')
ON CONFLICT DO NOTHING;
