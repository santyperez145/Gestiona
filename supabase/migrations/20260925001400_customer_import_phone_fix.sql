-- Reparación del normalizador de teléfono argentino: "+54 9 11 5555-4444",
-- "01155554444" y "541155554444" deben caer en la misma forma canónica.
CREATE OR REPLACE FUNCTION public.customer_import_phone(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN RETURN NULL; END IF;
  v_digits := regexp_replace(p_value #>> '{}', '[^0-9]', '', 'g');
  IF v_digits = '' THEN RETURN NULL; END IF;
  v_digits := regexp_replace(v_digits, '^0054', '');
  v_digits := regexp_replace(v_digits, '^54', '');
  v_digits := regexp_replace(v_digits, '^9(?=[0-9]{10})', '');
  v_digits := regexp_replace(v_digits, '^0', '');
  IF length(v_digits) < 6 THEN RETURN NULL; END IF;
  RETURN right(v_digits, 15);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_import_phone(jsonb) FROM PUBLIC, anon, authenticated;
