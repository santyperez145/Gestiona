-- ═══════════════════════════════════════════════════════════════════════════
-- Categorías por rubro: singulares que la cuarta tanda no reconocía
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El test de 20261011000300 encontró, después de aplicarla, cinco plurales
-- escritos «-es?» sobre palabras que terminan en consonante: así no se
-- reconoce el singular («cargadores?» no encuentra «cargador»). Mismo error
-- que se corrigió en 20261011000000. Se corrige el patrón en la base sin
-- reescribir la migración aplicada.
--
-- Idempotente (sólo reemplaza si encuentra la forma vieja). Reversible:
-- reemplazo inverso.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

UPDATE public.rubro_reglas_categoria
SET patron = replace(replace(replace(replace(replace(patron,
  'botines?', 'botin(es)?'),
  'cargadores?', 'cargador(es)?'),
  'cereales?', 'cereal(es)?'),
  'panales?', 'panal(es)?'),
  'televisores?', 'televisor(es)?')
WHERE industry_code IN ('alimentos', 'tecnologia', 'hogar', 'mascotas', 'deportes', 'jugueteria')
  AND patron ~ '(botines|cargadores|cereales|panales|televisores)\?';

COMMIT;
