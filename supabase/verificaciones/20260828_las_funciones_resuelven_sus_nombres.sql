-- ¿Todas las funciones de la base pueden resolver los nombres que usan?
--
--     npm run db -- --file supabase/verificaciones/20260828_las_funciones_resuelven_sus_nombres.sql
--
-- ── Por qué existe ────────────────────────────────────────────────────────
--
-- ⚠️ **plpgsql resuelve nombres en tiempo de ejecución.** Una función puede
-- nombrar una columna que no existe, o un nombre que significa dos cosas a la
-- vez, y crearse sin una sola queja. Compila, pasa el lint, pasa los tests, y
-- falla la primera vez que alguien la usa.
--
-- Este repo ya pagó dos veces por eso:
--
--   - `afip_marcar_delegacion` escribía `last_error`, una columna inexistente.
--     El UPDATE fallaba con `42703`, el `rpc` no miraba `.error`, y el panel
--     decía «falta conectar AFIP» para siempre con AFIP ya conectado.
--   - El buzón de documentos de Finance tenía **tres** funciones con
--     `42702 column reference is ambiguous`: `RETURNS TABLE (document_id …)`
--     declara variables de salida, y un nombre que también es columna deja a
--     Postgres sin forma de elegir. Finance estaba **habilitado** desde el
--     2026-08-22 y `finance_documents` tenía 0 filas: el buzón nunca pudo
--     recibir nada, y nadie lo supo hasta correr esto.
--
-- 📌 `plpgsql_check` es la herramienta que encuentra esa familia entera. Se
-- instala **dentro de una transacción que se revierte**, así que no queda nada
-- en producción — las extensiones son transaccionales en Postgres.
--
-- ⚠️ El resultado esperado hoy es **2 errores, y los dos son conocidos**. Si
-- aparece un tercero, es nuevo y hay que mirarlo.
--
-- ── Los dos conocidos, y por qué no son bugs ──────────────────────────────
--
-- Los dos son ramas protegidas por `TG_TABLE_NAME`, que el análisis estático
-- no puede evaluar: sabe qué dice el código, no sobre qué tabla va a correr.
--
--   1. `enforce_org_user_plan_limit() sobre org_invitations`
--      → «record "new" has no field "user_id"»
--      El `NEW.user_id` vive dentro de `IF TG_TABLE_NAME = 'memberships'`. La
--      misma función sirve a los dos triggers y `memberships` sí tiene esa
--      columna. Comprobado insertando una invitación de verdad: pasa.
--
--   2. `trg_ledger_inmutable() sobre ledger_lines`
--      → «record "old" has no field "anulado_por"»
--      Idem: está dentro de `IF TG_OP = 'UPDATE' AND TG_TABLE_NAME =
--      'ledger_entries'`, y `ledger_entries` sí tiene la columna
--      (`ledger_lines` no). Comprobado intentando un UPDATE sobre
--      `ledger_lines`: devuelve su error propio, «El libro es inmutable».
--
-- 📌 **Que un hallazgo sea falso positivo se comprueba ejecutando, no
-- leyendo.** De los 16 hallazgos del 2026-08-28, catorce eran reales: tres
-- bugs del buzón de Finance, diez funciones huérfanas y un trigger que fingía
-- auditar cada venta. Descartar por intuición habría dejado los catorce.

BEGIN;

CREATE EXTENSION IF NOT EXISTS plpgsql_check;

CREATE TEMP TABLE zz_check(funcion text, nivel text, mensaje text, contexto text)
  ON COMMIT DROP;

DO $$
DECLARE r record; c record;
BEGIN
  /**
   * ⚠️ Una función de trigger NO se puede analizar sola: `plpgsql_check`
   * necesita saber sobre qué tabla corre para resolver `NEW` y `OLD`. La
   * primera versión de este archivo no le pasaba la tabla, y **136 de 371
   * funciones quedaban sin revisar** — un 37% de punto ciego que además caía
   * justo donde este repo tuvo los bugs más caros: los triggers de stock, los
   * del libro mayor y el de los límites del plan.
   *
   * 📌 Un chequeo que dice «0 errores» sobre dos tercios de las funciones es
   * peor que no tenerlo: da tranquilidad sin haberla ganado.
   *
   * Se recorre cada par (función, tabla donde está colgada). Una función usada
   * por triggers en varias tablas se revisa una vez por cada una, que es lo
   * correcto: `NEW` significa algo distinto en cada tabla.
   */
  FOR r IN
    SELECT p.oid AS fn_oid,
           p.oid::regprocedure::text AS firma,
           t.tgrelid AS tabla_oid,
           COALESCE(c2.relname, '') AS tabla
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      LEFT JOIN pg_trigger t ON t.tgfoid = p.oid AND NOT t.tgisinternal
      LEFT JOIN pg_class c2 ON c2.oid = t.tgrelid
     WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
  LOOP
    BEGIN
      IF r.tabla_oid IS NULL THEN
        FOR c IN SELECT * FROM plpgsql_check_function_tb(r.fn_oid) LOOP
          IF c.level = 'error' THEN
            INSERT INTO zz_check
            VALUES (r.firma, c.level, c.message, left(COALESCE(c.context, c.query, ''), 90));
          END IF;
        END LOOP;
      ELSE
        FOR c IN SELECT * FROM plpgsql_check_function_tb(r.fn_oid, r.tabla_oid) LOOP
          IF c.level = 'error' THEN
            INSERT INTO zz_check
            VALUES (r.firma || ' sobre ' || r.tabla, c.level, c.message,
                    left(COALESCE(c.context, c.query, ''), 90));
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Queda anotado: una función que no se puede analizar es una que no se
      -- revisó, y eso hay que verlo, no esconderlo detrás del 0 de errores.
      INSERT INTO zz_check VALUES (r.firma, 'no-analizable', SQLERRM, NULL);
    END;
  END LOOP;
END $$;

-- ── Cuántas se revisaron ────────────────────────────────────────────────────
-- ⚠️ Si esto da poco, el recorrido se rompió y los 0 errores de abajo no
-- significan nada.
SELECT count(*) AS funciones_plpgsql_revisadas
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
 WHERE n.nspname = 'public' AND l.lanname = 'plpgsql';

-- ── El detalle, si lo hay ───────────────────────────────────────────────────
SELECT left(funcion, 46) AS funcion, mensaje, contexto
  FROM zz_check WHERE nivel = 'error'
 ORDER BY funcion;

-- ── La cuenta que tiene que dar 0 ───────────────────────────────────────────
SELECT count(*) FILTER (WHERE nivel = 'error')          AS errores,
       count(*) FILTER (WHERE nivel = 'no-analizable')  AS no_analizables
  FROM zz_check;

ROLLBACK;

-- La extensión no quedó instalada: el ROLLBACK se la llevó.
SELECT count(*) AS extension_instalada
  FROM pg_extension WHERE extname = 'plpgsql_check';
