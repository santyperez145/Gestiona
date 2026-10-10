-- ═══════════════════════════════════════════════════════════════════════════
-- Creadores que traen marcas: enlace propio y conteo en el portal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- E4 de docs/TESIS.md: «Creators trae marcas: ≥ 1 marca nueva referida por
-- sus influencers» (2026-12-01). Desde 20261010002200 el alta guarda `ref`,
-- pero un creador no tenía un enlace propio para invitar marcas: los códigos
-- de influencer son únicos sólo dentro de cada marca, y el portal no ofrecía
-- ningún enlace a Nerqia.
--
--   · `ref=@<slug público del creador>` (único en `creator_accounts`) se
--     resuelve a `referido_por_creador`, canal «creador». La arroba evita
--     confundirlo con el slug de un comercio.
--   · `marcas_que_trajo_el_creador()` devuelve al creador logueado cuántas
--     marcas se dieron de alta con su enlace (nombre y fecha; nada más).
--
-- Idempotente. Reversible: restaurar la función de 20261010002200, DROP
-- FUNCTION y DROP COLUMN.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.origen_de_alta
  ADD COLUMN IF NOT EXISTS referido_por_creador uuid REFERENCES public.creator_accounts(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS origen_de_alta_referido_por_creador_idx
  ON public.origen_de_alta (referido_por_creador) WHERE referido_por_creador IS NOT NULL;

ALTER TABLE public.origen_de_alta DROP CONSTRAINT IF EXISTS origen_de_alta_canal_check;
ALTER TABLE public.origen_de_alta ADD CONSTRAINT origen_de_alta_canal_check
  CHECK (canal IN ('comercio', 'influencer', 'creador', 'codigo', 'campania', 'sitio', 'directo'));

CREATE OR REPLACE FUNCTION public.trg_organizations_origen_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origen jsonb;
  v_codigo text;
  v_org_ref uuid;
  v_influencer uuid;
  v_influencer_org uuid;
  v_creador uuid;
  v_coincidencias integer;
  v_canal text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_sitio text;
  v_primer timestamptz;
BEGIN
  BEGIN
    SELECT u.raw_user_meta_data->'origen' INTO v_origen FROM auth.users u WHERE u.id = NEW.owner_user_id;
    IF v_origen IS NULL OR jsonb_typeof(v_origen) <> 'object' THEN
      v_origen := '{}'::jsonb;
    END IF;

    v_codigo := lower(public._texto_origen(v_origen->>'ref', 80));
    v_utm_source := public._texto_origen(v_origen->>'utm_source', 120);
    v_utm_medium := public._texto_origen(v_origen->>'utm_medium', 120);
    v_utm_campaign := public._texto_origen(v_origen->>'utm_campaign', 120);
    v_sitio := lower(public._texto_origen(v_origen->>'sitio_origen', 200));
    BEGIN
      v_primer := (v_origen->>'primer_contacto_at')::timestamptz;
      IF v_primer > now() + interval '1 day' OR v_primer < now() - interval '400 days' THEN v_primer := NULL; END IF;
    EXCEPTION WHEN others THEN
      v_primer := NULL;
    END;

    IF v_codigo LIKE '@%' THEN
      -- Enlace de un creador del portal: `ref=@<slug público>` (único).
      SELECT c.user_id INTO v_creador FROM public.creator_accounts c
      WHERE lower(c.public_slug) = substr(v_codigo, 2) LIMIT 1;
    ELSIF v_codigo IS NOT NULL THEN
      SELECT o.id INTO v_org_ref FROM public.organizations o
      WHERE lower(o.slug) = v_codigo AND o.id <> NEW.id LIMIT 1;
      IF v_org_ref IS NULL THEN
        SELECT count(*), min(i.id::text)::uuid, min(i.org_id::text)::uuid
          INTO v_coincidencias, v_influencer, v_influencer_org
        FROM public.influencers i WHERE lower(i.referral_code) = v_codigo;
        -- Los códigos son únicos dentro de cada marca: si coincide con más de
        -- uno no se adivina cuál.
        IF v_coincidencias <> 1 THEN
          v_influencer := NULL;
          v_influencer_org := NULL;
        END IF;
      END IF;
    END IF;

    v_canal := CASE
      WHEN v_org_ref IS NOT NULL THEN 'comercio'
      WHEN v_influencer IS NOT NULL THEN 'influencer'
      WHEN v_creador IS NOT NULL THEN 'creador'
      WHEN v_codigo IS NOT NULL THEN 'codigo'
      WHEN v_utm_source IS NOT NULL OR v_utm_campaign IS NOT NULL THEN 'campania'
      WHEN v_sitio IS NOT NULL THEN 'sitio'
      ELSE 'directo'
    END;

    INSERT INTO public.origen_de_alta (
      org_id, canal, codigo, utm_source, utm_medium, utm_campaign, sitio_origen, pagina_entrada,
      referido_por_org, referido_por_influencer, referido_por_creador, primer_contacto_at)
    VALUES (
      NEW.id, v_canal, v_codigo, v_utm_source, v_utm_medium, v_utm_campaign, v_sitio,
      public._texto_origen(v_origen->>'pagina_entrada', 200),
      COALESCE(v_org_ref, v_influencer_org), v_influencer, v_creador, v_primer)
    ON CONFLICT (org_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    -- La atribución nunca frena un alta.
    RAISE WARNING 'origen_de_alta: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcas_que_trajo_el_creador()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión como creador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.public_slug INTO v_slug FROM public.creator_accounts c WHERE c.user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta cuenta no es de creador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'slug', v_slug,
    'total', (SELECT count(*) FROM public.origen_de_alta a WHERE a.referido_por_creador = auth.uid()),
    'marcas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nombre', o.name, 'desde', a.created_at) ORDER BY a.created_at DESC)
      FROM public.origen_de_alta a JOIN public.organizations o ON o.id = a.org_id
      WHERE a.referido_por_creador = auth.uid()), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.marcas_que_trajo_el_creador() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcas_que_trajo_el_creador() TO authenticated;

COMMENT ON FUNCTION public.marcas_que_trajo_el_creador() IS
  'Marcas que se dieron de alta con el enlace del creador logueado (ref=@slug). E4 de docs/TESIS.md.';

COMMIT;
