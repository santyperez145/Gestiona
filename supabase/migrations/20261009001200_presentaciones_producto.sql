-- Presentaciones de producto (caja, bulto, pack).
--
-- Un almacén recibe y a veces vende por caja: la caja tiene su propio código
-- de barras y equivale a N unidades. Escanear ese código en la caja suma N
-- unidades del producto; el stock y el precio siguen siendo por unidad, así
-- la autoridad de precios (create_sales_transaction_v2) no cambia.

CREATE TABLE IF NOT EXISTS public.product_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  factor numeric(14,3) NOT NULL CHECK (factor > 0),
  barcode text CHECK (barcode IS NULL OR length(btrim(barcode)) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_presentations_product_idx ON public.product_presentations(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_presentations_org_barcode_key
  ON public.product_presentations(org_id, barcode) WHERE barcode IS NOT NULL;

COMMENT ON TABLE public.product_presentations IS
  'Caja/bulto/pack de un producto: código propio y cantidad de unidades (factor). El stock sigue en unidades.';

-- El producto debe ser de la misma organización; los que se venden por unidad
-- sólo admiten presentaciones de unidades enteras.
CREATE OR REPLACE FUNCTION public.trg_product_presentations_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unidad text;
BEGIN
  SELECT COALESCE(p.unidad_medida, 'unidad') INTO v_unidad
  FROM public.products p
  WHERE p.id = NEW.product_id AND p.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no pertenece a esta organización' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_unidad = 'unidad' AND NEW.factor <> trunc(NEW.factor) THEN
    RAISE EXCEPTION 'Un producto que se vende por unidad necesita una presentación de unidades enteras' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.barcode := NULLIF(btrim(COALESCE(NEW.barcode, '')), '');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_product_presentations_validar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_product_presentations_validar ON public.product_presentations;
CREATE TRIGGER trg_product_presentations_validar
  BEFORE INSERT OR UPDATE ON public.product_presentations
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_presentations_validar();

ALTER TABLE public.product_presentations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read product presentations" ON public.product_presentations;
CREATE POLICY "Org members read product presentations" ON public.product_presentations
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'view'));

DROP POLICY IF EXISTS "Org editors insert product presentations" ON public.product_presentations;
CREATE POLICY "Org editors insert product presentations" ON public.product_presentations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

DROP POLICY IF EXISTS "Org editors update product presentations" ON public.product_presentations;
CREATE POLICY "Org editors update product presentations" ON public.product_presentations
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'))
  WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

DROP POLICY IF EXISTS "Org editors delete product presentations" ON public.product_presentations;
CREATE POLICY "Org editors delete product presentations" ON public.product_presentations
  FOR DELETE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

REVOKE ALL ON public.product_presentations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_presentations TO authenticated;
GRANT ALL ON public.product_presentations TO service_role;
