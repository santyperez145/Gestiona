-- ============================================================================
-- La categoría deja de venir puesta en perfumería
-- ============================================================================
--
-- Continuación directa de 20260825000001, que le sacó el `DEFAULT 'perfumes'`
-- a `settings.industry_code`. Es la misma deuda, un nivel más abajo y peor:
-- ahí el rubro quedaba archivado en una fila de configuración; acá queda
-- escrito en cada producto del comercio.
--
-- ── Lo medido antes de tocar (2026-08-25, contra producción) ───────────────
--
--   products.category          NOT NULL DEFAULT 'perfume_arabe'::text
--   distribución               perfume_arabe 54, vaper 5, perfume_diseñador 1
--                              todo en 1 sola organización de 4
--   ecommerce_categories       3 filas, coinciden exacto con esos 3 slugs
--   organizaciones sin tienda  3 de 4
--
-- ── Por qué el DEFAULT se va ──────────────────────────────────────────────
--
-- Un comercio de cualquier rubro que dé de alta un producto sin elegir
-- categoría queda con `perfume_arabe` en su base, en silencio. No lo ve: la
-- pantalla muestra el nombre lindo, y el slug recién aparece cuando exporta,
-- publica en la tienda o arma un precio por categoría.
--
-- NULL pasa a significar "sin categoría", que es un estado real y distinto de
-- cualquier rubro concreto. Mismo criterio que `products.tax_rate` (NULL = la
-- tasa de la organización, 0 = exento) y que `settings.industry_code`.
--
-- ── Por qué además se va el NOT NULL ──────────────────────────────────────
--
-- Porque si no, quitar el default rompe hacia atrás. Hay ~15 migraciones ya
-- aplicadas cuyos bloques de verificación insertan en `products` sin pasar
-- `category` —20260814000008, 20260814000012, 20260814000013,
-- 20260814000014…— y hoy funcionan porque el default las tapa. Esos archivos
-- se vuelven a correr: la regla del repo es que toda migración es idempotente.
-- Con el default quitado y el NOT NULL puesto, la próxima pasada falla.
--
-- Los lectores ya toleran la ausencia: `get_store_categories` cuenta con
-- `p.category = c.slug` (NULL no matchea, que es lo correcto — un producto sin
-- categoría no pertenece a ninguna), y el cliente filtra con `Boolean`.
--
-- ⚠️ **No se backfillea nada.** Las 60 filas reales son de la perfumería de
-- verdad y su categoría es correcta. Tocar dato real para que un reporte dé
-- limpio es exactamente lo que este repo tiene prohibido. La migración cambia
-- el futuro, no el pasado.
--
-- ── ecommerce_categories.store_id deja de ser obligatorio ──────────────────
--
-- Efecto colateral necesario, y verificado en vivo antes de escribir esto: el
-- botón "Crear una categoría…" de `CategorySelect` **falla siempre**, porque
-- inserta sin `store_id` y la columna es NOT NULL sin default ni trigger:
--
--   null value in column "store_id" of relation "ecommerce_categories"
--   violates not-null constraint
--
-- Y aunque lo pasara, 3 de las 4 organizaciones no tienen tienda, así que no
-- habría `store_id` que pasar. Sin esto, sacarle el hardcodeo de perfumería al
-- selector deja al comercio nuevo con una lista vacía y sin salida — peor que
-- antes.
--
-- La columna ya era vestigial: `get_store_categories` une por `org_id` desde
-- 20260805000002 (el comentario de esa migración lo dice: "antes ataba la
-- categoría a store_id y ahora a org_id ... con el JOIN viejo, una categoría
-- cuyo store_id quedara en NULL desaparecía del menú") y el índice único es
-- `(org_id, slug)`. La categoría es del Business Core; la tienda es un canal
-- que la muestra. El índice viejo por store_id se deja: no molesta.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.products       ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.products       ALTER COLUMN category DROP NOT NULL;
ALTER TABLE public.ecommerce_categories ALTER COLUMN store_id DROP NOT NULL;

COMMENT ON COLUMN public.products.category IS
  'Slug de categoria. Es la llave con la que apunta a ecommerce_categories y '
  'la que leen el POS, los precios por categoria y las ofertas masivas. '
  'NULL = sin categoria, que es distinto de cualquier rubro concreto. Sin '
  'DEFAULT ni NOT NULL a proposito desde 2026-08-25: el default perfume_arabe '
  'le escribia perfumeria en la base a todo comercio de otro rubro.';

COMMENT ON COLUMN public.ecommerce_categories.store_id IS
  'Tienda que la origino, informativo. NULL = creada desde el Business Core '
  '(ficha de producto) por una organizacion que todavia no tiene tienda. '
  'get_store_categories une por org_id desde 20260805000002, asi que esta '
  'columna no decide visibilidad.';

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_default   text;
  v_nullable  text;
  v_store_nul text;
  v_sin_cat   int;
  v_cats      int;
  v_cats_null int;
  v_dist      text;
BEGIN
  SELECT column_default, is_nullable INTO v_default, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products'
     AND column_name = 'category';
  ASSERT v_default IS NULL,
    'products.category sigue con default: ' || COALESCE(v_default, '(null)');
  ASSERT v_nullable = 'YES',
    'products.category sigue NOT NULL, y eso rompe los bloques de verificacion '
    'de las migraciones que insertan sin categoria';

  SELECT is_nullable INTO v_store_nul
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ecommerce_categories'
     AND column_name = 'store_id';
  ASSERT v_store_nul = 'YES',
    'ecommerce_categories.store_id sigue NOT NULL: crear una categoria desde '
    'la ficha de producto seguiria fallando';

  -- La migración no toca dato: nadie se queda sin categoría por aplicarla.
  SELECT count(*) INTO v_sin_cat FROM public.products WHERE category IS NULL;
  ASSERT v_sin_cat = 0,
    'aparecieron ' || v_sin_cat || ' productos sin categoria: la migracion no '
    'debe vaciar ninguno';

  SELECT count(*), count(*) FILTER (WHERE store_id IS NULL)
    INTO v_cats, v_cats_null FROM public.ecommerce_categories;
  ASSERT v_cats_null = 0,
    'se vaciaron ' || v_cats_null || ' store_id existentes: quitar el NOT NULL '
    'no debe borrar el valor de las filas que ya lo tenian';

  SELECT string_agg(category || ' ' || n, ', ' ORDER BY n DESC) INTO v_dist
    FROM (SELECT category, count(*) AS n FROM public.products
           WHERE category IS NOT NULL GROUP BY category) d;

  RAISE NOTICE 'ZZ_OK default y NOT NULL quitados; % categorias intactas; distribucion actual: %',
    v_cats, COALESCE(v_dist, '(sin productos)');
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260825000002', 'categoria_sin_rubro') ON CONFLICT DO NOTHING;
