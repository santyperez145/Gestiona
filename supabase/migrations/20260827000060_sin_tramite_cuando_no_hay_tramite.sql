-- No se pide un trámite que no existe
--
-- ── Qué pasaba ────────────────────────────────────────────────────────────
--
-- `motivo` sólo distinguía entre «falta delegar» y «listo». Con el comercio en
-- modo delegado y sin verificar, el panel muestra tres pasos que empiezan en
-- «entrá al Administrador de Relaciones de ARCA y delegá wsfe a este CUIT».
--
-- ⚠️ Pero si el CUIT del comercio ES el de la plataforma, ese trámite no
-- existe: el certificado ya pertenece a ese CUIT y ARCA acepta la llamada sin
-- ninguna delegación. Se le estaba pidiendo al comercio que se delegara un
-- servicio a sí mismo — y como el trámite no se puede hacer, la pantalla se
-- quedaba pidiéndolo para siempre.
--
-- Es exactamente el caso de la organización que opera hoy: CUIT 20446484436 en
-- las dos puntas.
--
-- ── Qué NO cambia ─────────────────────────────────────────────────────────
--
-- 📌 **Se sigue preguntando a ARCA.** El motivo nuevo dice «no hay trámite que
-- hacer», no «ya está conectado»: `delegacion_verificada` se marca únicamente
-- cuando `FECompUltimoAutorizado` responde. CLAUDE.md: «La verificación le
-- pregunta al organismo, no al usuario. Un checkbox de "ya lo hice" hace que
-- el panel diga listo y la primera factura falle.»

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
    -- ⚠️ Antes que `falta_delegar`: si el CUIT es el mismo, no hay trámite.
    -- Se comparan sólo los dígitos porque uno puede venir con guiones.
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
  a.delegacion_verificada_at
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado de la conexión fiscal de un comercio, sin exponer certificados. '
  '`motivo` dice qué falta: falta_datos_fiscales, falta_plataforma, '
  'sin_delegacion_necesaria (el CUIT es el de la plataforma: no hay trámite, '
  'sólo confirmar contra ARCA), falta_delegar, o listo.';

GRANT SELECT ON public.afip_connection_status TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_user   uuid;
  v_org    uuid;
  v_motivo text;
  v_cuit   text;
  v_plat   text;
BEGIN
  SELECT m.user_id, m.org_id INTO v_user, v_org
    FROM public.memberships m
    JOIN public.afip_credentials a ON a.org_id = m.org_id
   WHERE m.role IN ('owner','admin') LIMIT 1;

  SELECT a.cuit INTO v_cuit FROM public.afip_credentials a WHERE a.org_id = v_org;
  SELECT p.cuit INTO v_plat FROM public.afip_platform_credentials p
   WHERE p.certificate IS NOT NULL LIMIT 1;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT motivo INTO v_motivo FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;

  -- ── a. Con el mismo CUIT, no se pide el trámite ─────────────────────────
  IF v_cuit = v_plat THEN
    ASSERT v_motivo = 'sin_delegacion_necesaria',
      'con el mismo CUIT el motivo deberia ser sin_delegacion_necesaria y es ' || v_motivo;
  END IF;

  -- ── b. ⚠️ Y con OTRO CUIT se sigue pidiendo ─────────────────────────────
  -- Sin esta mitad, una vista que devolviera siempre `sin_delegacion_necesaria`
  -- pasaria el punto (a) igual, y ningun comercio real veria los pasos.
  UPDATE public.afip_credentials SET cuit = '30500001735' WHERE org_id = v_org;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT motivo INTO v_motivo FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;

  -- Se restaura ANTES del ASSERT: si falla, el CUIT real ya volvió a su lugar.
  UPDATE public.afip_credentials SET cuit = v_cuit WHERE org_id = v_org;

  ASSERT v_motivo = 'falta_delegar',
    'con otro CUIT deberia pedir la delegacion y dice ' || v_motivo;

  -- ── c. El CUIT real quedó como estaba ───────────────────────────────────
  SELECT a.cuit INTO v_motivo FROM public.afip_credentials a WHERE a.org_id = v_org;
  ASSERT v_motivo = v_cuit, 'el CUIT real no volvio a su valor';

  RAISE NOTICE 'OK: mismo CUIT sin tramite, otro CUIT con tramite, CUIT real intacto';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000060', 'sin_tramite_cuando_no_hay_tramite')
ON CONFLICT DO NOTHING;
