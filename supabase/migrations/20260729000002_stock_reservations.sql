-- ============================================================================
-- Reservas de stock reales
-- ============================================================================
-- Hasta ahora "reservar" era un movimiento de kardex que DESCONTABA stock,
-- lo que mezclaba reservas con ventas y no se podía revertir ni vencer.
-- Ahora la reserva es una entidad propia: el stock físico NO se toca; lo que
-- baja es el stock DISPONIBLE (= stock − reservas activas).

CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id     UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','fulfilled','cancelled','expired')),
  expires_at     TIMESTAMPTZ,
  notes          TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stock_res_org     ON public.stock_reservations(org_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_res_product ON public.stock_reservations(product_id, status);

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read stock_reservations" ON public.stock_reservations;
CREATE POLICY "org read stock_reservations" ON public.stock_reservations FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "admin write stock_reservations" ON public.stock_reservations;
CREATE POLICY "admin write stock_reservations" ON public.stock_reservations FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- ── Stock disponible por producto (stock físico − reservas activas) ─────────
CREATE OR REPLACE VIEW public.product_availability
WITH (security_invoker = true) AS
SELECT
  p.id                                            AS product_id,
  p.org_id                                        AS org_id,
  p.name                                          AS product_name,
  p.stock                                         AS stock_total,
  COALESCE(r.reserved, 0)::int                    AS reserved,
  (p.stock - COALESCE(r.reserved, 0))::int        AS available
FROM public.products p
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS reserved
  FROM public.stock_reservations
  WHERE status = 'active'
  GROUP BY product_id
) r ON r.product_id = p.id;

GRANT SELECT ON public.product_availability TO authenticated;

-- ── Crear reserva (valida disponible, no toca el stock físico) ──────────────
CREATE OR REPLACE FUNCTION public.create_stock_reservation(
  p_org_id         UUID,
  p_product_id     UUID,
  p_quantity       INTEGER,
  p_customer_name  TEXT,
  p_customer_phone TEXT DEFAULT NULL,
  p_expires_at     TIMESTAMPTZ DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_variant_id     UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock     INTEGER;
  v_reserved  INTEGER;
  v_available INTEGER;
  v_id        UUID;
BEGIN
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  SELECT stock INTO v_stock FROM public.products WHERE id = p_product_id AND org_id = p_org_id;
  IF v_stock IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
  FROM public.stock_reservations
  WHERE product_id = p_product_id AND status = 'active';

  v_available := v_stock - v_reserved;
  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'Stock insuficiente: hay % disponible(s) (stock %, reservado %)',
      v_available, v_stock, v_reserved;
  END IF;

  INSERT INTO public.stock_reservations (
    org_id, product_id, variant_id, customer_name, customer_phone,
    quantity, expires_at, notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_customer_name, p_customer_phone,
    p_quantity, p_expires_at, p_notes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Cerrar reserva: cancelada o cumplida (al concretarse la venta) ──────────
CREATE OR REPLACE FUNCTION public.resolve_stock_reservation(
  p_reservation_id UUID,
  p_status         TEXT  -- 'fulfilled' | 'cancelled'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  IF p_status NOT IN ('fulfilled','cancelled') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;
  SELECT org_id INTO v_org FROM public.stock_reservations WHERE id = p_reservation_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Reserva no encontrada'; END IF;
  IF NOT public.has_org_role(v_org, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  UPDATE public.stock_reservations
     SET status = p_status, resolved_at = now()
   WHERE id = p_reservation_id AND status = 'active';
END;
$$;

-- ── Vencer automáticamente las que pasaron su fecha ─────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stock_reservations(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.stock_reservations
     SET status = 'expired', resolved_at = now()
   WHERE org_id = p_org_id
     AND status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_stock_reservation(UUID, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stock_reservation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stock_reservations(UUID) TO authenticated;
