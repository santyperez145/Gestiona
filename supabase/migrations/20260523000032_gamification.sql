-- Staff Gamification — Badges, Points & Leaderboard

CREATE TABLE IF NOT EXISTS badge_definitions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL,
  icon            text        NOT NULL DEFAULT '🏆',
  color           text        NOT NULL DEFAULT '#6366f1',
  category        text        NOT NULL DEFAULT 'performance'
                              CHECK (category IN ('performance','streak','milestone','special','team')),
  condition_type  text        NOT NULL DEFAULT 'manual'
                              CHECK (condition_type IN ('manual','sales_count','sales_amount','tickets_closed','streak_days')),
  condition_value numeric(12,2) NOT NULL DEFAULT 0,
  points          int         NOT NULL DEFAULT 10,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_points (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_name      text        NOT NULL,
  total_points    int         NOT NULL DEFAULT 0,
  level           int         NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS staff_badge_awards (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  badge_id        uuid        NOT NULL REFERENCES badge_definitions(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_name      text        NOT NULL,
  awarded_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  message         text,
  points_earned   int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points          int         NOT NULL,                         -- positive = earn, negative = spend
  reason          text        NOT NULL,
  reference_id    uuid,                                         -- badge_award, sale, etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Award badge: add points and create transaction
CREATE OR REPLACE FUNCTION award_badge(
  p_badge_id uuid,
  p_user_id uuid,
  p_org_id uuid,
  p_staff_name text,
  p_awarded_by uuid,
  p_message text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  badge badge_definitions%ROWTYPE;
  award_id uuid;
BEGIN
  SELECT * INTO badge FROM badge_definitions WHERE id = p_badge_id;

  -- Insert award
  INSERT INTO staff_badge_awards(org_id, badge_id, user_id, staff_name, awarded_by, message, points_earned)
  VALUES (p_org_id, p_badge_id, p_user_id, p_staff_name, p_awarded_by, p_message, badge.points)
  RETURNING id INTO award_id;

  -- Upsert staff_points
  INSERT INTO staff_points(org_id, user_id, staff_name, total_points)
  VALUES (p_org_id, p_user_id, p_staff_name, badge.points)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET total_points = staff_points.total_points + badge.points,
        level = GREATEST(1, (staff_points.total_points + badge.points) / 100 + 1),
        updated_at = now();

  -- Point transaction
  INSERT INTO point_transactions(org_id, user_id, points, reason, reference_id)
  VALUES (p_org_id, p_user_id, badge.points, 'Badge: ' || badge.name, award_id);

  RETURN award_id;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_staff_points_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_sp_updated ON staff_points;
CREATE TRIGGER trg_sp_updated BEFORE UPDATE ON staff_points
  FOR EACH ROW EXECUTE FUNCTION update_staff_points_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_badges_org      ON badge_definitions(org_id, active);
CREATE INDEX IF NOT EXISTS idx_staff_pts_org   ON staff_points(org_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_badge_awards    ON staff_badge_awards(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_badge_awards_u  ON staff_badge_awards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_txns         ON point_transactions(org_id, user_id, created_at DESC);

-- Seed default badges for any org (called manually per org after insert)
-- No auto-seeding here; UI will insert defaults on first load

-- RLS
ALTER TABLE badge_definitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_points       ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_badge_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_badges"     ON badge_definitions;
DROP POLICY IF EXISTS "org_spoints"    ON staff_points;
DROP POLICY IF EXISTS "org_bawards"    ON staff_badge_awards;
DROP POLICY IF EXISTS "org_pt_txns"    ON point_transactions;

CREATE POLICY "org_badges"  ON badge_definitions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_spoints" ON staff_points
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_bawards" ON staff_badge_awards
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_pt_txns" ON point_transactions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
