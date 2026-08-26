-- ═══════════════════════════════════════════════════════════════════════════
-- Índice por tenant en las tablas nuevas, y una vista que avise la próxima vez
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Auditoría contra producción del 2026-08-25: **7 tablas tienen `org_id`, RLS
-- activa y ninguna policy que no filtre por tenant — pero ningún índice que
-- empiece por `org_id`**.
--
-- Las siete son de los slices recientes de Finance e importación:
--
--     finance_document_events
--     finance_document_extraction_revisions
--     finance_document_line_matches
--     finance_document_match_runs
--     finance_purchase_draft_lines
--     finance_purchase_drafts
--     product_import_rows
--
-- ── Por qué importa aunque hoy tengan 0 filas ──────────────────────────────
--
-- La policy de RLS evalúa `org_id` **en cada fila**. Sin un índice que empiece
-- por esa columna, cualquier lectura recorre la tabla entera y recién después
-- descarta lo que no es del tenant. Con 0 filas no se nota; con un lote de
-- importación de 5.000 renglones sí, y para entonces el índice hay que crearlo
-- sobre una tabla en uso.
--
-- ⚠️ Es el patrón que este repo ya pagó una vez: la sesión 84 tuvo que agregar
-- índices por `org_id` a mano después de que el panel se pusiera lento.
--
-- ── El orden de las columnas no es decorativo ──────────────────────────────
--
-- `org_id` va **primero**. Un índice `(document_id, org_id)` no sirve para
-- filtrar por tenant: PostgreSQL sólo usa el prefijo. Varias de estas tablas ya
-- tenían índice por su padre —`..._document_idx`, `..._draft_idx`— y por eso el
-- problema no se veía: parecía que estaban indexadas.
--
-- Donde hay `created_at` se usa `(org_id, created_at DESC)`, que es la
-- convención del resto del esquema (`coupons_org_idx`, `crm_activities_org_idx`)
-- y sirve igual para filtrar y para ordenar el listado.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS finance_document_events_org_idx
  ON public.finance_document_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS finance_document_extraction_revisions_org_idx
  ON public.finance_document_extraction_revisions (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS finance_document_match_runs_org_idx
  ON public.finance_document_match_runs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS finance_purchase_drafts_org_idx
  ON public.finance_purchase_drafts (org_id, created_at DESC);

-- Estas tres no tienen `created_at`: se ordenan por su padre, así que el índice
-- por tenant va solo.
CREATE INDEX IF NOT EXISTS finance_document_line_matches_org_idx
  ON public.finance_document_line_matches (org_id);

CREATE INDEX IF NOT EXISTS finance_purchase_draft_lines_org_idx
  ON public.finance_purchase_draft_lines (org_id);

CREATE INDEX IF NOT EXISTS product_import_rows_org_idx
  ON public.product_import_rows (org_id);

-- ── La guarda ──────────────────────────────────────────────────────────────
--
-- ⚠️ Esta guarda **tiene que vivir en la base**, y eso se decidió midiendo.
--
-- El primer intento fue un test de vitest que leyera las migraciones y buscara
-- `CREATE TABLE ... org_id` sin su `CREATE INDEX`. Contra la verdad del
-- catálogo —7 tablas— el parser reportó **87**: no ve los índices creados con
-- otra sintaxis, los que vienen de una PK compuesta `(org_id, ...)`, ni los
-- creados dentro de un bloque `DO`. Un guardia con ochenta excepciones no es un
-- guardia; enseña a ignorar la luz roja.
--
-- El catálogo sabe la respuesta exacta. Es el mismo criterio que
-- `rls_audit_open_policies`, que ya existe por la misma razón.

CREATE OR REPLACE VIEW public.audit_org_sin_indice AS
SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
  COALESCE((SELECT s.n_live_tup FROM pg_stat_user_tables s WHERE s.relid = c.oid), 0) AS filas_aprox
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = c.oid AND a.attname = 'org_id'
       AND a.attnum > 0 AND NOT a.attisdropped)
  -- Ningún índice que EMPIECE por org_id. `indkey[0]` es la primera columna:
  -- un índice donde org_id va segundo no sirve para filtrar por tenant.
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a2 ON a2.attrelid = c.oid AND a2.attnum = i.indkey[0]
     WHERE i.indrelid = c.oid AND a2.attname = 'org_id');

COMMENT ON VIEW public.audit_org_sin_indice IS
  'Tablas con org_id y sin indice que empiece por org_id. Deberia estar VACIA: sin ese indice, la policy de RLS recorre la tabla entera en cada lectura. Espejo de rls_audit_open_policies.';

-- Sólo staff de plataforma: la lista de tablas del esquema no es información
-- que le corresponda a un comercio.
REVOKE ALL ON public.audit_org_sin_indice FROM anon, authenticated;
