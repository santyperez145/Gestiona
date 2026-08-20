-- C14b — el comercio ve QUÉ tiene que hacer en AFIP, y a qué CUIT delegar.
--
-- ── Qué falta hoy ────────────────────────────────────────────────────────
--
-- C14 dejó el modelo correcto: un certificado en la plataforma, ninguno en el
-- comercio, y el comercio delega `wsfe` al CUIT de la plataforma desde el
-- Administrador de Relaciones de ARCA.
--
-- Pero la vista que lee el comercio expone `plataforma_lista` como booleano y
-- **no dice a qué CUIT delegar**. Ese es exactamente el dato que hay que tipear
-- en ARCA. Sin él, la instrucción es "andá a delegar" sin decir a quién.
--
-- ── Por qué el CUIT de la plataforma se puede mostrar ────────────────────
--
-- Un CUIT no es un secreto: aparece en cada factura que emite la empresa y es
-- consultable en el padrón público de ARCA. Lo que nunca sale es el
-- certificado ni la clave privada, que siguen en `afip_platform_credentials`
-- con RLS y cero policies.
--
-- La distinción importa porque la tentación es tratar todo lo de AFIP como
-- secreto, y eso deja al comercio sin poder completar el trámite.
--
-- ── Por qué se informa el motivo y no sólo "no podés emitir" ─────────────
--
-- Hay tres razones distintas y **son de responsables distintos**:
--
--   falta_datos_fiscales  → lo carga el comercio, acá adentro.
--   falta_plataforma      → lo carga el dueño de la plataforma. El comercio no
--                           puede hacer nada, y decirle "configurá AFIP" sería
--                           mandarlo a un trámite que no existe.
--   falta_delegar         → lo hace el comercio, pero en el sitio de ARCA.
--   listo                 → puede emitir.
--
-- Un estado único obliga a la pantalla a adivinar de quién es el problema.
--
-- Idempotente.

-- La columna va ANTES de la vista que la lee.
ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS delegacion_verificada    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delegacion_verificada_at timestamptz;

COMMENT ON COLUMN public.afip_credentials.delegacion_verificada IS
  'Se marca cuando ARCA acepto una operacion con el CUIT del comercio usando el certificado de la plataforma. Decir "ya delegue" no alcanza: la unica prueba es que el organismo responda.';

DROP VIEW IF EXISTS public.afip_connection_status CASCADE;

CREATE VIEW public.afip_connection_status AS
SELECT
  a.org_id,
  a.cuit,
  a.punto_venta,
  a.environment,
  a.tipo_emisor,
  a.razon_social,
  a.domicilio,
  a.modo,
  (a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND
   CASE a.modo
     WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
     ELSE EXISTS (SELECT 1 FROM public.afip_platform_credentials p
                   WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL)
   END) AS configured,
  EXISTS (SELECT 1 FROM public.afip_platform_credentials p
           WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL) AS plataforma_lista,
  -- ⚠️ El CUIT de la plataforma, que es lo que el comercio tiene que tipear en
  -- el Administrador de Relaciones. NO es un secreto: figura en cada factura
  -- que emite la empresa. El certificado y la clave siguen inaccesibles.
  (SELECT p.cuit FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_cuit,
  (SELECT p.razon_social FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_razon_social,
  CASE a.modo
    WHEN 'propio' THEN a.ta_expires_at
    ELSE (SELECT p.ta_expires_at FROM public.afip_platform_credentials p LIMIT 1)
  END AS ta_expires_at,
  CASE a.modo
    WHEN 'propio' THEN (a.ta_expires_at IS NOT NULL AND a.ta_expires_at > now())
    ELSE (SELECT p.ta_expires_at > now() FROM public.afip_platform_credentials p LIMIT 1)
  END AS ticket_vigente,
  -- El motivo, para que la pantalla no tenga que adivinar de quién es el
  -- problema. El orden importa: sin datos fiscales no tiene sentido hablar de
  -- delegación.
  CASE
    WHEN a.cuit IS NULL OR btrim(a.cuit) = '' THEN 'falta_datos_fiscales'
    WHEN a.modo = 'propio' AND (a.certificate IS NULL OR a.private_key IS NULL)
      THEN 'falta_certificado_propio'
    WHEN a.modo <> 'propio' AND NOT EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
       WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL)
      THEN 'falta_plataforma'
    WHEN a.modo <> 'propio' AND COALESCE(a.delegacion_verificada, false) = false
      THEN 'falta_delegar'
    ELSE 'listo'
  END AS motivo,
  a.delegacion_verificada,
  a.delegacion_verificada_at
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado de AFIP para el comercio. Expone el CUIT de la plataforma —que no es secreto y hace falta para delegar— y el motivo por el que no puede emitir, que distingue lo que le toca al comercio de lo que le toca a la plataforma. Nunca expone certificado ni clave.';

GRANT SELECT ON public.afip_connection_status TO authenticated;

-- ── Marcar la delegación como verificada ─────────────────────────────────
--
-- No alcanza con que el comercio diga "ya delegué": la única prueba es que
-- ARCA acepte una emisión con su CUIT usando el certificado de la plataforma.
-- Esta función la marca **después** de que el circuito real haya funcionado, y
-- por eso la llama el backend, no la pantalla.
CREATE OR REPLACE FUNCTION public.afip_marcar_delegacion(
  p_org      uuid,
  p_ok       boolean,
  p_detalle  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Sólo el backend. Si la pantalla pudiera marcarla, un comercio podría
  -- decir que delegó sin haberlo hecho y el diagnóstico dejaría de servir.
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo el backend puede marcar el estado de la delegación';
  END IF;

  UPDATE public.afip_credentials
     SET delegacion_verificada    = p_ok,
         delegacion_verificada_at = CASE WHEN p_ok THEN now() ELSE NULL END,
         last_error               = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_detalle,''), 500) END
   WHERE org_id = p_org;
END;
$$;

REVOKE ALL ON FUNCTION public.afip_marcar_delegacion(uuid, boolean, text) FROM PUBLIC;

COMMENT ON FUNCTION public.afip_marcar_delegacion IS
  'Marca la delegacion como verificada. La llama el backend tras una emision real; nunca la pantalla.';
