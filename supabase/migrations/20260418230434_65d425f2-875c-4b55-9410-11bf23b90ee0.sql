-- 1. Ampliar tabla settings con columnas de configuración
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS initial_cash_ars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS large_sale_threshold_ars numeric NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS margin_alert_percent numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS expense_ratio_alert_percent numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS overdue_check_window_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS cash_flow_warning_threshold_ars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_categories jsonb NOT NULL DEFAULT '["alquiler","servicios","marketing","sueldos","logistica","impuestos","otros"]'::jsonb,
  ADD COLUMN IF NOT EXISTS pasero_commission_percent numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS usd_rate_oficial numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_blue numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_mep numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_updated_at timestamp with time zone;

-- 2. Compras programadas
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS scheduled_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS is_scheduled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_purchases_scheduled ON public.purchases(user_id, scheduled_date) WHERE is_scheduled = true;

-- 3. Refactor: notify_low_stock lee threshold desde settings
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  threshold integer;
BEGIN
  SELECT COALESCE(low_stock_threshold, 3) INTO threshold
  FROM public.settings WHERE user_id = NEW.user_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 3; END IF;

  IF NEW.stock <= threshold AND (OLD.stock IS NULL OR OLD.stock > threshold) THEN
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
$function$;

-- 4. Refactor: notify_large_sale lee threshold desde settings
CREATE OR REPLACE FUNCTION public.notify_large_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  threshold numeric;
BEGIN
  SELECT COALESCE(large_sale_threshold_ars, 50000) INTO threshold
  FROM public.settings WHERE user_id = NEW.user_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 50000; END IF;

  IF NEW.total_ars >= threshold THEN
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
$function$;

-- 5. Refactor: check_overdue_debts usa ventana configurable por usuario
CREATE OR REPLACE FUNCTION public.check_overdue_debts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD;
  window_hours integer;
BEGIN
  FOR d IN 
    SELECT dt.id, dt.user_id, dt.customer_name, dt.amount_ars, dt.due_date,
           COALESCE(s.overdue_check_window_hours, 24) AS uw
    FROM public.debts dt
    LEFT JOIN public.settings s ON s.user_id = dt.user_id
    WHERE dt.status IN ('pending','partial')
      AND dt.due_date IS NOT NULL
      AND dt.due_date < now()
  LOOP
    window_hours := d.uw;
    IF d.due_date > now() - make_interval(hours => window_hours) THEN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        d.user_id,
        'Deuda vencida: ' || d.customer_name,
        'Monto: $' || ROUND(d.amount_ars) || ' ARS — Venció ' || to_char(d.due_date, 'DD/MM/YYYY'),
        'deuda_vencida',
        'debt',
        d.id::text
      );
    END IF;
  END LOOP;
END;
$function$;

-- 6. Asegurar triggers existentes
DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
AFTER UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();

DROP TRIGGER IF EXISTS trg_notify_large_sale ON public.sales;
CREATE TRIGGER trg_notify_large_sale
AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.notify_large_sale();

-- 7. Reparación legacy: marcar como pagadas todas las ventas cuyas deudas están en status='paid'
UPDATE public.sales s
SET paid = true
FROM public.debts d
WHERE d.sale_id = s.id
  AND d.status = 'paid'
  AND s.paid = false;

-- 8. Bucket de backups
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas: solo admins pueden ver/descargar/borrar backups dentro de su carpeta user_id
DROP POLICY IF EXISTS "Admin read own backups" ON storage.objects;
CREATE POLICY "Admin read own backups" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admin write own backups" ON storage.objects;
CREATE POLICY "Admin write own backups" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admin delete own backups" ON storage.objects;
CREATE POLICY "Admin delete own backups" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Permitir que el service role (edge functions) pueda escribir backups (bypassa RLS naturalmente)
-- 9. Habilitar pg_cron y pg_net para jobs programados
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;