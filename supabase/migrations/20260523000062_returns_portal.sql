-- Returns & Refunds Portal (RMA)

CREATE TABLE IF NOT EXISTS return_reasons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  requires_photo  boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS return_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rma_number      text        NOT NULL,
  sale_id         uuid        REFERENCES sales(id) ON DELETE SET NULL,
  client_id       uuid        REFERENCES clients(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL DEFAULT '',
  customer_email  text,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  quantity        int         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason_id       uuid        REFERENCES return_reasons(id) ON DELETE SET NULL,
  reason_text     text,
  photos          text[]      NOT NULL DEFAULT '{}',
  condition       text        NOT NULL DEFAULT 'unknown' CHECK (condition IN ('new','good','damaged','defective','unknown')),
  resolution      text        CHECK (resolution IN ('refund','exchange','store_credit','repair','rejection')),
  resolution_notes text,
  refund_amount   numeric(14,2),
  refund_method   text        CHECK (refund_method IN ('original_payment','cash','bank_transfer','store_credit','gift_card')),
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','processing','resolved','closed')),
  approved_by     uuid        REFERENCES auth.users(id),
  approved_at     timestamptz,
  rejected_reason text,
  received_at     timestamptz,
  resolved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate RMA number: RMA-YYYY-NNNNN
CREATE OR REPLACE FUNCTION set_rma_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_year  text  := TO_CHAR(now(), 'YYYY');
  v_seq   int;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(rma_number, '-', 3) AS int)), 0) + 1
  INTO v_seq
  FROM return_requests
  WHERE org_id = NEW.org_id AND rma_number LIKE 'RMA-' || v_year || '-%';

  NEW.rma_number := 'RMA-' || v_year || '-' || LPAD(v_seq::text, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_rma_number
BEFORE INSERT ON return_requests
FOR EACH ROW WHEN (NEW.rma_number = '')
EXECUTE FUNCTION set_rma_number();

-- Updated_at
CREATE OR REPLACE FUNCTION update_return_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_return_ts
BEFORE UPDATE ON return_requests
FOR EACH ROW EXECUTE FUNCTION update_return_ts();

-- Default return reasons
CREATE OR REPLACE FUNCTION seed_return_reasons(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO return_reasons (org_id, name, requires_photo, sort_order) VALUES
    (p_org_id, 'Producto defectuoso',         true,  0),
    (p_org_id, 'Producto dañado en el envío',  true,  1),
    (p_org_id, 'Producto incorrecto recibido', true,  2),
    (p_org_id, 'No cumple expectativas',       false, 3),
    (p_org_id, 'Cambio de opinión',            false, 4),
    (p_org_id, 'Talle / medida incorrecta',    false, 5),
    (p_org_id, 'Error en el pedido',           false, 6),
    (p_org_id, 'Otro',                         false, 7)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_returns_org        ON return_requests(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_client     ON return_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale       ON return_requests(sale_id);
CREATE INDEX IF NOT EXISTS idx_return_reasons_org ON return_reasons(org_id, is_active);

-- RLS
ALTER TABLE return_reasons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_return_reasons"  ON return_reasons;
DROP POLICY IF EXISTS "org_return_requests" ON return_requests;

CREATE POLICY "org_return_reasons"  ON return_reasons  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_return_requests" ON return_requests USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
