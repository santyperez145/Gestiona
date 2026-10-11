-- ═══════════════════════════════════════════════════════════════════════════
-- P0.2: doce tablas dejan de aceptar escrituras de cualquier miembro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11 con pg_policies: doce tablas tenían una política FOR ALL
-- cuya única condición era «el usuario es miembro del comercio» (subconsulta
-- directa a memberships). Así, un miembro de sólo lectura podía borrar
-- clientes, crear links de pago, editar campañas de email y automatizaciones,
-- reglas de alerta, presupuestos y cuotas. Las vueltas anteriores de P0.2
-- (20261010000200…20261011000100) no las vieron porque buscaban
-- `is_org_member`, no la subconsulta.
--
-- Cada tabla pasa a: leer igual que antes (cualquier miembro); crear, editar
-- y borrar con el permiso del módulo (`has_permission`), que el dueño tiene
-- siempre y los roles según Equipo › Permisos:
--
--   clientes   customers, customer_notes, customer_communications, loyalty_points
--   marketing  email_campaigns, marketing_templates, automation_flows
--   payments   payment_links
--   sales      installment_schedule, quotes, quote_sequences
--   settings   alert_rules
--
-- Con los permisos por defecto: el vendedor sigue creando y editando
-- clientes, presupuestos y cuotas (ya no borra clientes: su rol no tiene
-- «borrar»); el de sólo lectura ya no escribe nada de esto.
--
-- Fuera de esta vuelta, a propósito: tasks, deals y deal_outcomes (el
-- vendedor cierra sus tareas y mueve tratos pero su rol no tiene «editar» en
-- CRM: hace falta una regla propia), integration_logs y team_messages.
--
-- Idempotente. Reversible: volver a crear la política FOR ALL original.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('customers', 'customers', 'org_members_manage_customers'),
      ('customer_notes', 'customers', 'org_members_manage_customer_notes'),
      ('customer_communications', 'customers', 'comm_org_access'),
      ('loyalty_points', 'customers', 'loyalty_org_access'),
      ('email_campaigns', 'marketing', 'org_members_manage_email_campaigns'),
      ('marketing_templates', 'marketing', 'marketing_templates_manage_own'),
      ('automation_flows', 'marketing', 'automation_flows_org_access'),
      ('payment_links', 'payments', 'payment_links_org_access'),
      ('installment_schedule', 'sales', 'installment_schedule_org_access'),
      ('quotes', 'sales', 'quotes_org'),
      ('quote_sequences', 'sales', 'quote_sequences_org'),
      ('alert_rules', 'settings', 'org members can manage alert rules')
    ) AS v(tabla, modulo, vieja)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.vieja, t.tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tabla || '_leer', t.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))',
      t.tabla || '_leer', t.tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tabla || '_crear', t.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, %L, ''create''))',
      t.tabla || '_crear', t.tabla, t.modulo);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tabla || '_editar', t.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(org_id, %L, ''edit'')) WITH CHECK (public.has_permission(org_id, %L, ''edit''))',
      t.tabla || '_editar', t.tabla, t.modulo, t.modulo);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tabla || '_borrar', t.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_permission(org_id, %L, ''delete''))',
      t.tabla || '_borrar', t.tabla, t.modulo);
  END LOOP;
END $$;

COMMIT;
