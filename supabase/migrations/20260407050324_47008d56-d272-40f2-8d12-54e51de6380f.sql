CREATE TABLE public.influencer_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  influencer_name TEXT NOT NULL,
  influencer_instagram TEXT,
  influencer_followers INTEGER DEFAULT 0,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  product_value_ars NUMERIC NOT NULL DEFAULT 0,
  exchange_type TEXT NOT NULL DEFAULT 'canje',
  status TEXT NOT NULL DEFAULT 'pendiente',
  expected_posts INTEGER DEFAULT 1,
  actual_posts INTEGER DEFAULT 0,
  notes TEXT,
  delivery_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.influencer_exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchanges"
  ON public.influencer_exchanges FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_influencer_exchanges_updated_at
  BEFORE UPDATE ON public.influencer_exchanges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();