-- ============================================================================
-- Alertas inteligentes v2 (SmartAlertsPage) + historial de eventos
-- ============================================================================
-- SmartAlertsPage estaba escrita contra un esquema que nunca se creó: leía
-- `alert_rules` esperando campos v2 (name/metric/priority/channels...) que no
-- existen, y una tabla `alert_events` inexistente → la página fallaba.
--
-- Se crean tablas SEPARADAS a propósito: `alert_rules` (v1) la sigue usando
-- la pestaña legacy con su propio esquema (type/threshold_value/threshold_days)
-- y el cron check-alerts. Mezclarlas rompería ambas.

CREATE TABLE IF NOT EXISTS public.smart_alert_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',
  metric         TEXT NOT NULL,
  condition_op   TEXT NOT NULL DEFAULT 'gt' CHECK (condition_op IN ('gt','gte','lt','lte','eq','neq')),
  threshold      NUMERIC(14,4) NOT NULL DEFAULT 0,
  priority       TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  channels       TEXT[] NOT NULL DEFAULT '{}',
  cooldown_min   INTEGER NOT NULL DEFAULT 60,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  last_triggered TIMESTAMPTZ,
  trigger_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id         UUID REFERENCES public.smart_alert_rules(id) ON DELETE SET NULL,
  rule_name       TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  priority        TEXT NOT NULL DEFAULT 'medium',
  title           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  metric_value    NUMERIC(14,4),
  threshold_value NUMERIC(14,4),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smart_rules_org ON public.smart_alert_rules(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_alert_events_org ON public.alert_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_unack ON public.alert_events(org_id) WHERE acknowledged_at IS NULL;

DROP TRIGGER IF EXISTS trg_smart_rules_updated ON public.smart_alert_rules;
CREATE TRIGGER trg_smart_rules_updated BEFORE UPDATE ON public.smart_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.smart_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read smart_rules" ON public.smart_alert_rules;
CREATE POLICY "org read smart_rules" ON public.smart_alert_rules FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write smart_rules" ON public.smart_alert_rules;
CREATE POLICY "admin write smart_rules" ON public.smart_alert_rules FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- Los eventos los puede ver y marcar como leídos cualquier miembro de la org.
DROP POLICY IF EXISTS "org read alert_events" ON public.alert_events;
CREATE POLICY "org read alert_events" ON public.alert_events FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "org ack alert_events" ON public.alert_events;
CREATE POLICY "org ack alert_events" ON public.alert_events FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write alert_events" ON public.alert_events;
CREATE POLICY "admin write alert_events" ON public.alert_events FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
