-- Realtime para la bandeja de solicitudes de Finance (paridad Mendel).
-- La tabla vive en la publicación supabase_realtime para que postgres_changes
-- la difunda; sin esto el canal se suscribe y nunca llega un evento.
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_expense_requests;
