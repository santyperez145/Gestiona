-- Auto-award loyalty points when a sale is created
-- Only fires when: loyalty_enabled = true, customer_name is not blank,
--                  and the calculated points >= 1

CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled         boolean;
  v_points_per_1000 integer;
  v_points          integer;
BEGIN
  -- Skip if no customer name
  IF NEW.customer_name IS NULL OR trim(NEW.customer_name) = '' THEN
    RETURN NEW;
  END IF;

  -- Get loyalty config for this org
  SELECT
    COALESCE(loyalty_enabled, false),
    COALESCE(loyalty_points_per_1000, 1)
  INTO v_enabled, v_points_per_1000
  FROM public.settings
  WHERE org_id = NEW.org_id;

  -- Skip if loyalty not enabled or no settings row
  IF NOT FOUND OR NOT v_enabled THEN
    RETURN NEW;
  END IF;

  -- Calculate points: floor(total_ars / 1000) * points_per_1000
  -- Use COALESCE so NULL total_ars = 0 points
  v_points := floor(COALESCE(NEW.total_ars, 0) / 1000.0)::integer * v_points_per_1000;

  IF v_points >= 1 THEN
    INSERT INTO public.loyalty_points (
      org_id, customer_name, delta, reason, reference_id
    ) VALUES (
      NEW.org_id,
      trim(NEW.customer_name),
      v_points,
      'sale',
      NEW.id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sale due to loyalty errors
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_loyalty_on_sale();

-- Also auto-deduct when a sale is deleted (refund/reversal)
CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF OLD.customer_name IS NULL OR trim(OLD.customer_name) = '' THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(loyalty_enabled, false) INTO v_enabled
  FROM public.settings WHERE org_id = OLD.org_id;

  -- Reverse the award by deleting the loyalty_points row for this sale
  IF FOUND AND v_enabled THEN
    DELETE FROM public.loyalty_points
    WHERE org_id = OLD.org_id
      AND reference_id = OLD.id
      AND reason = 'sale';
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale_delete ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale_delete
  AFTER DELETE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_loyalty_on_sale_delete();
