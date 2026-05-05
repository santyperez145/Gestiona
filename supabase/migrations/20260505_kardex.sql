-- ============================================================================
-- KARDEX — Movimientos de Stock
-- Tabla de trazabilidad completa de entradas/salidas/ajustes de inventario
-- ============================================================================

-- 1. Tabla principal de movimientos
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id      UUID        REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id      UUID        REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name    TEXT        NOT NULL,
  variant_name    TEXT,

  -- Tipo de movimiento
  movement_type   TEXT        NOT NULL,
  -- Valores: 'purchase' | 'sale' | 'return_in' | 'return_out' |
  --          'adjustment_in' | 'adjustment_out' | 'transfer_in' | 'transfer_out' |
  --          'physical_count' | 'initial'

  -- Cantidades (positivo = entrada, negativo = salida)
  quantity        INTEGER     NOT NULL,  -- delta aplicado al stock
  stock_before    INTEGER     NOT NULL DEFAULT 0,
  stock_after     INTEGER     NOT NULL DEFAULT 0,

  -- Referencia al documento origen
  reference_type  TEXT,   -- 'sale' | 'purchase' | 'invoice' | 'stock_count' | 'manual'
  reference_id    UUID,   -- id del registro origen

  -- Información de costo/precio para análisis
  unit_cost_usd   NUMERIC,
  unit_price_ars  NUMERIC,

  -- Meta
  notes           TEXT,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_org        ON public.stock_movements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product    ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant    ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type       ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref        ON public.stock_movements(reference_type, reference_id);

-- RLS
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read stock movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE POLICY "org members insert stock movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- ============================================================================
-- 2. Función genérica para registrar movimiento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id        UUID,
  p_product_id    UUID,
  p_variant_id    UUID,
  p_product_name  TEXT,
  p_variant_name  TEXT,
  p_movement_type TEXT,
  p_quantity      INTEGER,   -- positivo=entrada, negativo=salida
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id  UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL,
  p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL,
  p_created_by    UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stock_before  INTEGER;
  v_stock_after   INTEGER;
  v_mov_id        UUID;
BEGIN
  -- Obtener stock actual (de variante si existe, si no del producto)
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id;
  END IF;

  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  -- Actualizar stock en tabla origen
  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_stock_after
    WHERE id = p_variant_id;

    -- Sincronizar stock del producto padre como suma de variantes
    UPDATE public.products p
    SET stock = (
      SELECT COALESCE(SUM(pv.stock), 0)
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    )
    WHERE id = p_product_id;
  ELSE
    UPDATE public.products
    SET stock = v_stock_after
    WHERE id = p_product_id;
  END IF;

  -- Insertar movimiento
  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id,
    unit_cost_usd, unit_price_ars,
    notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id,
    p_unit_cost_usd, p_unit_price_ars,
    p_notes, p_created_by
  )
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- ============================================================================
-- 3. Trigger: registrar movimiento al completar una venta (sales)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  -- Obtener org_id desde el user_id de la venta (via memberships)
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  -- Nombre de variante (si aplica)
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id         => v_org_id,
    p_product_id     => NEW.product_id,
    p_variant_id     => NEW.variant_id,
    p_product_name   => NEW.product_name,
    p_variant_name   => v_variant_name,
    p_movement_type  => 'sale',
    p_quantity       => -NEW.quantity,   -- salida
    p_reference_type => 'sale',
    p_reference_id   => NEW.id,
    p_unit_cost_usd  => NEW.cost_per_unit_usd,
    p_unit_price_ars => NEW.unit_price_ars,
    p_created_by     => NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

-- ============================================================================
-- 4. Trigger: registrar movimiento al registrar una compra (purchases)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.record_stock_movement(
    p_org_id         => v_org_id,
    p_product_id     => NEW.product_id,
    p_variant_id     => NULL,
    p_product_name   => NEW.product_name,
    p_variant_name   => NULL,
    p_movement_type  => 'purchase',
    p_quantity       => NEW.quantity,   -- entrada
    p_reference_type => 'purchase',
    p_reference_id   => NEW.id,
    p_unit_cost_usd  => NEW.unit_cost_usd,
    p_created_by     => NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
CREATE TRIGGER trg_purchase_stock_movement
  AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_stock_movement();

-- ============================================================================
-- 5. Vista agregada por producto (kardex resumido)
-- ============================================================================
CREATE OR REPLACE VIEW public.kardex_summary AS
SELECT
  sm.org_id,
  sm.product_id,
  sm.product_name,
  p.stock AS current_stock,
  COUNT(*)                                              AS total_movements,
  SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END) AS total_in,
  SUM(CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END) AS total_out,
  MAX(sm.created_at)                                    AS last_movement_at
FROM public.stock_movements sm
LEFT JOIN public.products p ON p.id = sm.product_id
GROUP BY sm.org_id, sm.product_id, sm.product_name, p.stock;

-- ============================================================================
-- 6. Función de ajuste manual de stock (llamada desde UI)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id        UUID,
  p_product_id    UUID,
  p_variant_id    UUID,
  p_new_stock     INTEGER,   -- stock objetivo después del ajuste
  p_notes         TEXT,
  p_created_by    UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_stock INTEGER;
  v_delta         INTEGER;
  v_product_name  TEXT;
  v_variant_name  TEXT;
  v_movement_type TEXT;
BEGIN
  -- Verificar membresía
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id AND user_id = p_created_by
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name, stock INTO v_variant_name, v_current_stock
    FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_current_stock FROM public.products WHERE id = p_product_id;
  END IF;

  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta         := p_new_stock - v_current_stock;

  IF v_delta = 0 THEN RETURN NULL; END IF;

  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;

  RETURN public.record_stock_movement(
    p_org_id         => p_org_id,
    p_product_id     => p_product_id,
    p_variant_id     => p_variant_id,
    p_product_name   => v_product_name,
    p_variant_name   => v_variant_name,
    p_movement_type  => v_movement_type,
    p_quantity       => v_delta,
    p_reference_type => 'manual',
    p_reference_id   => NULL,
    p_notes          => p_notes,
    p_created_by     => p_created_by
  );
END;
$$;
