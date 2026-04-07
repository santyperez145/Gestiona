
CREATE POLICY "Public can read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public can read settings" ON public.settings FOR SELECT USING (true);
