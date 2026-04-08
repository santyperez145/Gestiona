
-- 1. Allow anonymous users to read settings (needed for public catalog)
CREATE POLICY "Public read settings for catalog"
ON public.settings FOR SELECT TO anon
USING (true);

-- 2. Clean up duplicate roles: keep only the latest one per user
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.id < b.id;

-- 3. Drop existing unique constraint if any, then add one to prevent future duplicates
DO $$
BEGIN
  -- Drop the old unique constraint on (user_id, role) if it exists
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_role_key') THEN
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_user_id_role_key;
  END IF;
END $$;

-- Add unique constraint on user_id only (one role per user)
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);
