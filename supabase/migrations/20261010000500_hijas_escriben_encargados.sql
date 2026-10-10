-- ═══════════════════════════════════════════════════════════════════════════
-- Las tablas hijas siguen a su padre: escriben dueño y admin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cierre de 20261010000400. Estas seis no tienen `org_id`: su política
-- resolvía la organización a través de la tabla padre, y como las demás era
-- una sola `FOR ALL` de «cualquier miembro». Cumplen el mismo criterio medido
-- el 2026-10-10 (ninguna función INVOKER ni edge function las escribe; desde
-- la app sólo rutas sólo-admin), y sus padres ya quedaron restringidos.
--
--   plm_quality_checks, plm_stage_history, plm_versions → plm_products
--   portal_ticket_messages                             → portal_tickets
--   purchase_request_items                             → purchase_requests
--   recipe_ingredients                                 → recipes
--
-- Leer: miembros de la organización del padre. Crear, editar y borrar: dueño
-- y admin de esa organización. Idempotente. Reversible: recrear la política
-- original de cada tabla.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_fila record;
  v_miembro text;
  v_encargado text;
BEGIN
  FOR v_fila IN
    SELECT * FROM (VALUES
      ('plm_quality_checks',     'org_plm_quality',        'plm_product_id', 'plm_products'),
      ('plm_stage_history',      'org_plm_history',        'plm_product_id', 'plm_products'),
      ('plm_versions',           'org_plm_versions',       'plm_product_id', 'plm_products'),
      ('portal_ticket_messages', 'org_portal_msgs',        'ticket_id',      'portal_tickets'),
      ('purchase_request_items', 'org_purchase_req_items', 'request_id',     'purchase_requests'),
      ('recipe_ingredients',     'org_recipe_ingr',        'recipe_id',      'recipes')
    ) AS t(tabla, previa, fk, padre)
  LOOP
    v_miembro := format(
      'EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I AND public.is_org_member(p.org_id, auth.uid()))',
      v_fila.padre, v_fila.fk);
    v_encargado := format(
      $f$EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I AND public.has_org_role(p.org_id, auth.uid(), ARRAY['owner', 'admin']))$f$,
      v_fila.padre, v_fila.fk);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_fila.previa, v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_crear ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_editar ON public.%1$I', v_fila.tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_borrar ON public.%1$I', v_fila.tabla);

    EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$I FOR SELECT TO authenticated USING (%2$s)', v_fila.tabla, v_miembro);
    EXECUTE format('CREATE POLICY %1$s_crear ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)', v_fila.tabla, v_encargado);
    EXECUTE format('CREATE POLICY %1$s_editar ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', v_fila.tabla, v_encargado);
    EXECUTE format('CREATE POLICY %1$s_borrar ON public.%1$I FOR DELETE TO authenticated USING (%2$s)', v_fila.tabla, v_encargado);
  END LOOP;
END $$;
