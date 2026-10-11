-- Matriz reversible de 20261010003100 (categorías de cosmética e indumentaria).
--   node scripts/db.mjs --file scripts/categorias-influencers-matrix.sql
-- 1. Perfumería sigue sin reglas: el comercio del rubro conserva su
--    organización (ningún producto suyo recibiría otra categoría).
-- 2. Nombres típicos caen donde corresponde con categoría genérica.
-- 3. Una categoría propia que no se reconoce se respeta.
-- 4. Ninguna regla por categoría reconoce una categoría genérica.
-- Sólo lectura; se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_ci (caso text, valor text) ON COMMIT DROP;

INSERT INTO zz_ci
SELECT 'productos de perfumería que recibirían otra categoría (0)', count(*)::text
FROM public.products p JOIN public.settings s ON s.org_id = p.org_id
CROSS JOIN LATERAL public.categoria_sugerida(s.industry_code, p.category, p.name) c
WHERE s.industry_code = 'perfumes' AND c.slug IS DISTINCT FROM p.category;

INSERT INTO zz_ci
SELECT 'nombre → categoría: ' || x.industria || ' «' || x.nombre || '» (' || x.esperado || ')',
  COALESCE((SELECT c.slug FROM public.categoria_sugerida(x.industria, 'otro', x.nombre) c), '∅')
FROM (VALUES
  ('cosmetica', 'Labial matte rojo', 'maquillaje'),
  ('cosmetica', 'Shampoo reparador 400 ml', 'cuidado-capilar'),
  ('cosmetica', 'Sérum vitamina C', 'cuidado-facial'),
  ('indumentaria', 'Zapatillas urbanas blancas', 'calzado'),
  ('indumentaria', 'Remera oversize negra', 'remeras-y-tops'),
  ('indumentaria', 'Buzo canguro con capucha', 'buzos-y-abrigos'),
  ('indumentaria', 'Jean mom tiro alto', 'pantalones'),
  ('indumentaria', 'Producto sin pistas', 'varios')
) AS x(industria, nombre, esperado);

INSERT INTO zz_ci
SELECT 'categoría propia se respeta (∅)', COALESCE((SELECT c.slug FROM public.categoria_sugerida('indumentaria', 'Colección otoño', 'Remera') c), '∅');

INSERT INTO zz_ci
SELECT 'reglas por categoría que reconocen una genérica (0)', count(*)::text
FROM public.rubro_reglas_categoria r
CROSS JOIN unnest(ARRAY['otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria']) g
WHERE r.sobre = 'categoria' AND (g ~ r.patron OR public.texto_catalogo(r.industry_code) ~ r.patron);

INSERT INTO zz_ci
SELECT 'reglas por rubro (todas < 20)', string_agg(industry_code || ' ' || n, ', ' ORDER BY industry_code)
FROM (SELECT industry_code, count(*) n FROM public.rubro_reglas_categoria GROUP BY 1) t;

SELECT * FROM zz_ci;
ROLLBACK;
