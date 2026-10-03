-- La migración de cifrado 20260922 había protegido las filas existentes, pero
-- la Edge de plataforma todavía podía volver a escribir CRT/KEY en claro.
-- Re-cifra el legado actual y deja una defensa en profundidad en la base.

CREATE OR REPLACE FUNCTION public.afip_platform_encrypt_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.certificate IS NOT NULL AND NEW.certificate NOT LIKE 'nerqia:v1:%' THEN
    NEW.certificate := public.secret_encrypt(NEW.certificate);
  END IF;
  IF NEW.private_key IS NOT NULL AND NEW.private_key NOT LIKE 'nerqia:v1:%' THEN
    NEW.private_key := public.secret_encrypt(NEW.private_key);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_platform_encrypt_credentials()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_afip_platform_encrypt_credentials
  ON public.afip_platform_credentials;
CREATE TRIGGER trg_afip_platform_encrypt_credentials
BEFORE INSERT OR UPDATE OF certificate, private_key
ON public.afip_platform_credentials
FOR EACH ROW EXECUTE FUNCTION public.afip_platform_encrypt_credentials();

UPDATE public.afip_platform_credentials
SET certificate = public.secret_encrypt(certificate)
WHERE certificate IS NOT NULL AND certificate NOT LIKE 'nerqia:v1:%';

UPDATE public.afip_platform_credentials
SET private_key = public.secret_encrypt(private_key)
WHERE private_key IS NOT NULL AND private_key NOT LIKE 'nerqia:v1:%';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.afip_platform_credentials
    WHERE (certificate IS NOT NULL AND certificate NOT LIKE 'nerqia:v1:%')
       OR (private_key IS NOT NULL AND private_key NOT LIKE 'nerqia:v1:%')
  ) THEN
    RAISE EXCEPTION 'Quedaron credenciales fiscales de plataforma sin cifrar';
  END IF;
  IF has_function_privilege('authenticated', 'public.afip_platform_encrypt_credentials()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.afip_platform_encrypt_credentials()', 'EXECUTE') THEN
    RAISE EXCEPTION 'El guard de cifrado fiscal quedó expuesto a roles web';
  END IF;
END;
$guard$;
