-- Gift Cards (Tarjetas de Regalo)

CREATE TABLE IF NOT EXISTS gift_cards (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  initial_balance numeric(14,2) NOT NULL DEFAULT 0,
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','used','expired','cancelled','pending')),
  issued_to_name  text,
  issued_to_email text,
  purchased_by_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  sale_price      numeric(14,2),          -- what was paid for the card
  expiry_date     date,
  activated_at    timestamptz,
  fully_used_at   timestamptz,
  design          text        NOT NULL DEFAULT 'default',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gift_card_id    uuid        NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  transaction_type text       NOT NULL CHECK (transaction_type IN ('redeem','load','refund','expire')),
  amount          numeric(14,2) NOT NULL,
  balance_before  numeric(14,2) NOT NULL,
  balance_after   numeric(14,2) NOT NULL,
  reference_type  text,       -- 'sale', 'manual', etc.
  reference_id    uuid,
  notes           text,
  performed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate gift card code
CREATE OR REPLACE FUNCTION generate_gift_card_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, ceil(random() * length(chars))::int, 1)
                     || substr(chars, ceil(random() * length(chars))::int, 1)
                     || substr(chars, ceil(random() * length(chars))::int, 1)
                     || substr(chars, ceil(random() * length(chars))::int, 1);
    IF i < 4 THEN result := result || '-'; END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION set_gift_card_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := generate_gift_card_code();
  END IF;
  NEW.current_balance := NEW.initial_balance;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gift_card_defaults ON gift_cards;
CREATE TRIGGER trg_gift_card_defaults BEFORE INSERT ON gift_cards
  FOR EACH ROW EXECUTE FUNCTION set_gift_card_defaults();

-- After redeem/load/refund: update card balance and status
CREATE OR REPLACE FUNCTION apply_gift_card_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Record balance_before
  NEW.balance_before := (SELECT current_balance FROM gift_cards WHERE id = NEW.gift_card_id);

  -- Compute new balance
  NEW.balance_after := CASE
    WHEN NEW.transaction_type IN ('redeem','expire') THEN GREATEST(0, NEW.balance_before - NEW.amount)
    WHEN NEW.transaction_type IN ('load','refund') THEN NEW.balance_before + NEW.amount
    ELSE NEW.balance_before
  END;

  -- Update card balance + status
  UPDATE gift_cards
  SET current_balance = NEW.balance_after,
    updated_at = now(),
    fully_used_at = CASE WHEN NEW.balance_after = 0 THEN now() ELSE fully_used_at END,
    status = CASE WHEN NEW.balance_after = 0 THEN 'used' ELSE status END
  WHERE id = NEW.gift_card_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gift_card_txn ON gift_card_transactions;
CREATE TRIGGER trg_gift_card_txn BEFORE INSERT ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_gift_card_transaction();

-- updated_at
CREATE OR REPLACE FUNCTION update_gift_card_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_gc_ts ON gift_cards;
CREATE TRIGGER trg_gc_ts BEFORE UPDATE ON gift_cards FOR EACH ROW EXECUTE FUNCTION update_gift_card_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gift_cards_org    ON gift_cards(org_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code   ON gift_cards(org_id, code);
CREATE INDEX IF NOT EXISTS idx_gc_txns_card      ON gift_card_transactions(gift_card_id, created_at DESC);

-- RLS
ALTER TABLE gift_cards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_gift_cards"     ON gift_cards;
DROP POLICY IF EXISTS "org_gc_txns"        ON gift_card_transactions;

CREATE POLICY "org_gift_cards" ON gift_cards
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_gc_txns" ON gift_card_transactions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
