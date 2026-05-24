-- Dynamic Customer Segments & Audiences

CREATE TABLE IF NOT EXISTS customer_segments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  color           text        NOT NULL DEFAULT '#6366f1',
  is_dynamic      boolean     NOT NULL DEFAULT true,   -- auto-updates via rules
  rules           jsonb       NOT NULL DEFAULT '[]',    -- [{field, op, value}]
  customer_count  int         NOT NULL DEFAULT 0,
  last_synced_at  timestamptz,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_segment_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id      uuid        NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_id, customer_id)
);

CREATE TABLE IF NOT EXISTS segment_campaigns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  segment_id      uuid        NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  channel         text        NOT NULL DEFAULT 'email'
                              CHECK (channel IN ('email','whatsapp','sms','push','in_app')),
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','scheduled','running','completed','cancelled')),
  scheduled_at    timestamptz,
  sent_count      int         NOT NULL DEFAULT 0,
  open_count      int         NOT NULL DEFAULT 0,
  click_count     int         NOT NULL DEFAULT 0,
  conversion_count int        NOT NULL DEFAULT 0,
  template_id     uuid,       -- references marketing_templates if any
  subject         text,
  body_preview    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_org         ON customer_segments(org_id, active);
CREATE INDEX IF NOT EXISTS idx_seg_members          ON customer_segment_members(segment_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_seg_members_cust     ON customer_segment_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_seg_campaigns        ON segment_campaigns(org_id, status, scheduled_at);

-- Sync dynamic segment members based on rules
-- Rules format: [{"field": "total_spent", "op": "gte", "value": 10000}]
CREATE OR REPLACE FUNCTION sync_segment_members(p_segment_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  seg customer_segments%ROWTYPE;
  rule jsonb;
  base_query text;
  where_parts text[] := ARRAY[]::text[];
  final_query text;
  member_count int;
BEGIN
  SELECT * INTO seg FROM customer_segments WHERE id = p_segment_id;

  -- Delete existing dynamic members
  DELETE FROM customer_segment_members WHERE segment_id = p_segment_id;

  -- Build WHERE clause from rules
  FOR rule IN SELECT jsonb_array_elements(seg.rules)
  LOOP
    DECLARE
      field text := rule->>'field';
      op    text := rule->>'op';
      val   text := rule->>'value';
      clause text;
    BEGIN
      clause := CASE
        WHEN field = 'total_spent'     AND op = 'gte' THEN 'c.total_spent >= ' || val::numeric
        WHEN field = 'total_spent'     AND op = 'lte' THEN 'c.total_spent <= ' || val::numeric
        WHEN field = 'total_purchases' AND op = 'gte' THEN 'c.total_purchases >= ' || val::int
        WHEN field = 'total_purchases' AND op = 'lte' THEN 'c.total_purchases <= ' || val::int
        WHEN field = 'city'            AND op = 'eq'  THEN 'c.city = ' || quote_literal(val)
        WHEN field = 'tag'             AND op = 'contains' THEN val || ' = ANY(c.tags)'
        ELSE NULL
      END;
      IF clause IS NOT NULL THEN
        where_parts := array_append(where_parts, clause);
      END IF;
    END;
  END LOOP;

  -- Insert matching customers
  final_query := 'INSERT INTO customer_segment_members(segment_id, customer_id) SELECT $1, c.id FROM customers c WHERE c.org_id = $2';
  IF array_length(where_parts, 1) > 0 THEN
    final_query := final_query || ' AND ' || array_to_string(where_parts, ' AND ');
  END IF;
  final_query := final_query || ' ON CONFLICT DO NOTHING';

  EXECUTE final_query USING p_segment_id, seg.org_id;

  SELECT COUNT(*) INTO member_count FROM customer_segment_members WHERE segment_id = p_segment_id;

  UPDATE customer_segments SET customer_count = member_count, last_synced_at = now(), updated_at = now()
  WHERE id = p_segment_id;

  RETURN member_count;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_seg_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_seg_updated ON customer_segments;
CREATE TRIGGER trg_seg_updated BEFORE UPDATE ON customer_segments FOR EACH ROW EXECUTE FUNCTION update_seg_timestamp();

DROP TRIGGER IF EXISTS trg_seg_camp_updated ON segment_campaigns;
CREATE TRIGGER trg_seg_camp_updated BEFORE UPDATE ON segment_campaigns FOR EACH ROW EXECUTE FUNCTION update_seg_timestamp();

-- RLS
ALTER TABLE customer_segments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_campaigns        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_segments"      ON customer_segments;
DROP POLICY IF EXISTS "org_seg_members"   ON customer_segment_members;
DROP POLICY IF EXISTS "org_seg_campaigns" ON segment_campaigns;

CREATE POLICY "org_segments"      ON customer_segments        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_seg_members"   ON customer_segment_members USING (segment_id IN (SELECT id FROM customer_segments WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_seg_campaigns" ON segment_campaigns        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
