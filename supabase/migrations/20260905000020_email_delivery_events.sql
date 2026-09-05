-- Durable, idempotent lifecycle for provider email events.

ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS provider_created_at timestamptz;

ALTER TABLE public.email_events
  DROP CONSTRAINT IF EXISTS email_events_event_type_check;

ALTER TABLE public.email_events
  ADD CONSTRAINT email_events_event_type_check
  CHECK (event_type IN (
    'sent', 'delivery', 'delayed', 'failed', 'bounce', 'suppressed',
    'complaint', 'open', 'click', 'unsubscribe'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS email_events_provider_event_uidx
  ON public.email_events(provider_event_id)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounce_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complaint_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_email_provider_event(
  p_provider_event_id text,
  p_org_id uuid,
  p_campaign_id uuid,
  p_event_type text,
  p_recipient_email text,
  p_link_url text,
  p_provider_message_id text,
  p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_id uuid;
  safe_campaign_id uuid;
BEGIN
  IF NULLIF(trim(p_provider_event_id), '') IS NULL
     OR p_org_id IS NULL
     OR p_event_type NOT IN (
       'sent', 'delivery', 'delayed', 'failed', 'bounce', 'suppressed',
       'complaint', 'open', 'click', 'unsubscribe'
     ) THEN
    RAISE EXCEPTION 'invalid provider email event';
  END IF;

  SELECT id INTO safe_campaign_id
  FROM public.email_campaigns
  WHERE id = p_campaign_id AND org_id = p_org_id;

  INSERT INTO public.email_events (
    org_id, campaign_id, event_type, recipient_email, link_url,
    resend_email_id, occurred_at, provider_event_id, provider_created_at
  ) VALUES (
    p_org_id, safe_campaign_id, p_event_type, lower(NULLIF(trim(p_recipient_email), '')),
    NULLIF(trim(p_link_url), ''), NULLIF(trim(p_provider_message_id), ''),
    COALESCE(p_occurred_at, now()), p_provider_event_id, p_occurred_at
  )
  ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RETURN false;
  END IF;

  IF safe_campaign_id IS NOT NULL THEN
    UPDATE public.email_campaigns
    SET
      open_count = open_count + CASE WHEN p_event_type = 'open' THEN 1 ELSE 0 END,
      click_count = click_count + CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
      unsubscribe_count = unsubscribe_count + CASE WHEN p_event_type = 'unsubscribe' THEN 1 ELSE 0 END,
      delivered_count = delivered_count + CASE WHEN p_event_type = 'delivery' THEN 1 ELSE 0 END,
      bounce_count = bounce_count + CASE WHEN p_event_type IN ('bounce', 'suppressed') THEN 1 ELSE 0 END,
      complaint_count = complaint_count + CASE WHEN p_event_type = 'complaint' THEN 1 ELSE 0 END
    WHERE id = safe_campaign_id AND org_id = p_org_id;
  END IF;

  IF p_event_type IN ('bounce', 'suppressed', 'complaint', 'unsubscribe')
     AND NULLIF(trim(p_recipient_email), '') IS NOT NULL THEN
    INSERT INTO public.email_unsubscribes (org_id, email, unsubscribed_at)
    VALUES (p_org_id, lower(trim(p_recipient_email)), COALESCE(p_occurred_at, now()))
    ON CONFLICT (org_id, email) DO UPDATE
      SET unsubscribed_at = LEAST(public.email_unsubscribes.unsubscribed_at, EXCLUDED.unsubscribed_at);
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_provider_event(text, uuid, uuid, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_provider_event(text, uuid, uuid, text, text, text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_email_provider_event(text, uuid, uuid, text, text, text, text, timestamptz)
  IS 'Service-only, idempotent email webhook ingest with atomic campaign counters and suppression handling.';
