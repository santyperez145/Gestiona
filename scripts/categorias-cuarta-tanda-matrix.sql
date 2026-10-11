-- Matriz reversible de 20261011000300 (categorías de alimentos, tecnología,
-- hogar, mascotas, deportes y juguetería).
--   node scripts/db.mjs --file scripts/categorias-cuarta-tanda-matrix.sql
-- Nombres típicos (singulares incluidos) caen donde corresponde con categoría
-- genérica; ninguna regla por categoría reconoce una genérica; todos los
-- rubros quedan con menos de 21 reglas de cada tipo. Sólo lectura.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_c4 (caso text, valor text) ON COMMIT DROP;

INSERT INTO zz_c4
SELECT x.industria || ' «' || x.nombre || '» (' || x.esperado || ')',
  COALESCE((SELECT c.slug FROM public.categoria_sugerida(x.industria, 'otro', x.nombre) c), '∅')
FROM (VALUES
  ('alimentos', 'Yerba mate Playadito 1 kg', 'almacen'),
  ('alimentos', 'Leche entera La Serenísima 1 L', 'lacteos'),
  ('alimentos', 'Alfajor triple de chocolate', 'golosinas'),
  ('alimentos', 'Lavandina Ayudín 1 L', 'limpieza'),
  ('tecnologia', 'Auricular inalámbrico JBL', 'audio-y-video'),
  ('tecnologia', 'Cargador rápido 20W tipo C', 'accesorios'),
  ('tecnologia', 'Monitor 24 pulgadas Samsung', 'computacion'),
  ('tecnologia', 'Joystick PS5 DualSense', 'gaming'),
  ('hogar', 'Sartén antiadherente 24 cm', 'cocina'),
  ('hogar', 'Toallón algodón 500 g', 'bano'),
  ('hogar', 'Almohadón decorativo terciopelo', 'decoracion'),
  ('hogar', 'Organizador de cajones', 'organizacion'),
  ('mascotas', 'Alimento Royal Canin adulto 15 kg', 'alimento'),
  ('mascotas', 'Rascador para gato 60 cm', 'juguetes'),
  ('mascotas', 'Pretal acolchado talle M', 'accesorios'),
  ('deportes', 'Mancuernas 5 kg par', 'fitness'),
  ('deportes', 'Botines Nike Phantom', 'calzado-deportivo'),
  ('deportes', 'Bicicleta rodado 29', 'outdoor'),
  ('jugueteria', 'Camión volcador de juguete', 'vehiculos'),
  ('jugueteria', 'Monopatín plegable infantil', 'aire-libre'),
  ('jugueteria', 'Muñeca Barbie fashionista', 'munecas-y-figuras'),
  ('jugueteria', 'Rompecabezas 1000 piezas', 'juegos-de-mesa')
) AS x(industria, nombre, esperado);

INSERT INTO zz_c4
SELECT 'reglas por categoría que reconocen una genérica (0)', count(*)::text
FROM public.rubro_reglas_categoria r
CROSS JOIN unnest(ARRAY['otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria']) g
WHERE r.sobre = 'categoria' AND (g ~ r.patron OR public.texto_catalogo(r.industry_code) ~ r.patron);

INSERT INTO zz_c4
SELECT 'rubros con reglas', string_agg(industry_code || ' ' || n, ', ' ORDER BY industry_code)
FROM (SELECT industry_code, count(*) n FROM public.rubro_reglas_categoria GROUP BY 1) t;

SELECT * FROM zz_c4;
ROLLBACK;
