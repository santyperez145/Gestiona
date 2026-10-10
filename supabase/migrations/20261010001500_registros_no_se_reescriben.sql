-- ═══════════════════════════════════════════════════════════════════════════
-- Los registros del día a día se agregan; no se reescriben
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tercera vuelta del barrido de RLS (20261010000300, 000400, 000500), ahora
-- sobre tablas que un vendedor usa todos los días. Cinco son registros —la app
-- las inserta pero nunca las edita ni las borra (medido 2026-10-10 en src/,
-- edge functions y funciones de la base)— y tenían una única FOR ALL de
-- «cualquier miembro»:
--
--   promotion_usages   cada uso de un cupón o promoción. Borrar filas le
--                      devolvía al cupón los usos ya gastados: un vendedor
--                      podía resetear el límite de una promoción.
--   delivery_events    el historial de un envío.
--   deal_activities    lo que pasó con una oportunidad del CRM.
--   drip_enrollments   quién está en una secuencia de emails.
--   segment_campaigns  qué campaña se mandó a qué segmento.
--
-- Cualquier miembro sigue leyendo y registrando (el POS registra el uso del
-- cupón, el CRM la actividad). Editar y borrar: el uso de una promoción y el
-- historial de un envío, nadie; lo demás, dueño y admin. `send-drip-emails`
-- usa la clave de servicio y no se ve afectada.
--
-- `audit_logs` y `deal_outcomes` ya eran sólo insertar y leer.
--
-- Idempotente. Reversible: recrear la política FOR ALL de cada tabla.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_fila record;
  v_leer text;
  v_encargado text;
BEGIN
  FOR v_fila IN
    SELECT * FROM (VALUES
      -- tabla, política original, expresión de pertenencia, ¿se puede corregir?
      ('promotion_usages',  'org_promo_usages',     'public.is_org_member(org_id, auth.uid())', false),
      ('delivery_events',   'org_delivery_events',
        'EXISTS (SELECT 1 FROM public.deliveries d WHERE d.id = delivery_id AND public.is_org_member(d.org_id, auth.uid()))', false),
      ('deal_activities',   'org members manage deal activities', 'public.is_org_member(org_id, auth.uid())', true),
      ('drip_enrollments',  'org_drip_enrollments', 'public.is_org_member(org_id, auth.uid())', true),
      ('segment_campaigns', 'org_seg_campaigns',    'public.is_org_member(org_id, auth.uid())', true)
    ) AS t(tabla, previa, miembro, corregible)
  LOOP
    v_leer := v_fila.miembro;
    v_encargado := CASE v_fila.tabla
      WHEN 'delivery_events' THEN
        $e$EXISTS (SELECT 1 FROM public.deliveries d WHERE d.id = delivery_id AND public.has_org_role(d.org_id, auth.uid(), ARRAY['owner', 'admin']))$e$
      ELSE $e$public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])$e$
    END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_fila.previa, v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_registrar ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_editar ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_borrar ON public.%1$I', v_fila.tabla);

    EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$I FOR SELECT TO authenticated USING (%2$s)', v_fila.tabla, v_leer);
    EXECUTE format('CREATE POLICY %1$s_registrar ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)', v_fila.tabla, v_leer);
    -- El uso de una promoción y el historial de un envío no se corrigen:
    -- sin políticas de UPDATE y DELETE, nadie desde la app los reescribe.
    IF v_fila.corregible THEN
      EXECUTE format('CREATE POLICY %1$s_editar ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', v_fila.tabla, v_encargado);
      EXECUTE format('CREATE POLICY %1$s_borrar ON public.%1$I FOR DELETE TO authenticated USING (%2$s)', v_fila.tabla, v_encargado);
    END IF;
  END LOOP;
END $$;
