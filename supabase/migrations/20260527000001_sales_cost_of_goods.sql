-- Add cost_of_goods_ars to sales for P&L gross profit calculation
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cost_of_goods_ars numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sales.cost_of_goods_ars IS
  'Total cost in ARS of goods sold in this transaction (for gross profit in P&L)';
