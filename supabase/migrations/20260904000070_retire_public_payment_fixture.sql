-- D5.26 / higiene del escaparate productivo.
--
-- Este producto fue creado para una prueba de pago en julio y permaneció
-- público con el nombre literal "ZZ NO COMPRAR". Tiene stock 0. Se conserva la
-- fila inactiva para que los dos pedidos históricos mantengan su referencia;
-- no se borra ni se corrige stock.

BEGIN;

UPDATE public.products
SET is_active = false,
    featured = false,
    updated_at = now()
WHERE id = '6dbb156f-af5a-42e7-99a3-f21eca065a8d'::uuid
  AND name = 'ZZ NO COMPRAR - Prueba de pago'
  AND stock = 0
  AND is_active;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE id = '6dbb156f-af5a-42e7-99a3-f21eca065a8d'::uuid
      AND name = 'ZZ NO COMPRAR - Prueba de pago'
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Verificación falló: el fixture de pago sigue público';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000070', 'retire_public_payment_fixture')
ON CONFLICT DO NOTHING;

COMMIT;
