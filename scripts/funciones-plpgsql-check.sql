-- Revisión estática de todas las funciones PL/pgSQL con plpgsql_check, sin
-- dejar nada instalado (la extensión se crea y se revierte).
--   node scripts/db.mjs --file scripts/funciones-plpgsql-check.sql
-- Encontró (2026-10-11) que get_store_assortment declaraba stock integer
-- cuando products.stock ya era numeric: fallaba siempre (20261011002500).
--
-- Falsos positivos conocidos (no son errores):
--   · tablas temporales que crea la propia función: ajustar_precios_en_bloque
--     (_ajuste_precios), categorizar_productos (_categorizacion);
--   · tablas de transición de disparadores de sentencia: rt_aviso_*
--     (filas_nuevas / filas_viejas);
--   · disparadores compartidos entre tablas, que se chequean contra una sola:
--     enforce_org_user_plan_limit (memberships / org_invitations),
--     trg_ledger_inmutable (ledger_entries / ledger_lines).
BEGIN;
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
SELECT p.proname, left(r.message, 90) AS mensaje
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang AND l.lanname = 'plpgsql'
CROSS JOIN LATERAL plpgsql_check_function_tb(p.oid,
  relid => CASE WHEN p.prorettype = 'trigger'::regtype
    THEN (SELECT tgrelid FROM pg_trigger t WHERE t.tgfoid = p.oid LIMIT 1) ELSE 0 END) r
WHERE p.pronamespace = 'public'::regnamespace
  AND r.level = 'error'
  AND (p.prorettype <> 'trigger'::regtype OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid))
  AND p.proname NOT IN ('ajustar_precios_en_bloque', 'categorizar_productos', 'enforce_org_user_plan_limit', 'trg_ledger_inmutable')
  AND p.proname NOT LIKE 'rt_aviso_%'
ORDER BY 1;
ROLLBACK;
