-- ============================================================
-- FUNCIONES Y TRIGGERS — aplicar DESPUES de missing_migrations.sql
-- ============================================================

-- == auto_loyalty_trigger ==
CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_enabled         boolean;
  v_points_per_1000 integer;
  v_points          integer;
BEGIN
  IF NEW.customer_name IS NULL OR trim(NEW.customer_name) = '' THEN RETURN NEW; END IF;
  SELECT COALESCE(loyalty_enabled, false), COALESCE(loyalty_points_per_1000, 1)
  INTO v_enabled, v_points_per_1000
  FROM public.settings WHERE org_id = NEW.org_id;
  IF NOT FOUND OR NOT v_enabled THEN RETURN NEW; END IF;
  v_points := floor(COALESCE(NEW.total_ars, 0) / 1000.0)::integer * v_points_per_1000;
  IF v_points >= 1 THEN
    INSERT INTO public.loyalty_points (org_id, customer_name, delta, reason, reference_id)
    VALUES (NEW.org_id, trim(NEW.customer_name), v_points, 'sale', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_loyalty_on_sale();

CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF OLD.customer_name IS NULL OR trim(OLD.customer_name) = '' THEN RETURN OLD; END IF;
  SELECT COALESCE(loyalty_enabled, false) INTO v_enabled
  FROM public.settings WHERE org_id = OLD.org_id;
  IF FOUND AND v_enabled THEN
    DELETE FROM public.loyalty_points
    WHERE org_id = OLD.org_id AND reference_id = OLD.id AND reason = 'sale';
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale_delete ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale_delete
  AFTER DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_loyalty_on_sale_delete();

-- == seed_default_alert_rules ==
CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',         5,     0),
    (p_org_id, 'low_margin',        15,    0),
    (p_org_id, 'debt_overdue',      0,     7),
    (p_org_id, 'customer_inactive', 0,     60),
    (p_org_id, 'high_expense',      50000, 0)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$$;

-- Seed rules for all existing orgs
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_alert_rules(r.id);
  END LOOP;
END;
$$;
