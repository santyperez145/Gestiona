-- Advanced CRM: contacts, deals, activities, pipeline stages, revenue forecasting

CREATE TABLE IF NOT EXISTS crm_pipelines (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  currency        text        NOT NULL DEFAULT 'ARS',
  is_default      boolean     NOT NULL DEFAULT false,
  win_probability_model text  NOT NULL DEFAULT 'stage_based' CHECK (win_probability_model IN ('stage_based','ai','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS crm_stages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id     uuid        NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  stage_type      text        NOT NULL DEFAULT 'open' CHECK (stage_type IN ('open','won','lost','qualified')),
  sort_order      int         NOT NULL DEFAULT 0,
  win_probability int         NOT NULL DEFAULT 50 CHECK (win_probability BETWEEN 0 AND 100),
  color           text        NOT NULL DEFAULT '#6366f1',
  rotting_days    int         NOT NULL DEFAULT 14,  -- days before deal is flagged as stale
  required_fields text[]      NOT NULL DEFAULT '{}',
  UNIQUE (pipeline_id, sort_order)
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id     uuid        NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  stage_id        uuid        NOT NULL REFERENCES crm_stages(id),
  title           text        NOT NULL,
  value           numeric(18,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  probability     int         NOT NULL DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  expected_close  date,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  owner_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  source          text        CHECK (source IN ('inbound','outbound','referral','web','social','event','cold_call','other')),
  tags            text[]      NOT NULL DEFAULT '{}',
  custom_fields   jsonb       NOT NULL DEFAULT '{}',
  lost_reason     text,
  won_at          timestamptz,
  lost_at         timestamptz,
  last_activity   timestamptz,
  next_follow_up  date,
  weighted_value  numeric(18,2) GENERATED ALWAYS AS (ROUND(value * probability / 100.0, 2)) STORED,
  is_rotting      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id         uuid        REFERENCES crm_deals(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE CASCADE,
  activity_type   text        NOT NULL CHECK (activity_type IN ('call','email','meeting','note','task','demo','proposal','contract')),
  subject         text        NOT NULL,
  description     text,
  outcome         text        CHECK (outcome IN ('positive','neutral','negative','no_show')),
  duration_min    int,
  scheduled_at    timestamptz,
  completed_at    timestamptz,
  is_completed    boolean     NOT NULL DEFAULT false,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE CASCADE,
  first_name      text        NOT NULL,
  last_name       text,
  email           text,
  phone           text,
  role            text,        -- job title
  company         text,
  linkedin_url    text,
  lead_score      int         NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
  lifecycle_stage text        NOT NULL DEFAULT 'lead' CHECK (lifecycle_stage IN ('lead','prospect','customer','churned')),
  tags            text[]      NOT NULL DEFAULT '{}',
  custom_fields   jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Pipeline revenue forecast by stage
CREATE OR REPLACE VIEW crm_pipeline_forecast AS
SELECT
  d.org_id,
  d.pipeline_id,
  d.stage_id,
  s.name AS stage_name,
  s.win_probability,
  COUNT(d.id) AS deal_count,
  SUM(d.value) AS total_value,
  SUM(d.weighted_value) AS weighted_value,
  AVG(d.probability) AS avg_probability,
  COUNT(d.id) FILTER (WHERE d.is_rotting) AS rotting_count
FROM crm_deals d
JOIN crm_stages s ON s.id = d.stage_id
WHERE d.stage_id NOT IN (
  SELECT id FROM crm_stages WHERE stage_type IN ('won','lost')
)
GROUP BY d.org_id, d.pipeline_id, d.stage_id, s.name, s.win_probability;

-- Mark rotting deals
CREATE OR REPLACE FUNCTION check_rotting_deals(p_org_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  WITH updated AS (
    UPDATE crm_deals d
    SET is_rotting = true
    FROM crm_stages s
    WHERE d.stage_id = s.id
      AND d.org_id = p_org_id
      AND d.is_rotting = false
      AND s.stage_type = 'open'
      AND (d.last_activity IS NULL OR d.last_activity < now() - (s.rotting_days || ' days')::interval)
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

-- Seed default pipeline stages
CREATE OR REPLACE FUNCTION seed_crm_pipeline(p_org_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_pipeline_id uuid;
BEGIN
  INSERT INTO crm_pipelines (org_id, name, is_default)
  VALUES (p_org_id, 'Pipeline Principal', true)
  ON CONFLICT (org_id, name) DO UPDATE SET is_default = true
  RETURNING id INTO v_pipeline_id;

  INSERT INTO crm_stages (org_id, pipeline_id, name, stage_type, sort_order, win_probability, color) VALUES
    (p_org_id, v_pipeline_id, 'Prospecto',       'open',      1,  10,  '#6366f1'),
    (p_org_id, v_pipeline_id, 'Calificado',       'qualified', 2,  25,  '#8b5cf6'),
    (p_org_id, v_pipeline_id, 'Propuesta',        'open',      3,  50,  '#f59e0b'),
    (p_org_id, v_pipeline_id, 'Negociación',      'open',      4,  75,  '#10b981'),
    (p_org_id, v_pipeline_id, 'Cierre Ganado',    'won',       5,  100, '#22c55e'),
    (p_org_id, v_pipeline_id, 'Cierre Perdido',   'lost',      6,  0,   '#ef4444')
  ON CONFLICT (pipeline_id, sort_order) DO NOTHING;

  RETURN v_pipeline_id;
END;
$$;

-- Triggers
CREATE OR REPLACE FUNCTION update_crm_deal_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE OR REPLACE TRIGGER trg_deal_ts BEFORE UPDATE ON crm_deals FOR EACH ROW EXECUTE FUNCTION update_crm_deal_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_deals_org_stage  ON crm_deals(org_id, pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_deal  ON crm_activities(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org     ON crm_contacts(org_id, lifecycle_stage, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline  ON crm_stages(pipeline_id, sort_order);

-- RLS
ALTER TABLE crm_pipelines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_stages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_crm_pipelines"  ON crm_pipelines;
DROP POLICY IF EXISTS "org_crm_stages"     ON crm_stages;
DROP POLICY IF EXISTS "org_crm_deals"      ON crm_deals;
DROP POLICY IF EXISTS "org_crm_activities" ON crm_activities;
DROP POLICY IF EXISTS "org_crm_contacts"   ON crm_contacts;

CREATE POLICY "org_crm_pipelines"  ON crm_pipelines  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_crm_stages"     ON crm_stages     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_crm_deals"      ON crm_deals      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_crm_activities" ON crm_activities USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_crm_contacts"   ON crm_contacts   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
