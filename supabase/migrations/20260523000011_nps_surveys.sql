-- NPS & CSAT Surveys
-- Gestiona ERP — Net Promoter Score + Customer Satisfaction

CREATE TABLE IF NOT EXISTS nps_surveys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  type          text        NOT NULL DEFAULT 'nps'
                            CHECK (type IN ('nps', 'csat')),
  question      text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  send_after_purchase boolean NOT NULL DEFAULT false,
  send_after_days int       NOT NULL DEFAULT 3,
  response_count int        NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nps_responses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id     uuid        NOT NULL REFERENCES nps_surveys(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id   uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  score         int         NOT NULL,
  feedback      text,
  source        text        NOT NULL DEFAULT 'link'
                            CHECK (source IN ('link', 'email', 'whatsapp', 'pos')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_surveys_org       ON nps_surveys(org_id, active);
CREATE INDEX IF NOT EXISTS idx_nps_responses_survey  ON nps_responses(survey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_responses_org     ON nps_responses(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_responses_score   ON nps_responses(org_id, score);

-- Auto-increment response_count on new response
CREATE OR REPLACE FUNCTION increment_survey_response_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nps_surveys SET response_count = response_count + 1, updated_at = now()
  WHERE id = NEW.survey_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nps_response_count ON nps_responses;
CREATE TRIGGER trg_nps_response_count
  AFTER INSERT ON nps_responses
  FOR EACH ROW EXECUTE FUNCTION increment_survey_response_count();

-- updated_at trigger for surveys
CREATE OR REPLACE FUNCTION update_nps_survey_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_nps_survey_updated ON nps_surveys;
CREATE TRIGGER trg_nps_survey_updated
  BEFORE UPDATE ON nps_surveys
  FOR EACH ROW EXECUTE FUNCTION update_nps_survey_timestamp();

-- NPS score aggregate view
CREATE OR REPLACE VIEW nps_survey_stats AS
SELECT
  s.id                                                        AS survey_id,
  s.org_id,
  s.name,
  s.type,
  COUNT(r.id)                                                 AS total_responses,
  COUNT(r.id) FILTER (WHERE s.type = 'nps' AND r.score >= 9)  AS promoters,
  COUNT(r.id) FILTER (WHERE s.type = 'nps' AND r.score BETWEEN 7 AND 8) AS passives,
  COUNT(r.id) FILTER (WHERE s.type = 'nps' AND r.score <= 6)  AS detractors,
  ROUND(AVG(r.score), 2)                                      AS avg_score,
  MAX(r.created_at)                                           AS last_response_at
FROM nps_surveys s
LEFT JOIN nps_responses r ON r.survey_id = s.id
GROUP BY s.id, s.org_id, s.name, s.type;

-- RLS
ALTER TABLE nps_surveys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_nps_surveys"   ON nps_surveys;
DROP POLICY IF EXISTS "org_nps_responses" ON nps_responses;

CREATE POLICY "org_nps_surveys" ON nps_surveys
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_nps_responses" ON nps_responses
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Public insert for survey respondents (unauthenticated)
DROP POLICY IF EXISTS "public_nps_response_insert" ON nps_responses;
CREATE POLICY "public_nps_response_insert" ON nps_responses
  FOR INSERT WITH CHECK (true);
