-- Tienda nueva cotiza por provincia (zonas), no flat $0 disfrazado de nacional.
-- Tiendanube: el comercio tipa precio por provincia. Nuestro schema ya agrupa
-- provincias en zonas; el default 'flat' hacía que las 6 zonas sembradas no
-- se usaran hasta que alguien cambiaba el modo a mano.
-- No se tocan tiendas existentes (Exentry sigue con lo que eligió).

ALTER TABLE public.ecommerce_stores
  ALTER COLUMN shipping_mode SET DEFAULT 'zones';

DO $$
BEGIN
  IF (
    SELECT column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ecommerce_stores'
       AND column_name = 'shipping_mode'
  ) IS DISTINCT FROM '''zones''::text' THEN
    RAISE EXCEPTION 'shipping_mode default no quedó en zones';
  END IF;
END $$;
