-- Realtime por Broadcast desde la base, en canales privados.
--
-- Medido 2026-10-10 en pg_stat_statements: la lectura del WAL de Realtime
-- (Postgres Changes) sumaba 6.652 s en 760 mil llamadas, más que todo el resto
-- de la base junto. La publicación tenía products y audit_logs —las tablas
-- más escritas— y cada cambio se evaluaba contra las políticas RLS de cada
-- suscriptor. A la vez, la app escuchaba sales, stock_movements, debts,
-- email_campaigns e integration_logs, que NO estaban publicadas: esas
-- suscripciones daban error y nunca recibían nada. El catálogo público
-- escuchaba todos los productos de todas las organizaciones sin filtro.
--
-- Ahora:
-- * Triggers POR SENTENCIA (con tablas de transición) mandan un aviso por
--   organización y operación con realtime.send: una importación de 11.000
--   filas es un mensaje, no 11.000.
-- * Topics privados: org:<org_id> (miembros de la organización),
--   user:<user_id> (el propio usuario) y plataforma:soporte (staff).
--   La política sobre realtime.messages decide quién escucha.
-- * Un fallo de Realtime nunca rompe la escritura que lo originó.
-- * La publicación supabase_realtime queda sin tablas: no hay más lectura del
--   WAL para Postgres Changes.

-- ── Quién escucha cada topic ───────────────────────────────────────────────
-- realtime.messages ya tiene RLS activo (lo administra Supabase); acá sólo se agregan políticas.

DROP POLICY IF EXISTS "Nerqia escucha sus topics" ON realtime.messages;
CREATE POLICY "Nerqia escucha sus topics" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND (
      (realtime.topic() ~ '^org:[0-9a-f-]{36}$'
        AND public.is_org_member(substr(realtime.topic(), 5)::uuid, auth.uid()))
      OR realtime.topic() = 'user:' || auth.uid()::text
      OR (realtime.topic() = 'plataforma:soporte'
        AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()))
    )
  );

-- Presencia (quién está conectado) en el topic de la organización.
DROP POLICY IF EXISTS "Nerqia presencia en su organización" ON realtime.messages;
CREATE POLICY "Nerqia presencia en su organización" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'presence'
    AND realtime.topic() ~ '^org:[0-9a-f-]{36}$'
    AND public.is_org_member(substr(realtime.topic(), 5)::uuid, auth.uid())
  );

-- ── Envío seguro ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rt_enviar(p_topic text, p_evento text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(COALESCE(p_payload, '{}'::jsonb), p_evento, p_topic, true);
EXCEPTION WHEN OTHERS THEN
  -- Realtime es un aviso: si falla, la venta o el cambio igual se guardan.
  RAISE LOG 'rt_enviar % %: %', p_topic, p_evento, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.rt_enviar(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Aviso genérico por organización: TG_ARGV[0] = evento. Sin datos de filas:
-- la pantalla vuelve a leer lo que necesita con sus permisos.
CREATE OR REPLACE FUNCTION public.rt_aviso_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT org_id, count(*) n FROM filas_viejas WHERE org_id IS NOT NULL GROUP BY org_id LOOP
      PERFORM public.rt_enviar('org:' || r.org_id, TG_ARGV[0], jsonb_build_object('op', TG_OP, 'cantidad', r.n));
    END LOOP;
  ELSE
    FOR r IN SELECT org_id, count(*) n FROM filas_nuevas WHERE org_id IS NOT NULL GROUP BY org_id LOOP
      PERFORM public.rt_enviar('org:' || r.org_id, TG_ARGV[0], jsonb_build_object('op', TG_OP, 'cantidad', r.n));
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- Ventas: hasta 20 renglones del lote para el feed, el dashboard y el aviso.
CREATE OR REPLACE FUNCTION public.rt_aviso_ventas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT org_id, count(*) n, sum(total_ars) total,
      (jsonb_agg(jsonb_build_object('id', id, 'product_name', product_name, 'customer_name', customer_name,
        'total_ars', total_ars, 'date', date, 'created_at', created_at) ORDER BY created_at DESC))
        AS filas
    FROM filas_nuevas WHERE org_id IS NOT NULL GROUP BY org_id
  LOOP
    PERFORM public.rt_enviar('org:' || r.org_id, 'venta', jsonb_build_object(
      'cantidad', r.n, 'total', r.total,
      'ventas', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(r.filas) e LIMIT 20) x)));
  END LOOP;
  RETURN NULL;
END;
$$;

-- Productos que bajaron de stock (para las alertas): viejo y nuevo, hasta 50.
CREATE OR REPLACE FUNCTION public.rt_aviso_stock_productos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.org_id, jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'antes', o.stock, 'ahora', n.stock)) AS bajas
    FROM filas_nuevas n JOIN filas_viejas o ON o.id = n.id
    WHERE n.stock < o.stock AND n.stock <= 10 AND COALESCE(n.maneja_stock, true)
    GROUP BY n.org_id
  LOOP
    PERFORM public.rt_enviar('org:' || r.org_id, 'stock_bajo', jsonb_build_object(
      'productos', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(r.bajas) e LIMIT 50) x)));
  END LOOP;
  RETURN NULL;
END;
$$;

-- Notificaciones: al topic del usuario, con las filas (máx. 30).
CREATE OR REPLACE FUNCTION public.rt_aviso_notificaciones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id, jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC) filas FROM filas_nuevas f WHERE user_id IS NOT NULL GROUP BY user_id LOOP
    PERFORM public.rt_enviar('user:' || r.user_id, 'notificacion', jsonb_build_object(
      'notificaciones', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(r.filas) e LIMIT 30) x)));
  END LOOP;
  RETURN NULL;
END;
$$;

-- Campañas de email: métricas actualizadas (máx. 20 filas).
CREATE OR REPLACE FUNCTION public.rt_aviso_campanas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT org_id, jsonb_agg(to_jsonb(f)) filas FROM filas_nuevas f WHERE org_id IS NOT NULL GROUP BY org_id LOOP
    PERFORM public.rt_enviar('org:' || r.org_id, 'campana', jsonb_build_object(
      'campanas', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(r.filas) e LIMIT 20) x)));
  END LOOP;
  RETURN NULL;
END;
$$;

-- Soporte: la organización del hilo y el staff de plataforma.
CREATE OR REPLACE FUNCTION public.rt_aviso_soporte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF TG_TABLE_NAME = 'platform_support_messages' THEN
    FOR r IN SELECT DISTINCT t.org_id, m.thread_id FROM filas_nuevas m JOIN public.platform_support_threads t ON t.id = m.thread_id LOOP
      PERFORM public.rt_enviar('org:' || r.org_id, 'soporte', jsonb_build_object('thread_id', r.thread_id));
      PERFORM public.rt_enviar('plataforma:soporte', 'soporte', jsonb_build_object('thread_id', r.thread_id));
    END LOOP;
  ELSE
    FOR r IN SELECT DISTINCT org_id FROM filas_nuevas WHERE org_id IS NOT NULL LOOP
      PERFORM public.rt_enviar('org:' || r.org_id, 'soporte', '{}'::jsonb);
    END LOOP;
    PERFORM public.rt_enviar('plataforma:soporte', 'soporte', '{}'::jsonb);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rt_aviso_org(), public.rt_aviso_ventas(), public.rt_aviso_stock_productos(),
  public.rt_aviso_notificaciones(), public.rt_aviso_campanas(), public.rt_aviso_soporte()
  FROM PUBLIC, anon, authenticated;

-- ── Triggers por sentencia ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS rt_ventas ON public.sales;
CREATE TRIGGER rt_ventas AFTER INSERT ON public.sales
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_ventas();

DROP TRIGGER IF EXISTS rt_stock_movimientos ON public.stock_movements;
CREATE TRIGGER rt_stock_movimientos AFTER INSERT ON public.stock_movements
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_org('stock');

DROP TRIGGER IF EXISTS rt_productos_stock ON public.products;
CREATE TRIGGER rt_productos_stock AFTER UPDATE ON public.products
  REFERENCING OLD TABLE AS filas_viejas NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_stock_productos();

DROP TRIGGER IF EXISTS rt_deudas ON public.debts;
CREATE TRIGGER rt_deudas AFTER INSERT ON public.debts
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_org('deuda');

DROP TRIGGER IF EXISTS rt_notificaciones ON public.notifications;
CREATE TRIGGER rt_notificaciones AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_notificaciones();

DROP TRIGGER IF EXISTS rt_campanas ON public.email_campaigns;
CREATE TRIGGER rt_campanas AFTER UPDATE ON public.email_campaigns
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_campanas();

DROP TRIGGER IF EXISTS rt_integraciones ON public.integration_logs;
CREATE TRIGGER rt_integraciones AFTER INSERT ON public.integration_logs
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_org('integracion');

DROP TRIGGER IF EXISTS rt_solicitudes_ins ON public.finance_expense_requests;
CREATE TRIGGER rt_solicitudes_ins AFTER INSERT ON public.finance_expense_requests
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_org('solicitud');
DROP TRIGGER IF EXISTS rt_solicitudes_upd ON public.finance_expense_requests;
CREATE TRIGGER rt_solicitudes_upd AFTER UPDATE ON public.finance_expense_requests
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_org('solicitud');

DROP TRIGGER IF EXISTS rt_soporte_hilos_ins ON public.platform_support_threads;
CREATE TRIGGER rt_soporte_hilos_ins AFTER INSERT ON public.platform_support_threads
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_soporte();
DROP TRIGGER IF EXISTS rt_soporte_hilos_upd ON public.platform_support_threads;
CREATE TRIGGER rt_soporte_hilos_upd AFTER UPDATE ON public.platform_support_threads
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_soporte();
DROP TRIGGER IF EXISTS rt_soporte_mensajes ON public.platform_support_messages;
CREATE TRIGGER rt_soporte_mensajes AFTER INSERT ON public.platform_support_messages
  REFERENCING NEW TABLE AS filas_nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_soporte();

-- ── Sin Postgres Changes ───────────────────────────────────────────────────
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', t.schemaname, t.tablename);
  END LOOP;
END;
$$;
