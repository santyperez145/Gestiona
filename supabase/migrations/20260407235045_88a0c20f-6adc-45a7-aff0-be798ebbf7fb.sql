
-- Create notifications table
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'sistema',
  read boolean NOT NULL DEFAULT false,
  entity_type text,
  entity_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notifications" ON public.notifications
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Index for fast queries
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, read, created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Function: auto-create low stock notification when product stock changes
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock <= 3 AND (OLD.stock IS NULL OR OLD.stock > 3) THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Stock bajo: ' || NEW.name,
      CASE WHEN NEW.stock = 0 THEN 'Sin stock disponible'
           ELSE 'Solo quedan ' || NEW.stock || ' unidades'
      END,
      'stock_bajo',
      'product',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_low_stock
AFTER UPDATE OF stock ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.notify_low_stock();

-- Function: notify on large sale (> $50,000 ARS)
CREATE OR REPLACE FUNCTION public.notify_large_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.total_ars >= 50000 THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Venta grande registrada',
      NEW.product_name || ' x' || NEW.quantity || ' — $' || ROUND(NEW.total_ars) || ' ARS',
      'venta_grande',
      'sale',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_large_sale
AFTER INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.notify_large_sale();

-- Function: notify overdue debts (triggered manually or via cron)
CREATE OR REPLACE FUNCTION public.check_overdue_debts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
BEGIN
  FOR d IN 
    SELECT id, user_id, customer_name, amount_ars, due_date
    FROM public.debts
    WHERE status = 'pending' AND due_date < now() AND due_date > now() - interval '1 day'
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      d.user_id,
      'Deuda vencida: ' || d.customer_name,
      'Monto: $' || ROUND(d.amount_ars) || ' ARS — Venció ' || to_char(d.due_date, 'DD/MM/YYYY'),
      'deuda_vencida',
      'debt',
      d.id::text
    );
  END LOOP;
END;
$$;
