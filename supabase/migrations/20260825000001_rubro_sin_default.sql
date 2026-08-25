-- ============================================================================
-- El rubro deja de venir puesto en "perfumes"
-- ============================================================================
--
-- `settings.industry_code` se creó con `DEFAULT 'perfumes'` en
-- 20260428021128, cuando esto era la app de un solo negocio. Sobrevivió a la
-- multi-tenencia: hoy toda organización nueva nace archivada como perfumería
-- sin haber elegido nada.
--
-- No es cosmético. El rubro siembra tipos de producto y atributos
-- (`aplicar_perfil_de_negocio`), alimenta las sugerencias y decide cómo se
-- estructura el catálogo. Sembrar los de otro rubro es peor que pedir un clic:
-- el comercio descubre el problema cuando ya cargó productos.
--
-- Medido antes de tocar (2026-08-25): el default era `'perfumes'::text`, 2
-- organizaciones tenían fila en `settings` y **las dos** en `perfumes`, con 0
-- en NULL — pero sólo 1 pasó de verdad por el perfilador. Es decir: una eligió
-- y la otra lo heredó sin enterarse.
--
-- NULL pasa a significar "todavía no eligió", que es un estado real y distinto
-- de cualquier rubro. Mismo criterio que `products.tax_rate`, donde NULL es "la
-- tasa de la organización" y 0 es exento.
--
-- ⚠️ **No se backfillea nada.** Una de las dos filas en `perfumes` es la
-- perfumería de verdad, y "corregir" datos reales para que un reporte dé limpio
-- es exactamente lo que este repo tiene prohibido. Las existentes quedan como
-- están; el default deja de aplicarse a las que vengan.
-- ============================================================================

ALTER TABLE public.settings ALTER COLUMN industry_code DROP DEFAULT;

COMMENT ON COLUMN public.settings.industry_code IS
  'Rubro elegido por el comercio en el onboarding. NULL = todavia no eligio, '
  'que es distinto de cualquier rubro concreto. Sin DEFAULT a proposito desde '
  '2026-08-25: el default perfumes archivaba como perfumeria a todo comercio '
  'nuevo y le sembraba tipos de producto de otro rubro.';

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_default text;
  v_perfumes int;
  v_null int;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'settings'
     AND column_name = 'industry_code';
  ASSERT v_default IS NULL,
    'el default sigue puesto: ' || COALESCE(v_default, '(null)');

  -- Las filas reales no se tocaron: la migración cambia el futuro, no el pasado.
  SELECT count(*) INTO v_perfumes FROM public.settings WHERE industry_code = 'perfumes';
  SELECT count(*) INTO v_null     FROM public.settings WHERE industry_code IS NULL;
  ASSERT v_perfumes = 2,
    'cambio la cantidad de filas en perfumes: ' || v_perfumes || ' (se midieron 2)';
  ASSERT v_null = 0,
    'aparecieron filas en NULL que antes no estaban: ' || v_null;

  RAISE NOTICE 'ZZ_OK default quitado; % filas en perfumes intactas', v_perfumes;
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260825000001', 'rubro_sin_default') ON CONFLICT DO NOTHING;
