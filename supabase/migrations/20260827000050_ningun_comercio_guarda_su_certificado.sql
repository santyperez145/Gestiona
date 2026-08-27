-- Todos los comercios facturan por delegación. Ninguno guarda un certificado.
--
-- ── La decisión ───────────────────────────────────────────────────────────
--
-- Decisión de producto del dueño, 2026-08-27: «todas las org deben funcionar
-- por igual, con delegación, no con el certificado propio».
--
-- Es lo que CLAUDE.md viene diciendo desde hace meses —«AFIP se conecta por
-- delegación, no subiendo certificados»— y lo que el 2026-08-27 se sacó del
-- formulario del comercio. Faltaba la base: el modo `propio` seguía existiendo
-- y una organización lo tenía puesto.
--
-- ── Qué había ─────────────────────────────────────────────────────────────
--
-- Una sola fila en `afip_credentials`, en `modo = 'propio'`, con su propio
-- certificado y su clave privada.
--
-- ⚠️ Antes de borrar se comparó contra `afip_platform_credentials`, porque
-- borrar una clave privada no se deshace. Medido: **es el mismo certificado y
-- la misma clave** —idéntica huella SHA-256 del DER, idéntica huella de la
-- clave pública derivada, mismo CUIT 20446484436, mismo ambiente
-- (homologación)—. O sea que la plataforma ya tiene una copia byte a byte y
-- este borrado no destruye nada.
--
-- ── Qué queda después ─────────────────────────────────────────────────────
--
-- `motivo` pasa de `listo` a `falta_delegar`, y **eso es correcto**: la
-- delegación nunca se hizo, se estaba facturando con el certificado propio. El
-- panel va a pedir delegar `wsfe` al CUIT de la plataforma.
--
-- 📌 En este caso el CUIT del comercio y el de la plataforma son el mismo, así
-- que el certificado ya pertenece a ese CUIT y no hace falta ningún trámite en
-- ARCA: alcanza con verificar.
--
-- ── Lo que este cambio cierra, dicho de frente ────────────────────────────
--
-- Un comercio grande que se niegue a delegar y quiera facturar con SU propio
-- certificado deja de ser posible sin revertir esto. Es la contrapartida de
-- que todas las organizaciones funcionen igual, y es la decisión tomada.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Sacar el certificado de las filas de comercio
-- ═══════════════════════════════════════════════════════════════════════════

-- El Ticket de Acceso también se limpia: era el de la fila del comercio, y en
-- modo delegado el TA es uno solo y vive en `afip_platform_credentials`. Dejar
-- el viejo haría que se reusara un ticket que no corresponde a ese certificado.
UPDATE public.afip_credentials
   SET certificate   = NULL,
       private_key   = NULL,
       ta_token      = NULL,
       ta_sign       = NULL,
       ta_expires_at = NULL,
       modo          = 'delegado'
 WHERE certificate IS NOT NULL
    OR private_key IS NOT NULL
    OR modo IS DISTINCT FROM 'delegado';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Que no pueda volver
-- ═══════════════════════════════════════════════════════════════════════════

-- Sin esto, alcanza una llamada a la Edge Function `afip-credentials` —que
-- sigue deployada y ya no la invoca ninguna pantalla— para reinstalar un
-- certificado por comercio y que las organizaciones dejen de funcionar igual.
ALTER TABLE public.afip_credentials
  DROP CONSTRAINT IF EXISTS afip_credentials_sin_certificado_propio;
ALTER TABLE public.afip_credentials
  ADD CONSTRAINT afip_credentials_sin_certificado_propio
  CHECK (certificate IS NULL AND private_key IS NULL);

COMMENT ON CONSTRAINT afip_credentials_sin_certificado_propio ON public.afip_credentials IS
  'El comercio no guarda certificados: factura por delegación con el de la '
  'plataforma. Decisión de producto del 2026-08-27.';

-- `delegado` ya era el default de la columna; se deja explícito para que un
-- INSERT que omita `modo` no pueda caer en un modo que ya no tiene certificado
-- del que tirar.
ALTER TABLE public.afip_credentials ALTER COLUMN modo SET DEFAULT 'delegado';

COMMENT ON COLUMN public.afip_credentials.modo IS
  'Siempre `delegado` desde 2026-08-27. La columna queda porque '
  '`resolverCredencialesAfip` la lee, pero `propio` ya no es alcanzable: la '
  'constraint impide guardar el certificado que ese modo necesitaría.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_con_cert int;
  v_propios  int;
  v_plat     int;
  v_freno    boolean;
BEGIN
  -- ── a. No quedó ningún certificado en filas de comercio ─────────────────
  SELECT count(*) INTO v_con_cert FROM public.afip_credentials
   WHERE certificate IS NOT NULL OR private_key IS NOT NULL;
  ASSERT v_con_cert = 0, 'quedaron ' || v_con_cert || ' comercios con certificado';

  SELECT count(*) INTO v_propios FROM public.afip_credentials
   WHERE modo IS DISTINCT FROM 'delegado';
  ASSERT v_propios = 0, 'quedaron ' || v_propios || ' comercios fuera de delegado';

  -- ── b. ⚠️ Y la plataforma SIGUE teniendo el suyo ────────────────────────
  -- Sin esta mitad, borrar el certificado de todos lados también dejaría la
  -- verificación en verde — y nadie podría facturar.
  SELECT count(*) INTO v_plat FROM public.afip_platform_credentials
   WHERE certificate IS NOT NULL AND private_key IS NOT NULL;
  ASSERT v_plat > 0,
    'la plataforma se quedo SIN certificado: nadie puede facturar';

  -- ── c. La constraint frena de verdad ────────────────────────────────────
  BEGIN
    UPDATE public.afip_credentials SET certificate = '-----BEGIN CERTIFICATE-----ZZ'
     WHERE org_id = (SELECT org_id FROM public.afip_credentials LIMIT 1);
    v_freno := false;
  EXCEPTION WHEN check_violation THEN
    v_freno := true;
  END;
  ASSERT v_freno, 'la constraint NO frena: se pudo volver a guardar un certificado';

  RAISE NOTICE 'OK: sin certificados de comercio, todos delegados, plataforma intacta, constraint activa';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000050', 'ningun_comercio_guarda_su_certificado')
ON CONFLICT DO NOTHING;
