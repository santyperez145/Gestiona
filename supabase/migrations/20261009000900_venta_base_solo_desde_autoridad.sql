-- La venta base no se llama desde el navegador.
--
-- `create_sales_transaction` (v1) inserta el precio, total y ganancia que
-- recibe: la autoridad de precios vive en v2/v3, que los recalculan con
-- `precio_pos_autoritativo` y después la llaman. Con EXECUTE para
-- `authenticated`, cualquier miembro con permiso de venta podía llamar v1
-- directo y registrar un producto de $90.000 a $1 con margen inventado.
-- v2/v3 son SECURITY DEFINER: siguen invocándola como su dueño, y v1 conserva
-- sus propias guardas de membresía con auth.uid() del usuario real.

REVOKE EXECUTE ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) TO service_role;
