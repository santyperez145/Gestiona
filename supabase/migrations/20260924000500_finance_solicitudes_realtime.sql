-- Realtime para la bandeja de solicitudes de Finance (paridad Mendel).
-- La tabla vive en la publicación supabase_realtime para que postgres_changes
-- la difunda; sin esto el canal se suscribe y nunca llega un evento.
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_expense_requests;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000500', 'finance_expense_requests_realtime')
ON CONFLICT DO NOTHING;