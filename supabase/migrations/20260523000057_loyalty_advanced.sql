-- Loyalty Program Advanced (tiers, rewards catalog, redemption)

CREATE TABLE IF NOT EXISTS loyalty_programs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'Programa de Fidelidad',
  description     text,
  points_per_peso numeric(8,4) NOT NULL DEFAULT 1,    -- points earned per ARS spent
  min_redemption  int         NOT NULL DEFAULT 100,   -- minimum points to redeem
  expiry_days     int,                                -- null = no expiry
  is_active       boolean     NOT NULL DEFAULT true,
  terms           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  min_points      int         NOT NULL DEFAULT 0,
  max_points      int,
  multiplier      numeric(4,2) NOT NULL DEFAULT 1.0,  -- points multiplier for this tier
  color           text        NOT NULL DEFAULT '#6b7280',
  icon            text        NOT NULL DEFAULT '⭐',
  benefits        text[],                             -- array of benefit descriptions
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  reward_type     text        NOT NULL CHECK (reward_type IN ('discount_pct','discount_fixed','free_product','gift_card','experience','other')),
  points_cost     int         NOT NULL,
  discount_value  numeric(10,2),                      -- for discount_pct / discount_fixed / gift_card
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL, -- for free_product
  stock_limit     int,                                -- null = unlimited
  redeemed_count  int         NOT NULL DEFAULT 0,
  valid_from      date,
  valid_to        date,
  min_tier_id     uuid        REFERENCES loyalty_tiers(id) ON DELETE SET NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  image_url       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  current_points  int         NOT NULL DEFAULT 0,
  lifetime_points int         NOT NULL DEFAULT 0,
  tier_id         uuid        REFERENCES loyalty_tiers(id) ON DELETE SET NULL,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  last_activity   timestamptz,
  notes           text,
  UNIQUE (org_id, customer_id)
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid        NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  transaction_type text       NOT NULL CHECK (transaction_type IN ('earn','redeem','adjust','expire','bonus')),
  points          int         NOT NULL,               -- positive = earn, negative = redeem/expire
  balance_after   int         NOT NULL DEFAULT 0,
  description     text        NOT NULL,
  reference_type  text,                               -- 'sale', 'reward', 'manual'
  reference_id    uuid,
  reward_id       uuid        REFERENCES loyalty_rewards(id) ON DELETE SET NULL,
  expiry_date     date,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-update member balance and tier after each transaction
CREATE OR REPLACE FUNCTION after_loyalty_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new_balance int;
  v_tier_id     uuid;
BEGIN
  -- Recompute balance
  SELECT COALESCE(SUM(points), 0)
  INTO v_new_balance
  FROM loyalty_transactions
  WHERE member_id = NEW.member_id;

  -- Determine tier from loyalty_tiers (highest tier whose min_points <= balance)
  SELECT id INTO v_tier_id
  FROM loyalty_tiers
  WHERE org_id = NEW.org_id AND min_points <= v_new_balance
  ORDER BY min_points DESC
  LIMIT 1;

  UPDATE loyalty_members
  SET current_points = v_new_balance,
      lifetime_points = GREATEST(lifetime_points, v_new_balance),
      tier_id         = v_tier_id,
      last_activity   = now()
  WHERE id = NEW.member_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_after_loyalty_txn
AFTER INSERT ON loyalty_transactions
FOR EACH ROW EXECUTE FUNCTION after_loyalty_transaction();

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_loyalty_program_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_loyalty_program_ts
BEFORE UPDATE ON loyalty_programs
FOR EACH ROW EXECUTE FUNCTION update_loyalty_program_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_members_org      ON loyalty_members(org_id, tier_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_customer ON loyalty_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_txns_member      ON loyalty_transactions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_txns_org         ON loyalty_transactions(org_id, transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_org      ON loyalty_rewards(org_id, is_active, points_cost);
CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_org        ON loyalty_tiers(org_id, min_points);

-- RLS
ALTER TABLE loyalty_programs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_rewards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_loyalty_programs"     ON loyalty_programs;
DROP POLICY IF EXISTS "org_loyalty_tiers"        ON loyalty_tiers;
DROP POLICY IF EXISTS "org_loyalty_rewards"      ON loyalty_rewards;
DROP POLICY IF EXISTS "org_loyalty_members"      ON loyalty_members;
DROP POLICY IF EXISTS "org_loyalty_transactions" ON loyalty_transactions;

CREATE POLICY "org_loyalty_programs"     ON loyalty_programs     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_loyalty_tiers"        ON loyalty_tiers        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_loyalty_rewards"      ON loyalty_rewards      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_loyalty_members"      ON loyalty_members      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_loyalty_transactions" ON loyalty_transactions  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
