-- Batch / Lot Tracking with Expiry Dates

CREATE TABLE IF NOT EXISTS product_batches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_number      text        NOT NULL,
  expiry_date     date,
  manufacture_date date,
  quantity        numeric(14,4) NOT NULL DEFAULT 0,
  reserved_qty    numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost       numeric(14,2),
  supplier_id     uuid        REFERENCES proveedores(id) ON DELETE SET NULL,
  purchase_ref    text,
  notes           text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','quarantine','expired','depleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id, lot_number)
);

CREATE TABLE IF NOT EXISTS batch_movements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid        NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
  movement_type   text        NOT NULL
                              CHECK (movement_type IN ('in','out','adjustment','transfer','return')),
  quantity        numeric(14,4) NOT NULL,
  reference_type  text,        -- 'sale','purchase','return','adjustment'
  reference_id    uuid,
  notes           text,
  performed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-update batch quantity from movements
CREATE OR REPLACE FUNCTION update_batch_qty()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_batches
  SET quantity = quantity + CASE
      WHEN NEW.movement_type IN ('in','return') THEN NEW.quantity
      ELSE -NEW.quantity
    END,
    updated_at = now()
  WHERE id = NEW.batch_id;

  -- Auto-mark depleted
  UPDATE product_batches SET status = 'depleted'
  WHERE id = NEW.batch_id AND quantity <= 0 AND status = 'active';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_movement ON batch_movements;
CREATE TRIGGER trg_batch_movement AFTER INSERT ON batch_movements
  FOR EACH ROW EXECUTE FUNCTION update_batch_qty();

-- Auto-expire batches past expiry date
CREATE OR REPLACE FUNCTION expire_batches(p_org_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  UPDATE product_batches
  SET status = 'expired', updated_at = now()
  WHERE org_id = p_org_id
    AND status = 'active'
    AND expiry_date IS NOT NULL
    AND expiry_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batches_org        ON product_batches(org_id, status);
CREATE INDEX IF NOT EXISTS idx_batches_product    ON product_batches(product_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry     ON product_batches(org_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_batch_mvmt_batch   ON batch_movements(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_mvmt_org     ON batch_movements(org_id, created_at DESC);

-- RLS
ALTER TABLE product_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_movements   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_product_batches"  ON product_batches;
DROP POLICY IF EXISTS "org_batch_movements"  ON batch_movements;

CREATE POLICY "org_product_batches" ON product_batches
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_batch_movements" ON batch_movements
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
