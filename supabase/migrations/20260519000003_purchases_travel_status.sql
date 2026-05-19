-- Add travel_status to purchases: pedido / en_camino / recibido
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS travel_status TEXT NOT NULL DEFAULT 'pedido'
    CHECK (travel_status IN ('pedido', 'en_camino', 'recibido'));

-- Existing scheduled purchases that haven't been received remain 'pedido'
-- Already received ones should be 'recibido'
UPDATE public.purchases SET travel_status = 'recibido' WHERE is_scheduled = false;
