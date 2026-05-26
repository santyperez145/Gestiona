-- Social Media Content Planner

CREATE TABLE IF NOT EXISTS social_posts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  content         text        NOT NULL,
  media_urls      text[]      NOT NULL DEFAULT '{}',
  platforms       text[]      NOT NULL DEFAULT '{instagram}',
  -- platforms values: instagram, facebook, tiktok, twitter, linkedin, whatsapp_status
  hashtags        text[]      NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','scheduled','published','cancelled')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  post_type       text        NOT NULL DEFAULT 'post'
                              CHECK (post_type IN ('post','story','reel','carousel','thread')),
  campaign_name   text,
  target_audience text,
  cta_text        text,
  cta_url         text,
  notes           text,
  -- Engagement metrics (filled after publishing)
  views           int         NOT NULL DEFAULT 0,
  likes           int         NOT NULL DEFAULT 0,
  comments        int         NOT NULL DEFAULT 0,
  shares          int         NOT NULL DEFAULT 0,
  clicks          int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hashtag_sets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  hashtags        text[]      NOT NULL DEFAULT '{}',
  platform        text        NOT NULL DEFAULT 'instagram',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_ideas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idea            text        NOT NULL,
  category        text        NOT NULL DEFAULT 'producto',
  priority        int         NOT NULL DEFAULT 0,
  converted_to_post boolean   NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at
CREATE OR REPLACE FUNCTION update_social_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_social_updated ON social_posts;
CREATE TRIGGER trg_social_updated BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_social_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_posts_org ON social_posts(org_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_hashtag_sets ON hashtag_sets(org_id);
CREATE INDEX IF NOT EXISTS idx_content_ideas ON content_ideas(org_id, priority DESC);

-- RLS
ALTER TABLE social_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hashtag_sets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ideas   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_social_posts"  ON social_posts;
DROP POLICY IF EXISTS "org_hashtag_sets"  ON hashtag_sets;
DROP POLICY IF EXISTS "org_content_ideas" ON content_ideas;

CREATE POLICY "org_social_posts"  ON social_posts
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_hashtag_sets"  ON hashtag_sets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_content_ideas" ON content_ideas
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
