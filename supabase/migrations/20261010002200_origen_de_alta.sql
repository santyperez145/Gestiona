-- ═══════════════════════════════════════════════════════════════════════════
-- Origen de cada alta: cómo llegó cada comercio nuevo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §6 (hipótesis de crecimiento: «cada comercio activo trae a otro»,
-- métrica «altas referidas por comercio activo») y E4 («≥ 1 marca nueva
-- referida por sus influencers»). Medido 2026-10-10: no había ningún registro
-- de cómo llegaba un comercio; los códigos de referido existentes son de
-- clientes de las tiendas, no de comercios. Sin esto E4 no se puede medir.
--
--   · El cliente guarda el primer contacto (`?ref=`, `utm_*`, sitio de
--     origen, página de entrada) y lo manda en el alta como
--     `raw_user_meta_data.origen`.
--   · `trg_organizations_origen_de_alta` lo guarda en `origen_de_alta` al
--     crearse el comercio y resuelve `ref`: slug de otro comercio → referido
--     por ese comercio; código de influencer que coincide con uno solo →
--     referido por ese influencer (y su marca). Si no resuelve, queda el código
--     sin adivinar.
--   · Nunca frena un alta: cualquier error se registra como aviso y el
--     comercio se crea igual. No toca `handle_new_user_create_org`.
--
-- Lectura: el propio comercio (miembros) y administradores de plataforma.
-- Idempotente. Reversible: DROP TRIGGER, DROP FUNCTION, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.origen_de_alta (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('comercio', 'influencer', 'codigo', 'campania', 'sitio', 'directo')),
  codigo text CHECK (codigo IS NULL OR char_length(codigo) <= 80),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 120),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 120),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 120),
  sitio_origen text CHECK (sitio_origen IS NULL OR char_length(sitio_origen) <= 200),
  pagina_entrada text CHECK (pagina_entrada IS NULL OR char_length(pagina_entrada) <= 200),
  referido_por_org uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  referido_por_influencer uuid REFERENCES public.influencers(id) ON DELETE SET NULL,
  primer_contacto_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS origen_de_alta_referido_por_org_idx ON public.origen_de_alta (referido_por_org) WHERE referido_por_org IS NOT NULL;
CREATE INDEX IF NOT EXISTS origen_de_alta_referido_por_influencer_idx ON public.origen_de_alta (referido_por_influencer) WHERE referido_por_influencer IS NOT NULL;

ALTER TABLE public.origen_de_alta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS origen_de_alta_select ON public.origen_de_alta;
CREATE POLICY origen_de_alta_select ON public.origen_de_alta
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) OR public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.origen_de_alta FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.origen_de_alta FROM authenticated;
GRANT SELECT ON public.origen_de_alta TO authenticated;

COMMENT ON TABLE public.origen_de_alta IS
  'Cómo llegó cada comercio (primer contacto en el alta): referido por otro comercio, por un influencer, por código, campaña, sitio o directo. TESIS §6 y E4. Sólo la escribe trg_organizations_origen_de_alta.';

-- Texto del navegador: recortado, sin controles, vacío → NULL.
CREATE OR REPLACE FUNCTION public._texto_origen(p text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(left(btrim(regexp_replace(COALESCE(p, ''), '[[:cntrl:]]', '', 'g')), p_max), '');
$$;

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

    IF v_codigo IS NOT NULL THEN
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
      WHEN v_codigo IS NOT NULL THEN 'codigo'
      WHEN v_utm_source IS NOT NULL OR v_utm_campaign IS NOT NULL THEN 'campania'
      WHEN v_sitio IS NOT NULL THEN 'sitio'
      ELSE 'directo'
    END;

    INSERT INTO public.origen_de_alta (
      org_id, canal, codigo, utm_source, utm_medium, utm_campaign, sitio_origen, pagina_entrada,
      referido_por_org, referido_por_influencer, primer_contacto_at)
    VALUES (
      NEW.id, v_canal, v_codigo, v_utm_source, v_utm_medium, v_utm_campaign, v_sitio,
      public._texto_origen(v_origen->>'pagina_entrada', 200),
      COALESCE(v_org_ref, v_influencer_org), v_influencer, v_primer)
    ON CONFLICT (org_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    -- La atribución nunca frena un alta.
    RAISE WARNING 'origen_de_alta: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_organizations_origen_de_alta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organizations_origen_de_alta ON public.organizations;
CREATE TRIGGER trg_organizations_origen_de_alta
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trg_organizations_origen_de_alta();

COMMIT;
