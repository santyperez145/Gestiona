-- Custom Forms / Survey Builder

CREATE TABLE IF NOT EXISTS custom_forms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  slug            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed','archived')),
  form_type       text        NOT NULL DEFAULT 'lead'
                              CHECK (form_type IN ('lead','survey','contact','order','booking','feedback','other')),
  fields          jsonb       NOT NULL DEFAULT '[]',
  settings        jsonb       NOT NULL DEFAULT '{}',
  notify_email    text,
  redirect_url    text,
  success_message text        NOT NULL DEFAULT '¡Gracias por tu respuesta!',
  response_count  int         NOT NULL DEFAULT 0,
  closes_at       timestamptz,
  max_responses   int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

-- fields JSONB schema example:
-- [
--   { "id": "uuid", "type": "text|email|phone|select|checkbox|radio|textarea|number|date|file|rating|heading|divider",
--     "label": "Nombre", "placeholder": "...", "required": true,
--     "options": ["Opción A", "Opción B"],  -- for select/radio/checkbox
--     "min": 0, "max": 100,               -- for number/rating
--     "width": "full|half"
--   }
-- ]

CREATE TABLE IF NOT EXISTS form_responses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         uuid        NOT NULL REFERENCES custom_forms(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data            jsonb       NOT NULL DEFAULT '{}',
  ip_address      text,
  user_agent      text,
  referrer        text,
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

-- Increment response count on new submission
CREATE OR REPLACE FUNCTION increment_form_responses()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE custom_forms SET response_count = response_count + 1, updated_at = now()
  WHERE id = NEW.form_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_count ON form_responses;
CREATE TRIGGER trg_form_count AFTER INSERT ON form_responses
  FOR EACH ROW EXECUTE FUNCTION increment_form_responses();

-- updated_at
CREATE OR REPLACE FUNCTION update_form_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_form_updated ON custom_forms;
CREATE TRIGGER trg_form_updated BEFORE UPDATE ON custom_forms
  FOR EACH ROW EXECUTE FUNCTION update_form_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_forms_org      ON custom_forms(org_id, status);
CREATE INDEX IF NOT EXISTS idx_forms_slug     ON custom_forms(org_id, slug);
CREATE INDEX IF NOT EXISTS idx_form_responses ON form_responses(form_id, submitted_at DESC);

-- RLS
ALTER TABLE custom_forms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_responses  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_forms"     ON custom_forms;
DROP POLICY IF EXISTS "org_responses" ON form_responses;

CREATE POLICY "org_forms" ON custom_forms
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_responses" ON form_responses
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
