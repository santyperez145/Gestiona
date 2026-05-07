-- Recurring expenses: frequency + next_due_date + last_auto_created_at
-- The 'recurring' boolean column already exists on the expenses table.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurring_frequency text
    CHECK (recurring_frequency IN ('daily','weekly','monthly','yearly'))
    DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS recurring_next_date  date,
  ADD COLUMN IF NOT EXISTS last_auto_created_at timestamptz;

-- Index for efficient lookup in the edge function
CREATE INDEX IF NOT EXISTS expenses_recurring_next
  ON public.expenses(org_id, recurring_next_date)
  WHERE recurring = true AND recurring_next_date IS NOT NULL;

-- Back-fill recurring_next_date for existing recurring expenses
-- Set it to 1st of next month if not already set
UPDATE public.expenses
SET
  recurring_frequency  = COALESCE(recurring_frequency, 'monthly'),
  recurring_next_date  = date_trunc('month', created_at::date + interval '1 month')::date
WHERE recurring = true
  AND recurring_next_date IS NULL;
