-- La tienda no nace adivinada
--
-- Commerce sembraba en el formulario «Mi Tienda Online», el dorado de Exentry,
-- envío $2.500 y envío gratis desde $50.000. La tabla tenía los mismos vicios
-- en los DEFAULT: name = 'Mi Tienda', primary_color = '#f59e0b',
-- payment_methods = {mercadopago, transferencia}.
--
-- Un INSERT que no manda esas columnas —o un Guardar del formulario viejo—
-- publicaba una vitrina que nadie eligió. Misma familia que
-- `industry_code = perfumes` y `category = perfume_arabe`.
--
-- ⚠️ No se tocan las filas existentes. El oro de un comercio que ya opera
-- puede ser su marca. El default nuevo sólo vale para lo que todavía no nació.

ALTER TABLE public.ecommerce_stores
  ALTER COLUMN primary_color SET DEFAULT '#6E4DEE';

ALTER TABLE public.ecommerce_stores
  ALTER COLUMN name SET DEFAULT '';

ALTER TABLE public.ecommerce_stores
  ALTER COLUMN payment_methods SET DEFAULT ARRAY['transferencia']::text[];

COMMENT ON COLUMN public.ecommerce_stores.primary_color IS
  'Color de la vitrina. El default es el violeta del workspace, no el ámbar de Exentry. Un comercio puede poner el suyo; no se backfillea.';

COMMENT ON COLUMN public.ecommerce_stores.name IS
  'Nombre de la vitrina. Vacío significa que todavía no lo eligió; no se siembra «Mi Tienda».';

COMMENT ON COLUMN public.ecommerce_stores.payment_methods IS
  'Medios que ofrece el checkout. El default es transferencia: Mercado Pago se suma cuando el comercio lo conecta, no antes.';

DO $verif$
DECLARE
  v_color text;
  v_name  text;
  v_pay   text;
BEGIN
  SELECT column_default INTO v_color
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ecommerce_stores'
     AND column_name = 'primary_color';
  IF v_color IS NULL OR v_color NOT LIKE '%#6E4DEE%' THEN
    RAISE EXCEPTION 'primary_color default no es el violeta del workspace: %', v_color;
  END IF;

  SELECT column_default INTO v_name
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ecommerce_stores'
     AND column_name = 'name';
  IF v_name IS NULL OR v_name LIKE '%Mi Tienda%' THEN
    RAISE EXCEPTION 'name default sigue sembrando Mi Tienda: %', v_name;
  END IF;

  SELECT column_default INTO v_pay
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ecommerce_stores'
     AND column_name = 'payment_methods';
  IF v_pay IS NULL OR v_pay LIKE '%mercadopago%' THEN
    RAISE EXCEPTION 'payment_methods default sigue ofreciendo Mercado Pago: %', v_pay;
  END IF;
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901000060', 'la_tienda_no_nace_adivinada')
ON CONFLICT DO NOTHING;

