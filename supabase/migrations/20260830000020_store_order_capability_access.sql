-- Acceso preautenticado a pedidos de tienda.
--
-- Antes, `get_store_order(slug, numero)` devolvia nombre, email y domicilio a
-- anon. Los numeros son correlativos, por lo que no eran una credencial. El
-- pedido ahora lleva una capacidad opaca; una sesion autenticada del comprador
-- o la combinacion numero + email permiten recuperar esa capacidad.

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS public_access_token uuid;

UPDATE public.ecommerce_orders
   SET public_access_token = gen_random_uuid()
 WHERE public_access_token IS NULL;

ALTER TABLE public.ecommerce_orders
  ALTER COLUMN public_access_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_access_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_orders_public_access_token_key
  ON public.ecommerce_orders(public_access_token);

COMMENT ON COLUMN public.ecommerce_orders.public_access_token IS
  'Capacidad opaca para ver y operar exclusivamente este pedido. Nunca se usa el numero correlativo como autorizacion.';

-- El contrato inseguro deja de existir. La pagina nueva usa un nombre distinto
-- para poder desplegarse primero y tolerar la ventana de migracion sin mezclar
-- sobrecargas de PostgREST.
REVOKE ALL ON FUNCTION public.get_store_order(text, text)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.get_store_order(text, text);

CREATE OR REPLACE FUNCTION public.get_store_order_secure(
  p_slug text,
  p_order_number text,
  p_access_token text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  order_number text,
  customer_name text,
  customer_email text,
  items jsonb,
  subtotal numeric,
  shipping_cost numeric,
  total numeric,
  payment_method text,
  payment_status text,
  fulfillment_status text,
  shipping_address jsonb,
  created_at timestamptz,
  access_token text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  -- Numero + email es la recuperacion de enlaces historicos. Se limita porque
  -- ambos datos pueden probarse; el token y la sesion no consumen ese cupo.
  IF v_email <> '' AND NOT public.rate_limit_publico(
    'store_order_access',
    lower(COALESCE(p_slug, '?')) || ':' || COALESCE(p_order_number, '?'),
    8,
    interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.order_number,
    o.customer_name,
    o.customer_email,
    o.items,
    o.subtotal,
    o.shipping_cost,
    o.total,
    o.payment_method,
    o.payment_status,
    o.fulfillment_status,
    o.shipping_address,
    o.created_at,
    o.public_access_token::text
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND (
      (
        btrim(COALESCE(p_access_token, '')) <> ''
        AND o.public_access_token::text = btrim(p_access_token)
      )
      OR EXISTS (
        SELECT 1
          FROM public.store_customers sc
         WHERE sc.id = o.store_customer_id
           AND sc.user_id = auth.uid()
      )
      OR (
        v_email <> ''
        AND lower(btrim(o.customer_email)) = v_email
      )
    )
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.get_store_order_secure(text, text, text, text) IS
  'Detalle de un pedido: exige capacidad opaca, cuenta compradora o numero + email limitado para recuperacion.';

REVOKE ALL ON FUNCTION public.get_store_order_secure(text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_order_secure(text, text, text, text)
  TO anon, authenticated;

-- Puerta autocontenida: no imprime PII ni toca pedidos reales.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ecommerce_orders WHERE public_access_token IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay pedidos sin capacidad publica';
  END IF;

  IF to_regprocedure('public.get_store_order(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'El RPC inseguro get_store_order(text,text) sigue disponible';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.get_store_order_secure(text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon no puede usar el RPC seguro';
  END IF;
END;
$verify$;
