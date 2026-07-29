-- Al sumarle el parámetro del cupón, `create_store_order` quedó con dos
-- firmas: la vieja de 8 argumentos y la nueva de 9 (el cupón tiene DEFAULT).
--
-- Eso rompe PostgREST: al llamarla sin `p_coupon`, las dos candidatas encajan
-- y devuelve "Could not choose the best candidate function". O sea, todo el
-- checkout dejaría de funcionar.
--
-- Se elimina la vieja. Idempotente.

DROP FUNCTION IF EXISTS public.create_store_order(text, jsonb, text, text, text, jsonb, text, text);
