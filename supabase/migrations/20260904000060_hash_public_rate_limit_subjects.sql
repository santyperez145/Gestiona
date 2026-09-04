-- Privacidad del límite antiabuso público.
--
-- `rate_limit_publico` usaba la IP como clave de una ventana de una hora. La
-- tabla era privada y efímera, pero conservar el identificador en claro no es
-- necesario para contar. Se mantiene exactamente el mismo límite por origen y
-- se persiste sólo SHA-256. La IP no se devuelve ni se une con visitas.

BEGIN;

CREATE OR REPLACE FUNCTION public.rate_limit_publico(
  p_bucket   text,
  p_fallback text,
  p_max      int,
  p_ventana  interval DEFAULT interval '1 minute'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject text;
BEGIN
  v_subject := public.ip_del_request();
  IF v_subject IS NULL THEN
    v_subject := 'tienda:' || COALESCE(p_fallback, '?');
  ELSE
    v_subject := 'ip_sha256:' || encode(
      extensions.digest(convert_to(v_subject, 'UTF8'), 'sha256'::text),
      'hex'
    );
  END IF;

  RETURN public.rate_limit_consumir(
    p_bucket,
    v_subject,
    p_max,
    p_ventana
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_publico(text, text, int, interval)
  FROM PUBLIC, anon, authenticated;

-- Son contadores técnicos de una hora, no registros del negocio. Se eliminan
-- las claves legacy para no esperar a la poda aleatoria y dejar IPs en claro.
DELETE FROM public.rate_limits
WHERE clave NOT LIKE '%:ip_sha256:%'
  AND clave NOT LIKE '%:tienda:%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rate_limits
    WHERE clave NOT LIKE '%:ip_sha256:%'
      AND clave NOT LIKE '%:tienda:%'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: quedan sujetos públicos sin hash';
  END IF;
  IF position(
    'extensions.digest' IN pg_get_functiondef(
      'public.rate_limit_publico(text,text,integer,interval)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Verificación falló: el rate limit no hashea el sujeto';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000060', 'hash_public_rate_limit_subjects')
ON CONFLICT DO NOTHING;

COMMIT;
