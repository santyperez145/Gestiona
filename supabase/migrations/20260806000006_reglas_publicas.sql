-- Las reglas de cantidad, legibles desde la tienda.
--
-- Sin esto el carrito mostraría sólo el ahorro del 2x mientras el checkout cobra
-- el mejor de los dos, y el comprador vería un número distinto del que paga.
-- Es exactamente el bug que este repo viene evitando en cada cálculo de plata:
-- si el espejo del cliente no puede ver un dato, no es espejo.
--
-- Devuelve sólo las vigentes: una regla vencida no cambia ningún precio, y
-- mandarla igual obligaría al cliente a repetir el filtro de fechas.
--
-- Idempotente.
CREATE OR REPLACE FUNCTION public.get_store_quantity_discounts(p_slug text)
RETURNS TABLE (
  id uuid, name text, scope text, target text,
  min_qty int, discount_percent numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT q.id, q.name, q.scope, q.target, q.min_qty, q.discount_percent
  FROM public.quantity_discounts q
  JOIN public.ecommerce_stores s ON s.org_id = q.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND q.is_active
    AND (q.starts_at IS NULL OR q.starts_at <= now())
    AND (q.ends_at   IS NULL OR q.ends_at   >= now())
  ORDER BY q.min_qty, q.discount_percent DESC;
$$;

REVOKE ALL ON FUNCTION public.get_store_quantity_discounts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_quantity_discounts(text) TO anon, authenticated;
