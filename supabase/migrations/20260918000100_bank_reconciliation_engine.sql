-- supabase/migrations/20260918000100_bank_reconciliation_engine.sql

-- Create bank accounts table for storing external bank account connections
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  bank_cbu text NOT NULL,
  bank_alias text,
  bank_holder text NOT NULL,
  is_primary boolean DEFAULT false,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  connection_type text DEFAULT 'direct' CHECK (connection_type IN ('direct', 'oauth', 'csv')),
  last_connection date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

-- Create policy for organization members to read their own bank accounts
CREATE POLICY "bank_accounts_org_select" ON public.bank_accounts
  FOR SELECT USING (org_id = auth.uid()::uuid);

-- Create policy for organization staff to manage bank accounts
CREATE POLICY "bank_accounts_org_manage" ON public.bank_accounts
  FOR ALL USING (org_id = auth.uid()::uuid);

-- Create bank statements table for storing imported bank statements
CREATE TABLE IF NOT EXISTS public.bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  statement_date date NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  sha256_hash text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'imported', 'error')),
  import_attempts integer DEFAULT 0,
  last_import_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

-- Create policy for organization members to read their own bank statements
CREATE POLICY "bank_statements_org_select" ON public.bank_statements
  FOR SELECT USING (org_id = auth.uid()::uuid);

-- Create policy for organization staff to manage bank statements
CREATE POLICY "bank_statements_org_manage" ON public.bank_statements
  FOR ALL USING (org_id = auth.uid()::uuid);

-- Create bank matches table for conciliation results
CREATE TABLE IF NOT EXISTS public.bank_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_transaction_id uuid, -- Reference to raw bank transaction if needed
  ecommerce_transaction_id uuid, -- Reference to expense or sale transaction
  match_type text DEFAULT 'exact' CHECK (match_type IN ('exact', 'partial', 'approximate')),
  bank_amount numeric NOT NULL,
  bank_date date NOT NULL,
  ecommerce_amount numeric,
  ecommerce_date date,
  confidence_score numeric DEFAULT 100 CHECK (confidence_score BETWEEN 0 AND 100),
  match_status text DEFAULT 'pending' CHECK (match_status IN ('pending', 'confirmed', 'rejected')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_matches ENABLE ROW LEVEL SECURITY;

-- Create policy for organization members to read their own matches
CREATE POLICY "bank_matches_org_select" ON public.bank_matches
  FOR SELECT USING (org_id = auth.uid()::uuid);

-- Create policy for organization staff to manage matches
CREATE POLICY "bank_matches_org_manage" ON public.bank_matches
  FOR ALL USING (org_id = auth.uid()::uuid);

-- Create bank reconciliation summary table
CREATE TABLE IF NOT EXISTS public.bank_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  statement_end_date date,
  total_bank_amount numeric DEFAULT 0,
  total_ecommerce_amount numeric DEFAULT 0,
  difference numeric DEFAULT 0,
  matched_count integer DEFAULT 0,
  unmatched_bank_count integer DEFAULT 0,
  unmatched_ecommerce_count integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'error')),
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_reconciliation ENABLE ROW LEVEL SECURITY;

-- Create policy for organization members to read their own reconciliation
CREATE POLICY "bank_reconciliation_org_select" ON public.bank_reconciliation
  FOR SELECT USING (org_id = auth.uid()::uuid);

-- Create policy for organization staff to manage reconciliation
CREATE POLICY "bank_reconciliation_org_manage" ON public.bank_reconciliation
  FOR ALL USING (org_id = auth.uid()::uuid);

-- Create function to initialize a new reconciliation
CREATE OR REPLACE FUNCTION public.initiate_bank_reconciliation(
  p_org_id uuid,
  p_statement_date date,
  p_statement_end_date date
)
RETURNS uuid AS $$
DECLARE
  reconciliation_id uuid;
BEGIN
  INSERT INTO public.bank_reconciliation (
    org_id,
    statement_date,
    statement_end_date,
    status
  ) VALUES (
    p_org_id,
    p_statement_date,
    p_statement_end_date,
    'pending'
  )
  RETURNING id INTO reconciliation_id;

  RETURN reconciliation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to add a bank statement
CREATE OR REPLACE FUNCTION public.add_bank_statement(
  p_org_id uuid,
  p_bank_account_id uuid,
  p_statement_date date,
  p_file_name text,
  p_file_size integer,
  p_sha256_hash text
)
RETURNS uuid AS $$
DECLARE
  statement_id uuid;
BEGIN
  INSERT INTO public.bank_statements (
    org_id,
    bank_account_id,
    statement_date,
    file_name,
    file_size,
    sha256_hash,
    status
  ) VALUES (
    p_org_id,
    p_bank_account_id,
    p_statement_date,
    p_file_name,
    p_file_size,
    p_sha256_hash,
    'pending'
  )
  RETURNING id INTO statement_id;

  RETURN statement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to mark a statement as processed
CREATE OR REPLACE FUNCTION public.mark_statement_processed(
  p_statement_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE public.bank_statements
  SET status = 'processed',
      last_import_at = now(),
      updated_at = now()
  WHERE id = p_statement_id;
END;
$$ LANGUAGE sql SECURITY DEFINER;

-- Create function to create a bank match
CREATE OR REPLACE FUNCTION public.create_bank_match(
  p_org_id uuid,
  p_bank_transaction_id uuid,
  p_ecommerce_transaction_id uuid,
  p_match_type text,
  p_bank_amount numeric,
  p_bank_date date,
  p_ecommerce_amount numeric,
  p_ecommerce_date date,
  p_confidence_score numeric DEFAULT 100
)
RETURNS uuid AS $$
DECLARE
  match_id uuid;
BEGIN
  INSERT INTO public.bank_matches (
    org_id,
    bank_transaction_id,
    ecommerce_transaction_id,
    match_type,
    bank_amount,
    bank_date,
    ecommerce_amount,
    ecommerce_date,
    confidence_score
  ) VALUES (
    p_org_id,
    p_bank_transaction_id,
    p_ecommerce_transaction_id,
    p_match_type,
    p_bank_amount,
    p_bank_date,
    p_ecommerce_amount,
    p_ecommerce_date,
    p_confidence_score
  )
  RETURNING id INTO match_id;

  RETURN match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update match status
CREATE OR REPLACE FUNCTION public.update_match_status(
  p_match_id uuid,
  p_match_status text,
  p_notes text
)
RETURNS void AS $$
BEGIN
  UPDATE public.bank_matches
  SET match_status = p_match_status,
      notes = p_notes,
      updated_at = now()
  WHERE id = p_match_id;
END;
$$ LANGUAGE sql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.initiate_bank_reconciliation TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_bank_statement TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_statement_processed TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bank_match TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_status TO authenticated;