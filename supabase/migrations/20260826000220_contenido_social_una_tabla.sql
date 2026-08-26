-- ============================================================================
-- MKT-001 — una sola tabla para el contenido social
-- ============================================================================
--
-- Había **dos modelos para lo mismo**: `MarketingPage` escribe en
-- `marketing_posts` (vía los helpers de `supabaseStore.ts`) y
-- `SocialPlannerPage` en `social_posts`. Dos autoridades para "una publicación
-- del comercio", cada una con su propio esquema y su propia pantalla.
--
-- ── Cuál sobrevive, y por qué ─────────────────────────────────────────────
--
-- `social_posts`, medido columna por columna:
--
--   social_posts     platforms[] · media_urls[] · published_at · campaign_name
--                    target_audience · cta_text · cta_url · notes
--                    views · likes · comments · shares · clicks
--   marketing_posts  platform (una) · image_url (una) · product_ids
--                    ai_generated · user_id
--
-- Programación, métricas y multi-plataforma sólo están en `social_posts`, y
-- reconstruirlas del otro lado sería rehacer lo que ya está.
--
-- ⚠️ Pero **no es estrictamente más completo**, que es lo que decía el análisis
-- que originó este trabajo. `marketing_posts` tiene tres columnas que le
-- faltan, y hubo que mirarlas una por una antes de migrar:
--
--   · `product_ids`  — **no lo usa nadie**. Los `product_ids` que sí se usan
--                      son de combos y promociones, otra tabla. No se agrega.
--   · `user_id`      — `social_posts` es de la organización, no de la persona.
--                      Es más correcto así: la publicación es del comercio.
--   · `ai_generated` — **sí se usa**, y en dos lugares visibles: el KPI «Con
--                      IA» y el badge de cada publicación. Se agrega acá.
--
-- Migrar sin mirar habría perdido la marca de contenido generado con IA.
--
-- ── Sobre el momento ──────────────────────────────────────────────────────
--
-- Las dos tablas tienen **0 filas** (medido). No hay contenido que migrar ni
-- publicación que se pueda perder. Los estados además son compatibles:
-- `social_posts` acepta draft/scheduled/published/cancelled, un superconjunto
-- de los tres de `marketing_posts`.
-- ============================================================================

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.social_posts.ai_generated IS
  'La escribio el asistente de IA. Alimenta el KPI "Con IA" y el badge de cada '
  'publicacion en Marketing.';

COMMENT ON TABLE public.social_posts IS
  'Contenido social del comercio: unica autoridad desde 2026-08-26. Marketing y '
  'el planner de redes escriben aca.';

COMMENT ON TABLE public.marketing_posts IS
  'DEPRECADA el 2026-08-26. Era el segundo modelo de contenido social; quedo '
  'sin lecturas ni escrituras al unificar en social_posts. Tenia 0 filas al '
  'deprecarla. No borrar en la misma migracion que cambia la UI.';

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_org uuid; v_post uuid; v_n int; v_ia boolean;
BEGIN
  SELECT p.org_id INTO v_org FROM public.products p
   GROUP BY p.org_id ORDER BY count(*) DESC LIMIT 1;

  -- 1. La columna existe y su default no marca todo como IA.
  INSERT INTO public.social_posts (org_id, title, content, status)
  VALUES (v_org, 'ZZ Post sin IA', 'contenido', 'draft')
  RETURNING id, ai_generated INTO v_post, v_ia;
  ASSERT v_ia IS FALSE,
    'el default marca como generado con IA lo que escribio una persona';

  -- 2. Y se puede marcar cuando corresponde.
  UPDATE public.social_posts SET ai_generated = true WHERE id = v_post;
  SELECT ai_generated INTO v_ia FROM public.social_posts WHERE id = v_post;
  ASSERT v_ia IS TRUE, 'no se pudo marcar como generado con IA';

  -- 3. Los estados de `marketing_posts` entran todos: la migracion de la UI no
  --    puede quedar bloqueada por un CHECK mas angosto.
  UPDATE public.social_posts SET status = 'scheduled' WHERE id = v_post;
  UPDATE public.social_posts SET status = 'published' WHERE id = v_post;
  UPDATE public.social_posts SET status = 'draft' WHERE id = v_post;

  DELETE FROM public.social_posts WHERE id = v_post;

  SELECT count(*) INTO v_n FROM public.social_posts WHERE title = 'ZZ Post sin IA';
  ASSERT v_n = 0, 'quedaron restos: ' || v_n;

  -- 4. `marketing_posts` sigue vacia: nada que migrar, y nada que se pierda.
  SELECT count(*) INTO v_n FROM public.marketing_posts;
  ASSERT v_n = 0,
    'marketing_posts tiene ' || v_n || ' filas: hay que migrarlas antes de deprecarla';

  RAISE NOTICE 'ZZ_OK social_posts es la unica autoridad de contenido social';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000220', 'contenido_social_una_tabla') ON CONFLICT DO NOTHING;
