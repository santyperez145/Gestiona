-- ═══════════════════════════════════════════════════════════════════════════
-- Campañas, automatizaciones, alertas de presupuesto e historial de stock:
-- escribe quien tiene el permiso, no cualquier miembro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ROADMAP P0.2, cuarta vuelta del barrido de `pg_policies` (ver
-- 20261010000400). Medido 2026-10-11: quedaban 10 tablas con alguna
-- escritura para cualquier miembro. Cinco son uso legítimo de un vendedor
-- (actividad de un trato, registro de acceso a documentos, eventos de
-- entrega, uso de una promoción en la caja, marcar una alerta leída). Las
-- otras cinco no:
--   · whatsapp_campaigns (FOR ALL): un vendedor creaba, editaba y borraba
--     campañas de WhatsApp a los clientes.
--   · segment_campaigns (INSERT): creaba campañas a un segmento.
--   · drip_enrollments (INSERT): inscribía contactos en automatizaciones.
--   · finance_budget_alerts (FOR ALL): editaba y borraba alertas de
--     presupuesto de Finanzas.
--   · stock_history (INSERT): podía fabricar historial de stock. Nada lo
--     escribe hoy (última fila: 2026-05-07; ninguna función ni pantalla).
--
-- Criterio: el permiso del módulo (`has_permission`), no sólo dueño/admin,
-- para que un vendedor con permiso de marketing siga trabajando. El CRM —que
-- usa el vendedor— inscribe contactos en automatizaciones, así que ahí vale
-- crear en marketing o en CRM. Las funciones del servidor que escriben estas tablas
-- (send-whatsapp, send-drip-emails, finance-budget-pulse) usan la clave de
-- servicio y no pasan por estas políticas. Leer sigue igual.
--
-- Idempotente. Reversible: recrear las políticas anteriores.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- WhatsApp: leer miembros; crear/editar/borrar con permiso de marketing.
DROP POLICY IF EXISTS "org members can manage whatsapp_campaigns" ON public.whatsapp_campaigns;
DROP POLICY IF EXISTS whatsapp_campaigns_leer ON public.whatsapp_campaigns;
DROP POLICY IF EXISTS whatsapp_campaigns_crear ON public.whatsapp_campaigns;
DROP POLICY IF EXISTS whatsapp_campaigns_editar ON public.whatsapp_campaigns;
DROP POLICY IF EXISTS whatsapp_campaigns_borrar ON public.whatsapp_campaigns;
CREATE POLICY whatsapp_campaigns_leer ON public.whatsapp_campaigns FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY whatsapp_campaigns_crear ON public.whatsapp_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));
CREATE POLICY whatsapp_campaigns_editar ON public.whatsapp_campaigns FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'marketing', 'edit'))
  WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));
CREATE POLICY whatsapp_campaigns_borrar ON public.whatsapp_campaigns FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'marketing', 'delete'));

-- Campañas a segmentos: crear con permiso de marketing.
DROP POLICY IF EXISTS segment_campaigns_registrar ON public.segment_campaigns;
CREATE POLICY segment_campaigns_registrar ON public.segment_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));

-- Automatizaciones: inscribir con permiso de crear en marketing o en CRM
-- (el vendedor tiene CRM ver y crear por defecto; editar, no).
DROP POLICY IF EXISTS drip_enrollments_registrar ON public.drip_enrollments;
CREATE POLICY drip_enrollments_registrar ON public.drip_enrollments FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'marketing', 'create') OR public.has_permission(org_id, 'crm', 'create'));

-- Alertas de presupuesto: leer miembros; escribir con permiso de finanzas.
DROP POLICY IF EXISTS finance_budget_alerts_org ON public.finance_budget_alerts;
DROP POLICY IF EXISTS finance_budget_alerts_leer ON public.finance_budget_alerts;
DROP POLICY IF EXISTS finance_budget_alerts_escribir ON public.finance_budget_alerts;
CREATE POLICY finance_budget_alerts_leer ON public.finance_budget_alerts FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY finance_budget_alerts_escribir ON public.finance_budget_alerts FOR ALL TO authenticated
  USING (public.has_permission(org_id, 'finance', 'edit'))
  WITH CHECK (public.has_permission(org_id, 'finance', 'edit'));

-- Historial de stock: nadie lo escribe hoy; sólo dueño o admin.
DROP POLICY IF EXISTS stock_history_crear ON public.stock_history;
CREATE POLICY stock_history_crear ON public.stock_history FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']));

COMMIT;
