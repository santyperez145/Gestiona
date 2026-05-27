-- Sales Gamification Engine: leaderboards, badges, challenges, XP system

CREATE TABLE IF NOT EXISTS gamification_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  xp_per_sale     int         NOT NULL DEFAULT 10,
  xp_per_1000_revenue int     NOT NULL DEFAULT 5,
  xp_new_customer int         NOT NULL DEFAULT 20,
  xp_upsell       int         NOT NULL DEFAULT 15,
  level_thresholds int[]      NOT NULL DEFAULT '{0,100,300,600,1000,1500,2200,3000}',
  level_names     text[]      NOT NULL DEFAULT '{"Novato","Vendedor","Pro","Experto","Élite","Leyenda","Maestro","Campeón"}',
  streak_bonus_pct int        NOT NULL DEFAULT 10,
  reset_cycle     text        NOT NULL DEFAULT 'monthly' CHECK (reset_cycle IN ('weekly','monthly','quarterly')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS gamification_profiles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp        int         NOT NULL DEFAULT 0,
  current_level   int         NOT NULL DEFAULT 0,
  current_streak  int         NOT NULL DEFAULT 0,
  longest_streak  int         NOT NULL DEFAULT 0,
  last_sale_date  date,
  badges_earned   text[]      NOT NULL DEFAULT '{}',
  rank_position   int,
  stats           jsonb       NOT NULL DEFAULT '{}',  -- {sales_count, revenue_total, new_customers, upsells}
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS gamification_badges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  icon            text        NOT NULL DEFAULT '🏅',
  category        text        NOT NULL DEFAULT 'achievement' CHECK (category IN ('achievement','streak','revenue','customer','special','seasonal')),
  condition_type  text        NOT NULL CHECK (condition_type IN ('sales_count','revenue_total','streak_days','new_customers','single_sale','upsells')),
  threshold       numeric(18,2) NOT NULL DEFAULT 0,
  xp_reward       int         NOT NULL DEFAULT 50,
  rarity          text        NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','uncommon','rare','epic','legendary')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS gamification_challenges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL,
  challenge_type  text        NOT NULL CHECK (challenge_type IN ('individual','team','org_wide')),
  metric          text        NOT NULL CHECK (metric IN ('sales_count','revenue','new_customers','avg_ticket','upsell_rate')),
  target_value    numeric(18,2) NOT NULL,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  xp_reward       int         NOT NULL DEFAULT 100,
  badge_reward    text,
  participants    uuid[]      NOT NULL DEFAULT '{}',
  progress        jsonb       NOT NULL DEFAULT '{}',  -- {user_id: current_value}
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gamification_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type      text        NOT NULL CHECK (event_type IN ('sale','new_customer','upsell','badge_earned','level_up','streak_milestone','challenge_complete')),
  xp_earned       int         NOT NULL DEFAULT 0,
  description     text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Award XP and check level-up
CREATE OR REPLACE FUNCTION award_xp(
  p_org_id    uuid,
  p_user_id   uuid,
  p_xp        int,
  p_event     text,
  p_metadata  jsonb DEFAULT '{}'
) RETURNS TABLE(new_xp int, new_level int, leveled_up boolean) LANGUAGE plpgsql AS $$
DECLARE
  v_profile gamification_profiles;
  v_config  gamification_config;
  v_new_level int;
  v_leveled_up boolean := false;
BEGIN
  SELECT * INTO v_config FROM gamification_config WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO gamification_profiles (org_id, user_id, total_xp)
  VALUES (p_org_id, p_user_id, p_xp)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET total_xp = gamification_profiles.total_xp + p_xp,
        updated_at = now()
  RETURNING * INTO v_profile;

  -- Compute new level from thresholds
  SELECT i - 1 INTO v_new_level
  FROM unnest(v_config.level_thresholds) WITH ORDINALITY AS t(threshold, i)
  WHERE t.threshold > v_profile.total_xp
  ORDER BY i LIMIT 1;

  v_new_level := COALESCE(v_new_level, array_length(v_config.level_thresholds, 1) - 1);

  IF v_new_level > v_profile.current_level THEN
    v_leveled_up := true;
    UPDATE gamification_profiles SET current_level = v_new_level WHERE org_id = p_org_id AND user_id = p_user_id;
  END IF;

  -- Log event
  INSERT INTO gamification_events (org_id, user_id, event_type, xp_earned, metadata)
  VALUES (p_org_id, p_user_id, p_event, p_xp, p_metadata);

  RETURN QUERY SELECT v_profile.total_xp, v_new_level, v_leveled_up;
END;
$$;

-- Leaderboard view
CREATE OR REPLACE VIEW gamification_leaderboard AS
SELECT
  gp.org_id,
  gp.user_id,
  au.email,
  gp.total_xp,
  gp.current_level,
  gp.current_streak,
  gp.badges_earned,
  gp.stats,
  RANK() OVER (PARTITION BY gp.org_id ORDER BY gp.total_xp DESC) AS rank_position
FROM gamification_profiles gp
JOIN auth.users au ON au.id = gp.user_id;

-- Seed default badges
CREATE OR REPLACE FUNCTION seed_gamification_badges(p_org_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO gamification_badges (org_id, code, name, description, icon, category, condition_type, threshold, xp_reward, rarity) VALUES
    (p_org_id, 'first_sale',       'Primera Venta',      'Realizaste tu primera venta',            '🎯', 'achievement', 'sales_count',    1,       50,  'common'),
    (p_org_id, 'sales_10',         '10 Ventas',          'Alcanzaste 10 ventas',                   '🔟', 'achievement', 'sales_count',    10,      100, 'common'),
    (p_org_id, 'sales_100',        '100 Ventas',         'Cerraste 100 ventas',                    '💯', 'achievement', 'sales_count',    100,     500, 'rare'),
    (p_org_id, 'streak_7',         'Racha Semanal',      '7 días consecutivos con ventas',         '🔥', 'streak',      'streak_days',    7,       150, 'uncommon'),
    (p_org_id, 'streak_30',        'Mes Perfecto',       '30 días consecutivos con ventas',        '🌟', 'streak',      'streak_days',    30,      500, 'epic'),
    (p_org_id, 'revenue_1m',       'Club del Millón',    'Superaste $1.000.000 en ventas',         '💰', 'revenue',     'revenue_total',  1000000, 750, 'epic'),
    (p_org_id, 'new_customers_50', 'Conquistador',       'Conseguiste 50 clientes nuevos',         '👑', 'customer',    'new_customers',  50,      300, 'rare'),
    (p_org_id, 'big_ticket',       'Ticket Grande',      'Venta individual por más de $50.000',    '🏆', 'achievement', 'single_sale',    50000,   200, 'uncommon'),
    (p_org_id, 'upsell_master',    'Maestro del Upsell', '25 upsells concretados',                 '📈', 'achievement', 'upsells',        25,      250, 'rare'),
    (p_org_id, 'legend',           'Leyenda',            'Alcanzaste el nivel Leyenda',             '🦅', 'special',     'sales_count',    1000,    1000,'legendary')
  ON CONFLICT (org_id, code) DO NOTHING;
END;
$$;

-- Seed default config
CREATE OR REPLACE FUNCTION seed_gamification_config(p_org_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO gamification_config (org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
  PERFORM seed_gamification_badges(p_org_id);
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gam_profiles_org    ON gamification_profiles(org_id, total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_gam_events_user     ON gamification_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gam_challenges_org  ON gamification_challenges(org_id, is_active, end_date);
CREATE INDEX IF NOT EXISTS idx_gam_badges_org      ON gamification_badges(org_id, category, rarity);

-- RLS
ALTER TABLE gamification_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_badges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_events     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_gam_config"      ON gamification_config;
DROP POLICY IF EXISTS "org_gam_profiles"    ON gamification_profiles;
DROP POLICY IF EXISTS "org_gam_badges"      ON gamification_badges;
DROP POLICY IF EXISTS "org_gam_challenges"  ON gamification_challenges;
DROP POLICY IF EXISTS "org_gam_events"      ON gamification_events;

CREATE POLICY "org_gam_config"      ON gamification_config     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_gam_profiles"    ON gamification_profiles   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_gam_badges"      ON gamification_badges     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_gam_challenges"  ON gamification_challenges USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_gam_events"      ON gamification_events     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
