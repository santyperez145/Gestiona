-- Fix triggers that incorrectly referenced m.created_at on memberships.
-- The memberships table uses joined_at, not created_at.

CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id  UUID;
  v_session UUID;
BEGIN
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo','transferencia','debito','credito','mayorista') THEN
    RETURN NEW;
  END IF;
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = v_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method,'efectivo'), NEW.total_ars, 'sale', NEW.id, 'Venta ' || COALESCE(NEW.payment_method,'') || ': ' || NEW.product_name, NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
    p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'sale', p_quantity=>-NEW.quantity,
    p_reference_type=>'sale', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
    p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
    p_product_name=>NEW.product_name, p_variant_name=>NULL,
    p_movement_type=>'purchase', p_quantity=>NEW.quantity,
    p_reference_type=>'purchase', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;
