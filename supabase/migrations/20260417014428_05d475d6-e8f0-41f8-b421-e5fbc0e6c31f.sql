-- Tabla de gastos operativos
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  amount_ars NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'otros',
  description TEXT,
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages expenses"
ON public.expenses
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text))
WITH CHECK ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text));

CREATE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_expenses_user_date ON public.expenses(user_id, date DESC);

-- Tabla de notas por cliente
CREATE TABLE public.customer_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  customer_name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, customer_name)
);

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages customer notes"
ON public.customer_notes
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text))
WITH CHECK ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text));

CREATE TRIGGER update_customer_notes_updated_at
BEFORE UPDATE ON public.customer_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();