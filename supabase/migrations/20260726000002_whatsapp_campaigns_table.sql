-- ============================================================================
-- whatsapp_campaigns + columnas de payment_links (nunca aplicadas a prod)
-- ============================================================================
-- La migración original (20260522000001) nunca se aplicó y además tiene un bug:
-- usa `$$` anidados dentro de un bloque `do $$ ... $$` para programar el cron,
-- lo que rompe el parseo ("syntax error at or near select"). Acá se aplica lo
-- esencial de schema; el cron de campañas programadas queda fuera (es una
-- automatización opcional que depende de pg_cron + app.supabase_url).
-- Sin esta tabla, WhatsAppCampaignsPage falla en runtime.

CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message       text NOT NULL,
  segment       text NOT NULL DEFAULT 'all',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')),
  sent_count    int  NOT NULL DEFAULT 0,
  failed_count  int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can manage whatsapp_campaigns" ON public.whatsapp_campaigns;
CREATE POLICY "org members can manage whatsapp_campaigns"
  ON public.whatsapp_campaigns FOR ALL
  USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

CREATE INDEX IF NOT EXISTS whatsapp_campaigns_org_id_idx ON public.whatsapp_campaigns(org_id);

-- payment_links: columnas que la app usa para checkout de Mercado Pago
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS customer_email   text,
  ADD COLUMN IF NOT EXISTS mp_preference_id text,
  ADD COLUMN IF NOT EXISTS external_ref     text;

CREATE INDEX IF NOT EXISTS payment_links_external_ref_idx
  ON public.payment_links(org_id, external_ref)
  WHERE external_ref IS NOT NULL;
