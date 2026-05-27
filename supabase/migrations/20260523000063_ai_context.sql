-- AI Context & Advanced Chat sessions

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Nueva conversación',
  model           text        NOT NULL DEFAULT 'claude-3-5-sonnet',
  system_prompt   text,
  context_window  int         NOT NULL DEFAULT 32000,
  temperature     numeric(3,2) NOT NULL DEFAULT 0.7,
  message_count   int         NOT NULL DEFAULT 0,
  total_tokens    int         NOT NULL DEFAULT 0,
  is_pinned       boolean     NOT NULL DEFAULT false,
  is_archived     boolean     NOT NULL DEFAULT false,
  tags            text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content         text        NOT NULL,
  tool_name       text,
  tool_input      jsonb,
  tool_result     jsonb,
  tokens_used     int         NOT NULL DEFAULT 0,
  model           text,
  finish_reason   text,
  is_error        boolean     NOT NULL DEFAULT false,
  parent_id       uuid        REFERENCES ai_chat_messages(id) ON DELETE SET NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_prompts_library (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  prompt          text        NOT NULL,
  category        text        NOT NULL DEFAULT 'general' CHECK (category IN ('sales','inventory','finance','marketing','hr','general','analysis','templates')),
  tags            text[]      NOT NULL DEFAULT '{}',
  is_shared       boolean     NOT NULL DEFAULT false,
  use_count       int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_stats (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  model           text        NOT NULL,
  input_tokens    int         NOT NULL DEFAULT 0,
  output_tokens   int         NOT NULL DEFAULT 0,
  total_tokens    int         GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  request_count   int         NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  UNIQUE (org_id, user_id, date, model)
);

-- Session updated_at trigger
CREATE OR REPLACE FUNCTION update_ai_session_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_ai_session_ts
BEFORE UPDATE ON ai_chat_sessions
FOR EACH ROW EXECUTE FUNCTION update_ai_session_ts();

-- Auto-increment message count on session after message insert
CREATE OR REPLACE FUNCTION after_ai_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ai_chat_sessions
  SET message_count = message_count + 1,
      total_tokens  = total_tokens + NEW.tokens_used,
      updated_at    = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_ai_message_count
AFTER INSERT ON ai_chat_messages
FOR EACH ROW EXECUTE FUNCTION after_ai_message();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_sessions_org     ON ai_chat_sessions(org_id, user_id, is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_org      ON ai_prompts_library(org_id, category, use_count DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_date   ON ai_usage_stats(org_id, date DESC);

-- RLS
ALTER TABLE ai_chat_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompts_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_stats    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ai_sessions"  ON ai_chat_sessions;
DROP POLICY IF EXISTS "org_ai_messages"  ON ai_chat_messages;
DROP POLICY IF EXISTS "org_ai_prompts"   ON ai_prompts_library;
DROP POLICY IF EXISTS "org_ai_usage"     ON ai_usage_stats;

CREATE POLICY "org_ai_sessions"  ON ai_chat_sessions  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ai_messages"  ON ai_chat_messages  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ai_prompts"   ON ai_prompts_library USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ai_usage"     ON ai_usage_stats    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
