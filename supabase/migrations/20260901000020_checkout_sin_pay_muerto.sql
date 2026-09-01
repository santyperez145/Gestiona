-- ═══════════════════════════════════════════════════════════════════════════
-- El checkout no ofrece un cobro que no puede ejecutar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Activar Gestiona Pay y marcar Mercado Pago en la tienda son dos interruptores
-- distintos. El default de la tienda trae los dos medios, y con transferencia
-- el readiness no bloquea. El comprador ve Mercado Pago, confirma, y store-pay
-- muere porque no hay token. Desde afuera parece que la plataforma no cobra.
--
-- Autoridad en el servidor:
--   1. `get_store_by_slug` sólo lista medios que se pueden cobrar.
--   2. Un INSERT con `mercadopago` sin rail vivo no entra a `ecommerce_orders`.
-- Stripe y PayPal no tienen adapter de venta: se ocultan aunque hayan quedado
-- en un array viejo. No se toca el interruptor del comercio: al conectar Pay
-- el medio vuelve solo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gestiona_pay_listo(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.org_payment_providers o
     WHERE o.org_id = p_org_id
       AND o.provider = 'mercadopago'
       AND o.habilitado
       AND o.conectado_at IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.payment_connections c
          WHERE c.org_id = o.org_id
            AND c.provider = 'mercadopago'
            AND c.access_token IS NOT NULL
       )
  );
$$;

COMMENT ON FUNCTION public.gestiona_pay_listo(uuid) IS
  '¿Esta organización puede cobrar con Gestiona Pay? Token OAuth + medio habilitado. No expone secretos. Revocada de anon/authenticated: la llama get_store_by_slug y el trigger de la orden.';

CREATE OR REPLACE FUNCTION public.medios_de_pago_vivos(p_org_id uuid, p_methods text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT m
        FROM unnest(COALESCE(p_methods, ARRAY[]::text[])) AS m
       WHERE m IS NOT NULL
         AND btrim(m) <> ''
         AND m NOT IN ('stripe', 'paypal')
         AND (m <> 'mercadopago' OR public.gestiona_pay_listo(p_org_id))
    ),
    ARRAY[]::text[]
  );
$$;

COMMENT ON FUNCTION public.medios_de_pago_vivos(uuid, text[]) IS
  'Medios que el checkout puede ofrecer de verdad. Saca rails sin adapter y Mercado Pago si Gestiona Pay no está listo.';

REVOKE ALL ON FUNCTION public.gestiona_pay_listo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.medios_de_pago_vivos(uuid, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
 RETURNS TABLE(org_id uuid, owner_user_id uuid, name text, description text, slug text, theme text, font text, primary_color text, logo_url text, banner_url text, currency text, payment_methods text[], payment_discounts jsonb, shipping_cost numeric, free_shipping_above numeric, shipping_mode text, pickup_enabled boolean, pickup_address text, meta_title text, meta_description text, social_links jsonb, meta_pixel_id text, ga_measurement_id text, tiktok_pixel_id text, nav_links jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.font, s.primary_color,
    s.logo_url, s.banner_url, s.currency,
    public.medios_de_pago_vivos(s.org_id, s.payment_methods),
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb)
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_ecommerce_order_exige_pay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.payment_method IN ('stripe', 'paypal') THEN
    RAISE EXCEPTION 'Ese medio de pago no está disponible en esta tienda';
  END IF;
  IF NEW.payment_method = 'mercadopago'
     AND NOT public.gestiona_pay_listo(NEW.org_id) THEN
    RAISE EXCEPTION 'Gestiona Pay no está activo. Elegí otro medio de pago.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_ecommerce_order_exige_pay() IS
  'Impide crear una orden online con un rail que la tienda no puede cobrar. No lee el interruptor del storefront: mira la conexión real.';

REVOKE ALL ON FUNCTION public.trg_ecommerce_order_exige_pay() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ecommerce_order_exige_pay ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_order_exige_pay
  BEFORE INSERT ON public.ecommerce_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ecommerce_order_exige_pay();
