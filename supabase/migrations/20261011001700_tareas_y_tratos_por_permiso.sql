-- ═══════════════════════════════════════════════════════════════════════════
-- P0.2: tareas, tratos y resultados de tratos con permiso de CRM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sigue a 20261011001600. `tasks` y `deals` tenían un FOR ALL con sólo
-- «es miembro» (subconsulta a memberships) y `deal_outcomes` un INSERT igual:
-- un miembro de sólo lectura creaba, cerraba y borraba tareas y tratos.
-- Quedaron afuera de la vuelta anterior porque con los permisos por defecto
-- el vendedor tiene «crear» pero no «editar» en CRM, y cierra sus propias
-- tareas y mueve sus propios tratos todos los días.
--
-- Regla:
--   · leer: cualquier miembro (igual que antes);
--   · crear: permiso «crear» de CRM;
--   · editar: permiso «editar» de CRM, o es suya (tarea asignada a la persona
--     o creada por ella; trato cargado por ella);
--   · borrar: permiso «borrar» de CRM.
--   · deal_outcomes (registro de cómo terminó un trato): crear con «crear» de
--     CRM; leer igual que antes.
--
-- Idempotente. Reversible: volver a crear las políticas originales.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS tasks_org_access ON public.tasks;
DROP POLICY IF EXISTS tasks_leer ON public.tasks;
DROP POLICY IF EXISTS tasks_crear ON public.tasks;
DROP POLICY IF EXISTS tasks_editar ON public.tasks;
DROP POLICY IF EXISTS tasks_borrar ON public.tasks;
CREATE POLICY tasks_leer ON public.tasks FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY tasks_crear ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'crm', 'create'));
CREATE POLICY tasks_editar ON public.tasks FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'crm', 'edit')
    OR (public.is_org_member(org_id, auth.uid()) AND (assigned_to = auth.uid() OR created_by = auth.uid())))
  WITH CHECK (public.has_permission(org_id, 'crm', 'edit')
    OR (public.is_org_member(org_id, auth.uid()) AND (assigned_to = auth.uid() OR created_by = auth.uid())));
CREATE POLICY tasks_borrar ON public.tasks FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'crm', 'delete'));

DROP POLICY IF EXISTS deals_org_access ON public.deals;
DROP POLICY IF EXISTS deals_leer ON public.deals;
DROP POLICY IF EXISTS deals_crear ON public.deals;
DROP POLICY IF EXISTS deals_editar ON public.deals;
DROP POLICY IF EXISTS deals_borrar ON public.deals;
CREATE POLICY deals_leer ON public.deals FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY deals_crear ON public.deals FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'crm', 'create'));
CREATE POLICY deals_editar ON public.deals FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'crm', 'edit')
    OR (public.is_org_member(org_id, auth.uid()) AND user_id = auth.uid()))
  WITH CHECK (public.has_permission(org_id, 'crm', 'edit')
    OR (public.is_org_member(org_id, auth.uid()) AND user_id = auth.uid()));
CREATE POLICY deals_borrar ON public.deals FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'crm', 'delete'));

DROP POLICY IF EXISTS "org members can insert deal outcomes" ON public.deal_outcomes;
DROP POLICY IF EXISTS deal_outcomes_crear ON public.deal_outcomes;
CREATE POLICY deal_outcomes_crear ON public.deal_outcomes FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'crm', 'create'));

COMMIT;
