-- Inventory Transfers between locations / warehouses

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_number text        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','pending','in_transit','completed','cancelled')),
  from_location   text        NOT NULL,
  to_location     text        NOT NULL,
  reason          text,
  notes           text,
  approved_by     text,
  approved_at     timestamptz,
  sent_at         timestamptz,
  received_at     timestamptz,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid        NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name    text        NOT NULL,
  quantity_sent   int         NOT NULL DEFAULT 0,
  quantity_received int       NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_transfers_org    ON inventory_transfers(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_items   ON inventory_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_product ON inventory_transfer_items(product_id);

-- Apply completed transfer: deduct from source, add to destination
-- Note: This is a simplified version that adjusts the central stock
-- In a real multi-location system, each location would have its own stock record
CREATE OR REPLACE FUNCTION complete_inventory_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Deduct stock (quantity was already at source, just mark as moved)
  -- For now we log it but don't double-deduct since we use central stock
  UPDATE inventory_transfers
  SET status = 'completed', received_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_transfer_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_transfers_updated ON inventory_transfers;
CREATE TRIGGER trg_transfers_updated
  BEFORE UPDATE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION update_transfer_timestamp();

-- RLS
ALTER TABLE inventory_transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_inventory_transfers"      ON inventory_transfers;
DROP POLICY IF EXISTS "org_inventory_transfer_items" ON inventory_transfer_items;

CREATE POLICY "org_inventory_transfers" ON inventory_transfers
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_inventory_transfer_items" ON inventory_transfer_items
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
