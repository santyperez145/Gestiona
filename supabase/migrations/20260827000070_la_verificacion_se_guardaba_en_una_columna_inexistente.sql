-- La verificación decía «ok» y no guardaba nada
--
-- ── Qué pasaba ────────────────────────────────────────────────────────────
--
-- Verificado en el navegador con la sesión real, contra producción:
--
--     POST /functions/v1/afip-authorize {action: verificar_delegacion}
--     → 200 {"ok":true,"environment":"homologacion"}
--
-- ARCA aceptó de verdad: el TRA fue válido, el Ticket de Acceso se leyó y se
-- guardó, y `FECompUltimoAutorizado` respondió. Pero el panel seguía diciendo
-- «No tenés que hacer ningún trámite» después de recargar, y en la base
-- `delegacion_verificada` seguía en `false`.
--
-- ⚠️ La causa: `afip_marcar_delegacion` escribe `last_error`, y **esa columna
-- no existe** en `afip_credentials`. El UPDATE falla con 42703, y la Edge
-- Function hacía:
--
--     await supabase.rpc("afip_marcar_delegacion", {...});   // sin mirar .error
--
-- o sea que se tragaba el fallo y devolvía `ok: true`. Toda la cadena
-- funcionaba y el último paso —dejar constancia— fallaba en silencio.
--
-- 📌 Es exactamente la regla de CONTRIBUTING.md: «No tragarse errores». Un `rpc` sin
-- mirar `.error` convierte «no se guardó» en «listo».
--
-- ── Por qué se agrega la columna en vez de sacarla de la función ──────────
--
-- Porque el dato sirve: hoy `motivo` dice «falta_delegar» pero no **qué**
-- contestó ARCA, y ese texto se pierde al recargar. Guardarlo deja el motivo a
-- la vista aunque el comercio vuelva mañana.

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS last_error text;

COMMENT ON COLUMN public.afip_credentials.last_error IS
  'Lo que contestó ARCA la última vez que la verificación falló. Se limpia al '
  'verificar con éxito. Existe porque `afip_marcar_delegacion` la escribía sin '
  'que la columna existiera, y el error se tragaba: la función decía ok y no '
  'guardaba nada.';

-- La vista la expone para que el panel pueda mostrar el motivo después de
-- recargar, sin volver a llamar a ARCA.
CREATE OR REPLACE VIEW public.afip_connection_status AS
SELECT a.org_id,
  a.cuit,
  a.punto_venta,
  a.environment,
  a.tipo_emisor,
  a.razon_social,
  a.domicilio,
  a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND
    CASE a.modo
      WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
      ELSE (EXISTS (SELECT 1 FROM public.afip_platform_credentials p
                     WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL))
    END AS configured,
  (EXISTS (SELECT 1 FROM public.afip_platform_credentials p
            WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL)) AS plataforma_lista,
  (SELECT p.cuit FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_cuit,
  (SELECT p.razon_social FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_razon_social,
  CASE a.modo
    WHEN 'propio' THEN a.ta_expires_at
    ELSE (SELECT p.ta_expires_at FROM public.afip_platform_credentials p LIMIT 1)
  END AS ta_expires_at,
  CASE a.modo
    WHEN 'propio' THEN a.ta_expires_at IS NOT NULL AND a.ta_expires_at > now()
    ELSE (SELECT p.ta_expires_at > now() FROM public.afip_platform_credentials p LIMIT 1)
  END AS ticket_vigente,
  CASE
    WHEN a.cuit IS NULL OR btrim(a.cuit) = '' THEN 'falta_datos_fiscales'
    WHEN a.modo = 'propio' AND (a.certificate IS NULL OR a.private_key IS NULL)
      THEN 'falta_certificado_propio'
    WHEN a.modo <> 'propio' AND NOT (EXISTS (
           SELECT 1 FROM public.afip_platform_credentials p
            WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL))
      THEN 'falta_plataforma'
    WHEN a.modo <> 'propio'
     AND COALESCE(a.delegacion_verificada, false) = false
     AND regexp_replace(COALESCE(a.cuit, ''), '\D', '', 'g') =
         regexp_replace(COALESCE((SELECT p.cuit FROM public.afip_platform_credentials p
                                   WHERE p.certificate IS NOT NULL LIMIT 1), ''), '\D', '', 'g')
      THEN 'sin_delegacion_necesaria'
    WHEN a.modo <> 'propio' AND COALESCE(a.delegacion_verificada, false) = false
      THEN 'falta_delegar'
    ELSE 'listo'
  END AS motivo,
  a.delegacion_verificada,
  a.delegacion_verificada_at,
  a.last_error
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

GRANT SELECT ON public.afip_connection_status TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — que la función escriba de verdad
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org    uuid;
  v_antes  boolean;
  v_ok     boolean;
  v_fallo  boolean;
  v_error  text;
BEGIN
  SELECT org_id, delegacion_verificada INTO v_org, v_antes
    FROM public.afip_credentials LIMIT 1;

  -- ── a. Marcar OK escribe ────────────────────────────────────────────────
  PERFORM public.afip_marcar_delegacion(v_org, true, NULL);
  SELECT delegacion_verificada INTO v_ok FROM public.afip_credentials WHERE org_id = v_org;
  ASSERT v_ok, 'afip_marcar_delegacion(true) no dejo delegacion_verificada en true';

  -- ── b. Marcar fallo guarda el motivo ────────────────────────────────────
  PERFORM public.afip_marcar_delegacion(v_org, false, 'ZZ prueba de motivo');
  SELECT delegacion_verificada, last_error INTO v_fallo, v_error
    FROM public.afip_credentials WHERE org_id = v_org;
  ASSERT NOT v_fallo, 'marcar fallo no bajo la bandera';
  ASSERT v_error = 'ZZ prueba de motivo', 'no guardo el motivo: ' || COALESCE(v_error, 'NULL');

  -- ── c. Y verificar de nuevo lo limpia ───────────────────────────────────
  PERFORM public.afip_marcar_delegacion(v_org, true, NULL);
  SELECT last_error INTO v_error FROM public.afip_credentials WHERE org_id = v_org;
  ASSERT v_error IS NULL, 'el motivo viejo quedo pegado despues de verificar bien';

  -- ── d. Se deja como estaba antes de la migración ────────────────────────
  -- La verificación real la hace la Edge Function contra ARCA; esta migración
  -- no puede declarar conectado a nadie.
  PERFORM public.afip_marcar_delegacion(v_org, COALESCE(v_antes, false), NULL);

  RAISE NOTICE 'OK: la funcion escribe, guarda el motivo y lo limpia';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000070', 'la_verificacion_se_guardaba_en_una_columna_inexistente')
ON CONFLICT DO NOTHING;
