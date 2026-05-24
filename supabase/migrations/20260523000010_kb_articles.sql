-- Knowledge Base Articles
-- Gestiona ERP/CRM — Salesforce Knowledge equivalent

CREATE TABLE IF NOT EXISTS kb_articles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  slug          text        NOT NULL,
  category      text        NOT NULL DEFAULT 'General',
  content       text        NOT NULL,
  tags          text[],
  visibility    text        NOT NULL DEFAULT 'internal'
                            CHECK (visibility IN ('internal', 'public')),
  published     boolean     NOT NULL DEFAULT false,
  view_count    int         NOT NULL DEFAULT 0,
  helpful_count int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_org      ON kb_articles(org_id, published, category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_tags     ON kb_articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_kb_articles_fulltext ON kb_articles USING GIN (to_tsvector('spanish', title || ' ' || content));

-- Increment helpful count safely
CREATE OR REPLACE FUNCTION increment_kb_helpful(article_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE kb_articles SET helpful_count = helpful_count + 1 WHERE id = article_id;
END;
$$;

-- Increment view count
CREATE OR REPLACE FUNCTION increment_kb_views(article_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE kb_articles SET view_count = view_count + 1 WHERE id = article_id;
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_kb_article_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_kb_articles_updated ON kb_articles;
CREATE TRIGGER trg_kb_articles_updated
  BEFORE UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_kb_article_timestamp();

-- RLS
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_kb_articles" ON kb_articles;
CREATE POLICY "org_kb_articles" ON kb_articles
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
