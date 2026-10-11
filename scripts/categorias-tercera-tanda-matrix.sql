-- Matriz reversible de 20261011000000 (categorías de gastronomía, autopartes
-- y librería).
--   node scripts/db.mjs --file scripts/categorias-tercera-tanda-matrix.sql
-- Nombres típicos caen donde corresponde con categoría genérica; una propia
-- se respeta; ninguna regla por categoría reconoce una genérica; todos los
-- rubros quedan con menos de 20 reglas de cada tipo. Sólo lectura.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_c3 (caso text, valor text) ON COMMIT DROP;

INSERT INTO zz_c3
SELECT x.industria || ' «' || x.nombre || '» (' || x.esperado || ')',
  COALESCE((SELECT c.slug FROM public.categoria_sugerida(x.industria, 'otro', x.nombre) c), '∅')
FROM (VALUES
  ('gastronomia', 'Milanesa napolitana con papas', 'platos-principales'),
  ('gastronomia', 'Coca Cola 500 ml', 'bebidas'),
  ('gastronomia', 'Pizza muzzarella grande', 'pizzas-y-empanadas'),
  ('gastronomia', 'Flan casero con dulce de leche', 'postres'),
  ('autopartes', 'Pastillas de freno delanteras Fiat Palio', 'frenos'),
  ('autopartes', 'Filtro de aceite Mann W712', 'filtros-y-lubricantes'),
  ('autopartes', 'Amortiguador trasero Gol Trend', 'suspension-y-direccion'),
  ('autopartes', 'Kit de distribución VW 1.6', 'motor'),
  ('libreria', 'Cuaderno Rivadavia tapa dura 48 hojas', 'escolar'),
  ('libreria', 'Resma A4 75 g 500 hojas', 'papeleria'),
  ('libreria', 'Abrochadora metálica 21/6', 'oficina'),
  ('libreria', 'Acrílicos Eterna set x 6', 'arte-y-manualidades'),
  -- Singulares terminados en consonante.
  ('autopartes', 'Ruleman de rueda trasera', 'suspension-y-direccion'),
  ('autopartes', 'Inyector nafta Bosch', 'motor'),
  ('libreria', 'Lápiz negro HB', 'escolar'),
  ('libreria', 'Marcador permanente negro', 'escolar'),
  ('indumentaria', 'Cinturón de cuero marrón', 'accesorios'),
  ('indumentaria', 'Mocasín de gamuza', 'calzado'),
  ('cosmetica', 'Pincel de maquillaje kabuki', 'maquillaje')
) AS x(industria, nombre, esperado);

INSERT INTO zz_c3
SELECT 'categoría propia se respeta (∅)', COALESCE((SELECT c.slug FROM public.categoria_sugerida('gastronomia', 'Menú del día', 'Milanesa') c), '∅');

INSERT INTO zz_c3
SELECT 'reglas por categoría que reconocen una genérica (0)', count(*)::text
FROM public.rubro_reglas_categoria r
CROSS JOIN unnest(ARRAY['otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria']) g
WHERE r.sobre = 'categoria' AND (g ~ r.patron OR public.texto_catalogo(r.industry_code) ~ r.patron);

INSERT INTO zz_c3
SELECT 'reglas por rubro y tipo (todas < 21)', string_agg(industry_code || ' ' || sobre || ' ' || n, ', ' ORDER BY industry_code, sobre)
FROM (SELECT industry_code, sobre, count(*) n FROM public.rubro_reglas_categoria GROUP BY 1, 2) t;

SELECT * FROM zz_c3;
ROLLBACK;
