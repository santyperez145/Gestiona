
-- ========= COUPONS TABLE =========
CREATE TABLE public.coupons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  code TEXT NOT NULL,
  discount_percent NUMERIC DEFAULT 0,
  discount_fixed_ars NUMERIC DEFAULT 0,
  max_uses INTEGER DEFAULT NULL,
  current_uses INTEGER NOT NULL DEFAULT 0,
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_user_unique UNIQUE (user_id, code)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages coupons"
  ON public.coupons FOR ALL
  TO authenticated
  USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
  WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Anon can read active coupons"
  ON public.coupons FOR SELECT
  TO anon
  USING (active = true);

CREATE POLICY "Authenticated can read own coupons"
  ON public.coupons FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ========= SELLER GOALS TABLE =========
CREATE TABLE public.seller_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  month DATE NOT NULL,
  target_ars NUMERIC NOT NULL DEFAULT 0,
  commission_percent NUMERIC NOT NULL DEFAULT 0,
  total_sales_ars NUMERIC NOT NULL DEFAULT 0,
  total_commission_ars NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT seller_goals_user_month_unique UNIQUE (user_id, month)
);

ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages all seller goals"
  ON public.seller_goals FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin' AND auth.uid() = owner_id)
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND auth.uid() = owner_id);

CREATE POLICY "Sellers can view own goals"
  ON public.seller_goals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ========= ADD coupon_id TO SALES =========
ALTER TABLE public.sales ADD COLUMN coupon_id UUID DEFAULT NULL;
