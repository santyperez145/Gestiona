-- Customer Journey & Touchpoints: full interaction timeline, funnel stages, automations

CREATE TABLE IF NOT EXISTS journey_stages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  stage_type      text        NOT NULL CHECK (stage_type IN ('awareness','consideration','decision','retention','advocacy','churn_risk')),
  color           text        NOT NULL DEFAULT '#6366f1',
  sort_order      int         NOT NULL DEFAULT 0,
  entry_criteria  jsonb       NOT NULL DEFAULT '{}',  -- rules that auto-assign customers
  exit_criteria   jsonb       NOT NULL DEFAULT '{}',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_touchpoints (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  touchpoint_type text        NOT NULL CHECK (touchpoint_type IN (
    'sale','support_ticket','email_open','email_click','whatsapp','call','chat',
    'review','refund','loyalty_redeem','nps_response','page_view','cart_abandon',
    'subscription_start','subscription_cancel','referral'
  )),
  channel         text        NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct','email','whatsapp','web','social','phone','pos')),
  subject         text,
  description     text,
  sentiment       text        CHECK (sentiment IN ('positive','neutral','negative')),
  sentiment_score numeric(4,3) CHECK (sentiment_score BETWEEN -1 AND 1),
  metadata        jsonb       NOT NULL DEFAULT '{}',   -- {sale_id, amount, ticket_id, etc.}
  stage_id        uuid        REFERENCES journey_stages(id) ON DELETE SET NULL,
  assigned_to     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_journey_assignments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stage_id        uuid        NOT NULL REFERENCES journey_stages(id) ON DELETE CASCADE,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  is_current      boolean     NOT NULL DEFAULT true,
  notes           text,
  UNIQUE (org_id, customer_id, stage_id, assigned_at)
);

CREATE TABLE IF NOT EXISTS journey_automations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  trigger_type    text        NOT NULL CHECK (trigger_type IN ('touchpoint_created','stage_entered','days_inactive','order_placed','support_opened','churn_risk')),
  trigger_config  jsonb       NOT NULL DEFAULT '{}',
  action_type     text        NOT NULL CHECK (action_type IN ('send_email','send_whatsapp','assign_stage','create_task','notify_team','add_tag')),
  action_config   jsonb       NOT NULL DEFAULT '{}',
  delay_hours     int         NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  run_count       int         NOT NULL DEFAULT 0,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Get full journey for a customer
CREATE OR REPLACE FUNCTION get_customer_journey(p_customer_id uuid, p_org_id uuid)
RETURNS TABLE(
  touchpoint_id   uuid,
  touchpoint_type text,
  channel         text,
  subject         text,
  sentiment       text,
  stage_name      text,
  occurred_at     timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT
    ct.id,
    ct.touchpoint_type,
    ct.channel,
    ct.subject,
    ct.sentiment,
    js.name AS stage_name,
    ct.occurred_at
  FROM customer_touchpoints ct
  LEFT JOIN journey_stages js ON js.id = ct.stage_id
  WHERE ct.customer_id = p_customer_id
    AND ct.org_id = p_org_id
  ORDER BY ct.occurred_at DESC;
$$;

-- Aggregate sentiment by customer over N days
CREATE OR REPLACE FUNCTION get_customer_sentiment(p_org_id uuid, p_days int DEFAULT 90)
RETURNS TABLE(
  customer_id     uuid,
  total_touchpoints bigint,
  positive_count  bigint,
  negative_count  bigint,
  avg_sentiment   numeric,
  last_touchpoint timestamptz,
  health_score    numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    customer_id,
    COUNT(*) AS total_touchpoints,
    COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive_count,
    COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative_count,
    ROUND(AVG(sentiment_score), 3) AS avg_sentiment,
    MAX(occurred_at) AS last_touchpoint,
    ROUND(
      (COUNT(*) FILTER (WHERE sentiment = 'positive') * 100.0 / NULLIF(COUNT(*), 0))
      - (COUNT(*) FILTER (WHERE sentiment = 'negative') * 50.0 / NULLIF(COUNT(*), 0))
    , 1) AS health_score
  FROM customer_touchpoints
  WHERE org_id = p_org_id
    AND occurred_at >= now() - (p_days || ' days')::interval
  GROUP BY customer_id;
$$;

-- Seed default journey stages for an org
CREATE OR REPLACE FUNCTION seed_journey_stages(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO journey_stages (org_id, name, stage_type, color, sort_order, description) VALUES
    (p_org_id, 'Descubrimiento',   'awareness',     '#6366f1', 1, 'Primer contacto con la marca'),
    (p_org_id, 'Evaluación',       'consideration', '#8b5cf6', 2, 'Comparando opciones'),
    (p_org_id, 'Compra',           'decision',      '#10b981', 3, 'Realizó su primera compra'),
    (p_org_id, 'Cliente Activo',   'retention',     '#f59e0b', 4, 'Compra con frecuencia regular'),
    (p_org_id, 'Embajador',        'advocacy',      '#ec4899', 5, 'Recomienda activamente'),
    (p_org_id, 'Riesgo de Baja',   'churn_risk',    '#ef4444', 6, 'Sin actividad reciente')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_touchpoints_customer  ON customer_touchpoints(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_org_type  ON customer_touchpoints(org_id, touchpoint_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_assign_org    ON customer_journey_assignments(org_id, customer_id, is_current);
CREATE INDEX IF NOT EXISTS idx_journey_stages_org    ON journey_stages(org_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_automations_org       ON journey_automations(org_id, is_active, trigger_type);

-- RLS
ALTER TABLE journey_stages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_touchpoints         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_journey_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_automations          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_journey_stages"    ON journey_stages;
DROP POLICY IF EXISTS "org_touchpoints"       ON customer_touchpoints;
DROP POLICY IF EXISTS "org_journey_assign"    ON customer_journey_assignments;
DROP POLICY IF EXISTS "org_journey_auto"      ON journey_automations;

CREATE POLICY "org_journey_stages"   ON journey_stages               USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_touchpoints"      ON customer_touchpoints         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_journey_assign"   ON customer_journey_assignments USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_journey_auto"     ON journey_automations          USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
