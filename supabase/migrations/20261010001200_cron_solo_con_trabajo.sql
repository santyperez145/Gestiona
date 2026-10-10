-- Cron sólo cuando hay trabajo.
--
-- Medido 2026-10-10 (pg_stat_statements): invoke_edge_function 23.651 llamadas
-- (1.512 s), outbox_despachar 16.420 (583 s), outbox_confirmar 16.420 (279 s)
-- y la poda de net._http_response 45.110 (601 s). Tres jobs corrían cada
-- minuto aunque no hubiera nada que hacer: reconcile-pos-qr-orders llamaba a
-- la Edge sin cobros QR vivos, outbox_despachar descifraba tres secretos del
-- vault antes de mirar la cola y campaign-chat-dispatcher se invocaba sin
-- notificaciones pendientes. Cada llamada HTTP además deja una fila que pg_net
-- después tiene que podar.
--
-- Cada comando queda condicionado a un EXISTS sobre el índice parcial de su
-- cola: con la cola vacía el job cuesta una lectura de índice. El
-- comportamiento con trabajo pendiente no cambia.

DO $$
DECLARE
  v_jobs jsonb := jsonb_build_object(
    'outbox-despachar',
      $c$SELECT public.outbox_despachar(100) WHERE EXISTS (SELECT 1 FROM public.outbox_events WHERE estado IN ('pendiente', 'fallado', 'en_curso'))$c$,
    'outbox-confirmar',
      $c$SELECT public.outbox_confirmar() WHERE EXISTS (SELECT 1 FROM public.outbox_events WHERE estado = 'en_curso')$c$,
    'reconcile-pos-qr-orders',
      $c$SELECT public.invoke_edge_function('mercadopago-pos-qr') WHERE EXISTS (SELECT 1 FROM public.pos_qr_sessions WHERE state IN ('preparing', 'pending', 'accredited', 'finalizing'))$c$,
    'campaign-chat-dispatcher',
      $c$SELECT public.invoke_edge_function('campaign-chat-dispatcher') WHERE EXISTS (SELECT 1 FROM public.influencer_chat_notifications WHERE status = 'pending' AND created_at > now() - interval '3 days')$c$,
    'avisos-por-correo',
      $c$SELECT public.invoke_edge_function('avisos-por-correo') WHERE EXISTS (SELECT 1 FROM public.notifications WHERE enviar_por_correo AND email_enviado_at IS NULL)$c$
  );
  v_nombre text;
  v_id bigint;
BEGIN
  FOR v_nombre IN SELECT jsonb_object_keys(v_jobs) LOOP
    SELECT jobid INTO v_id FROM cron.job WHERE jobname = v_nombre;
    IF v_id IS NOT NULL THEN
      PERFORM cron.alter_job(v_id, command := v_jobs->>v_nombre);
    END IF;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS influencer_chat_notifications_pendientes_idx
  ON public.influencer_chat_notifications (created_at) WHERE status = 'pending';
