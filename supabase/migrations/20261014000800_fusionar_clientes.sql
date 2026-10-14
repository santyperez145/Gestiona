-- Clientes: combinar dos fichas sin perder nada y en una sola operación.
--
-- Medido 2026-10-14: «Combinar clientes» (Clientes) movía ventas, deudas y
-- puntos en tres pasos sueltos desde el navegador y después borraba la ficha
-- de origen. Hay 29 tablas que apuntan a `customers`. Las otras 26 perdían el
-- vínculo (SET NULL: pedidos online, presupuestos, tratos, devoluciones,
-- reservas, órdenes de servicio…) o se borraban en cascada (actividades y
-- contactos del CRM, tickets y sesiones del portal, membresía de fidelidad,
-- segmentos). Un corte entre pasos dejaba la combinación a medias, y desde
-- 20261014000700 una ficha con saldo a favor no se puede borrar, así que la
-- combinación fallaba después de mover las ventas.
--
-- `fusionar_clientes` hace todo en una transacción:
-- · recorre todas las FK hacia `customers` desde el catálogo (las que se
--   agreguen después también entran) y pasa cada fila al cliente destino;
-- · si una fila chocaría con un índice único (el destino ya está en ese
--   segmento, ya es miembro de fidelidad…) queda la del destino y la del
--   origen se va con la ficha;
-- · el nombre se actualiza sólo donde ya lo hacía la pantalla (ventas,
--   deudas, puntos) y en el saldo a favor; los pedidos con datos fiscales
--   conservan el nombre facturado;
-- · el saldo a favor se mueve antes de borrar, así la ficha de origen queda
--   en cero y se puede borrar;
-- · devuelve cuántas filas movió por tabla.
-- Permiso: dueño o administrador (el mismo que pedía mover las deudas).
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.fusionar_clientes(p_org uuid, p_origen uuid, p_destino uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_origen text;
  v_destino text;
  r record;
  ix record;
  v_cond text;
  v_set text;
  v_otras text;
  v_n bigint;
  v_movidas jsonb := '{}'::jsonb;
  v_con_nombre text[] := ARRAY['sales', 'debts', 'loyalty_points', 'saldo_a_favor_movimientos'];
BEGIN
  IF v_user IS NULL OR NOT public.has_org_role(p_org, v_user, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden combinar clientes' USING ERRCODE = '42501';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Elegí dos clientes distintos' USING ERRCODE = '22023';
  END IF;
  -- Las dos fichas, del negocio y bloqueadas (en orden fijo: sin deadlocks).
  PERFORM 1 FROM public.customers WHERE id IN (p_origen, p_destino) AND org_id = p_org ORDER BY id FOR UPDATE;
  SELECT name INTO v_origen FROM public.customers WHERE id = p_origen AND org_id = p_org;
  SELECT name INTO v_destino FROM public.customers WHERE id = p_destino AND org_id = p_org;
  IF v_origen IS NULL OR v_destino IS NULL THEN
    RAISE EXCEPTION 'Los dos clientes tienen que ser de este negocio' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT c.conrelid, n.nspname AS esquema, cl.relname AS tabla, a.attname AS col,
           EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.conrelid AND o.attname = 'org_id' AND NOT o.attisdropped) AS tiene_org,
           EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.conrelid AND o.attname = 'customer_name' AND NOT o.attisdropped) AS tiene_nombre
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.customers'::regclass
       AND array_length(c.conkey, 1) = 1 AND c.conrelid <> 'public.customers'::regclass
     ORDER BY cl.relname, a.attname
  LOOP
    -- Filas que chocarían con un índice único donde ya está el destino: se
    -- quedan con el origen y se van con él.
    v_cond := '';
    FOR ix IN
      SELECT i.indexrelid,
             ARRAY(SELECT att.attname FROM unnest(i.indkey) k JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k WHERE att.attname <> r.col) AS otras
        FROM pg_index i
       WHERE i.indrelid = r.conrelid AND i.indisunique AND NOT i.indisprimary
         AND (SELECT attnum FROM pg_attribute WHERE attrelid = r.conrelid AND attname = r.col) = ANY (i.indkey)
    LOOP
      SELECT coalesce(string_agg(format(' AND d.%1$I = t.%1$I', o), ''), '') INTO v_otras FROM unnest(ix.otras) o;
      v_cond := v_cond || format(' AND NOT EXISTS (SELECT 1 FROM %I.%I d WHERE d.%I = $2%s)', r.esquema, r.tabla, r.col, v_otras);
    END LOOP;

    v_set := format('%I = $2', r.col);
    IF r.tiene_nombre AND r.col = 'customer_id' AND r.tabla = ANY (v_con_nombre) THEN
      v_set := v_set || ', customer_name = $4';
    END IF;
    EXECUTE format('UPDATE %I.%I t SET %s WHERE t.%I = $1%s%s',
                   r.esquema, r.tabla, v_set, r.col,
                   CASE WHEN r.tiene_org THEN ' AND t.org_id = $3' ELSE '' END, v_cond)
      USING p_origen, p_destino, p_org, v_destino;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_movidas := v_movidas || jsonb_build_object(r.tabla || CASE WHEN r.col <> 'customer_id' THEN '.' || r.col ELSE '' END, v_n);
    END IF;
  END LOOP;

  DELETE FROM public.customers WHERE id = p_origen AND org_id = p_org;

  RETURN jsonb_build_object('origen', v_origen, 'destino', v_destino, 'movidas', v_movidas);
END;
$$;

REVOKE ALL ON FUNCTION public.fusionar_clientes(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fusionar_clientes(uuid, uuid, uuid) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'fusionar_clientes', pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige dueño o administrador del negocio; las dos fichas tienen que ser de ese negocio y sólo mueve filas de ese negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-14'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'fusionar_clientes'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
