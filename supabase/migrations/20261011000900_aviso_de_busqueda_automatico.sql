-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: el «avisame si lo consiguen» sale solo al vincular el término
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261011000800 guarda los emails de quien buscó algo sin resultados, pero
-- el aviso lo tenía que mandar el comercio a mano. Cuando el comercio vincula
-- ese término a un producto (sinónimo, 20261011000600) ya sabemos qué
-- producto era: los pedidos pasan a `store_stock_alerts` de ese producto y el
-- envío existente (`notify-back-in-stock`, cada 30 minutos, sólo con stock,
-- una sola vez) les escribe. Si el producto no tiene stock, esperan a que
-- vuelva, igual que cualquier aviso de stock.
--
--   · Disparador AFTER INSERT en `store_search_synonyms`: mueve los pedidos
--     del mismo comercio y término a `store_stock_alerts` (sin duplicar un
--     email que ya esperaba ese producto) y los borra de la lista.
--
-- Idempotente. Reversible: DROP TRIGGER, DROP FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._avisos_de_busqueda_a_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_stock_alerts (org_id, store_id, product_id, variant_id, email)
  SELECT a.org_id, a.store_id, NEW.product_id, NULL, a.email
  FROM public.store_avisos_de_busqueda a
  JOIN public.products p ON p.id = NEW.product_id AND p.org_id = a.org_id
  WHERE a.org_id = NEW.org_id AND a.termino = NEW.termino AND a.retener_hasta > now()
  ON CONFLICT (product_id, variant_id, email) DO NOTHING;

  DELETE FROM public.store_avisos_de_busqueda a
  WHERE a.org_id = NEW.org_id AND a.termino = NEW.termino
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.org_id = a.org_id);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._avisos_de_busqueda_a_stock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS avisos_de_busqueda_a_stock ON public.store_search_synonyms;
CREATE TRIGGER avisos_de_busqueda_a_stock
  AFTER INSERT ON public.store_search_synonyms
  FOR EACH ROW EXECUTE FUNCTION public._avisos_de_busqueda_a_stock();

COMMENT ON FUNCTION public._avisos_de_busqueda_a_stock() IS
  'Al vincular un término de búsqueda a un producto, los clientes que pidieron aviso por ese término pasan a esperar ese producto (store_stock_alerts).';

COMMIT;
