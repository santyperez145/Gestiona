-- ============================================================================
-- Órdenes de compra a proveedores
-- ============================================================================
-- PurchaseOrdersPage ya estaba escrita contra estas tablas pero nunca se
-- crearon → la página fallaba al abrirla.
-- Distinto de `purchases` (compras ya concretadas): una orden es el pedido
-- previo al proveedor, con su ciclo borrador → enviada → confirmada →
-- recibida (total o parcial).

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_number    TEXT NOT NULL,
  supplier_id     UUID,
  supplier_name   TEXT NOT NULL,
  supplier_email  TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','confirmed','partially_received','received','cancelled')),
  currency        TEXT NOT NULL DEFAULT 'USD',
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  internal_notes  TEXT,
  expected_date   DATE,
  received_date   DATE,
  payment_terms   TEXT,
  sent_at         TIMESTAMPTZ,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name      TEXT NOT NULL,
  sku               TEXT,
  quantity_ordered  NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity_received NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost         NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_rate          NUMERIC(6,3) NOT NULL DEFAULT 0,
  total_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_org    ON public.purchase_orders(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_items  ON public.purchase_order_items(order_id);

DROP TRIGGER IF EXISTS trg_po_updated ON public.purchase_orders;
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read po" ON public.purchase_orders;
CREATE POLICY "org read po" ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write po" ON public.purchase_orders;
CREATE POLICY "admin write po" ON public.purchase_orders FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

DROP POLICY IF EXISTS "org read po_items" ON public.purchase_order_items;
CREATE POLICY "org read po_items" ON public.purchase_order_items FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write po_items" ON public.purchase_order_items;
CREATE POLICY "admin write po_items" ON public.purchase_order_items FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
