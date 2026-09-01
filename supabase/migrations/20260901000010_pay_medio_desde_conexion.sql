-- ═══════════════════════════════════════════════════════════════════════════
-- Quien ya tenía OAuth de Mercado Pago no siempre tenía el medio habilitado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `mp-connect` guardaba el token en `payment_connections` y encendía
-- `settings.mp_enabled`. El tarifario (`costos_por_medio_de_pago`) y el ruteo
-- leen `org_payment_providers`. Quien conectó entre la migración
-- `20260820000020` y el arreglo de `mp-connect` quedaba con Pay "activo" y
-- Ajustes → Finanzas vacío.
--
-- Idempotente: sólo inserta la fila que falta. No pisa un comercio que dejó
-- el medio deshabilitado a propósito.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.org_payment_providers (org_id, provider, cuenta, conectado_at, habilitado)
SELECT
  pc.org_id,
  'mercadopago',
  NULLIF(btrim(COALESCE(pc.nickname, pc.email, '')), ''),
  COALESCE(pc.connected_at, pc.updated_at, now()),
  true
FROM public.payment_connections pc
WHERE pc.provider = 'mercadopago'
ON CONFLICT (org_id, provider) DO NOTHING;

UPDATE public.settings s
   SET mp_enabled = true
  FROM public.payment_connections pc
 WHERE pc.org_id = s.org_id
   AND pc.provider = 'mercadopago'
   AND s.mp_enabled IS DISTINCT FROM true;

DO $$
DECLARE
  v_sin_medio int;
BEGIN
  SELECT count(*) INTO v_sin_medio
    FROM public.payment_connections pc
    LEFT JOIN public.org_payment_providers o
      ON o.org_id = pc.org_id AND o.provider = 'mercadopago'
   WHERE pc.provider = 'mercadopago'
     AND o.org_id IS NULL;

  IF v_sin_medio <> 0 THEN
    RAISE EXCEPTION 'quedaron % conexiones MP sin fila en org_payment_providers', v_sin_medio;
  END IF;
END $$;
