-- E-Learning & Training Center: courses, modules, progress tracking, certificates

CREATE TABLE IF NOT EXISTS learning_courses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  description     text,
  category        text        NOT NULL DEFAULT 'general' CHECK (category IN ('sales','products','compliance','operations','leadership','onboarding','general')),
  level           text        NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced')),
  duration_min    int         NOT NULL DEFAULT 60,
  thumbnail_url   text,
  is_mandatory    boolean     NOT NULL DEFAULT false,
  is_public       boolean     NOT NULL DEFAULT false,
  passing_score   int         NOT NULL DEFAULT 70,
  xp_reward       int         NOT NULL DEFAULT 50,
  tags            text[]      NOT NULL DEFAULT '{}',
  is_active       boolean     NOT NULL DEFAULT true,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_modules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid        NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  module_type     text        NOT NULL DEFAULT 'video' CHECK (module_type IN ('video','text','quiz','exercise','pdf','slide')),
  content_url     text,
  content_body    text,
  duration_min    int         NOT NULL DEFAULT 10,
  sort_order      int         NOT NULL DEFAULT 0,
  is_required     boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_quiz_questions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       uuid        NOT NULL REFERENCES learning_modules(id) ON DELETE CASCADE,
  question        text        NOT NULL,
  options         jsonb       NOT NULL DEFAULT '[]',   -- [{text, is_correct}]
  explanation     text,
  points          int         NOT NULL DEFAULT 1,
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learning_enrollments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id       uuid        NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  score           int,
  passed          boolean     GENERATED ALWAYS AS (
    score >= (SELECT passing_score FROM learning_courses WHERE id = course_id)
  ) STORED,
  progress_pct    int         NOT NULL DEFAULT 0,
  time_spent_min  int         NOT NULL DEFAULT 0,
  certificate_url text,
  UNIQUE (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS learning_module_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   uuid        NOT NULL REFERENCES learning_enrollments(id) ON DELETE CASCADE,
  module_id       uuid        NOT NULL REFERENCES learning_modules(id) ON DELETE CASCADE,
  completed_at    timestamptz,
  score           int,
  attempts        int         NOT NULL DEFAULT 0,
  time_spent_min  int         NOT NULL DEFAULT 0,
  UNIQUE (enrollment_id, module_id)
);

-- Course completion stats
CREATE OR REPLACE VIEW learning_course_stats AS
SELECT
  lc.id AS course_id,
  lc.org_id,
  lc.title,
  lc.category,
  COUNT(le.id) AS total_enrolled,
  COUNT(le.id) FILTER (WHERE le.completed_at IS NOT NULL) AS total_completed,
  ROUND(COUNT(le.id) FILTER (WHERE le.completed_at IS NOT NULL) * 100.0 / NULLIF(COUNT(le.id), 0), 1) AS completion_rate,
  ROUND(AVG(le.score) FILTER (WHERE le.score IS NOT NULL), 1) AS avg_score,
  ROUND(AVG(le.time_spent_min), 0) AS avg_time_min,
  COUNT(DISTINCT lm.id) AS module_count
FROM learning_courses lc
LEFT JOIN learning_enrollments le ON le.course_id = lc.id
LEFT JOIN learning_modules lm ON lm.course_id = lc.id
GROUP BY lc.id, lc.org_id, lc.title, lc.category;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_org         ON learning_courses(org_id, category, is_active);
CREATE INDEX IF NOT EXISTS idx_modules_course       ON learning_modules(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_user     ON learning_enrollments(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_module_progress_enr  ON learning_module_progress(enrollment_id, module_id);

-- RLS
ALTER TABLE learning_courses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_modules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_quiz_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_enrollments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_module_progress  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_courses"           ON learning_courses;
DROP POLICY IF EXISTS "org_modules"           ON learning_modules;
DROP POLICY IF EXISTS "org_quiz_questions"    ON learning_quiz_questions;
DROP POLICY IF EXISTS "org_enrollments"       ON learning_enrollments;
DROP POLICY IF EXISTS "org_module_progress"   ON learning_module_progress;

CREATE POLICY "org_courses"         ON learning_courses        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_modules"         ON learning_modules        USING (course_id IN (SELECT id FROM learning_courses WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_quiz_questions"  ON learning_quiz_questions USING (module_id IN (SELECT lm.id FROM learning_modules lm JOIN learning_courses lc ON lc.id = lm.course_id WHERE lc.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_enrollments"     ON learning_enrollments    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_module_progress" ON learning_module_progress USING (enrollment_id IN (SELECT id FROM learning_enrollments WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
