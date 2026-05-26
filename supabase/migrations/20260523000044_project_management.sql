-- Project Management (Proyectos con hitos, tareas y presupuesto)

CREATE TABLE IF NOT EXISTS projects (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  status          text        NOT NULL DEFAULT 'planning'
                              CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
  priority        text        NOT NULL DEFAULT 'medium'
                              CHECK (priority IN ('low','medium','high','critical')),
  start_date      date,
  due_date        date,
  completed_at    timestamptz,
  budget          numeric(14,2),
  spent           numeric(14,2) NOT NULL DEFAULT 0,
  color           text        NOT NULL DEFAULT '#6366f1',
  tags            text[]      NOT NULL DEFAULT '{}',
  progress_pct    int         NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  due_date        date,
  completed_at    timestamptz,
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id    uuid        REFERENCES project_milestones(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'todo'
                              CHECK (status IN ('todo','in_progress','review','done','cancelled')),
  priority        text        NOT NULL DEFAULT 'medium'
                              CHECK (priority IN ('low','medium','high','critical')),
  assignee_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_name   text,
  due_date        date,
  estimated_hours numeric(8,2),
  logged_hours    numeric(8,2) NOT NULL DEFAULT 0,
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_time_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid        NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name       text,
  hours           numeric(8,2) NOT NULL,
  description     text,
  logged_at       date        NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_expenses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description     text        NOT NULL,
  amount          numeric(14,2) NOT NULL,
  category        text,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  receipt_url     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-update project spent from expenses
CREATE OR REPLACE FUNCTION sync_project_spent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE projects
  SET spent = (SELECT COALESCE(SUM(amount), 0) FROM project_expenses WHERE project_id = COALESCE(NEW.project_id, OLD.project_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.project_id, OLD.project_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_proj_spent_ins ON project_expenses;
DROP TRIGGER IF EXISTS trg_proj_spent_del ON project_expenses;
CREATE TRIGGER trg_proj_spent_ins AFTER INSERT ON project_expenses FOR EACH ROW EXECUTE FUNCTION sync_project_spent();
CREATE TRIGGER trg_proj_spent_del AFTER DELETE ON project_expenses FOR EACH ROW EXECUTE FUNCTION sync_project_spent();

-- Auto-update task logged_hours from time_logs
CREATE OR REPLACE FUNCTION sync_task_hours()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE project_tasks
  SET logged_hours = (SELECT COALESCE(SUM(hours), 0) FROM project_time_logs WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_task_hours_ins ON project_time_logs;
DROP TRIGGER IF EXISTS trg_task_hours_del ON project_time_logs;
CREATE TRIGGER trg_task_hours_ins AFTER INSERT ON project_time_logs FOR EACH ROW EXECUTE FUNCTION sync_task_hours();
CREATE TRIGGER trg_task_hours_del AFTER DELETE ON project_time_logs FOR EACH ROW EXECUTE FUNCTION sync_task_hours();

-- updated_at
CREATE OR REPLACE FUNCTION update_project_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_project_ts ON projects;
DROP TRIGGER IF EXISTS trg_project_task_ts ON project_tasks;
CREATE TRIGGER trg_project_ts BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_project_ts();
CREATE TRIGGER trg_project_task_ts BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION update_project_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_org         ON projects(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_project_tasks_proj   ON project_tasks(project_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_tasks_org    ON project_tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_project_milestones   ON project_milestones(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_timelogs     ON project_time_logs(task_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_expenses     ON project_expenses(project_id, date DESC);

-- RLS
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_time_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_expenses    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_projects"           ON projects;
DROP POLICY IF EXISTS "org_proj_milestones"    ON project_milestones;
DROP POLICY IF EXISTS "org_proj_tasks"         ON project_tasks;
DROP POLICY IF EXISTS "org_proj_timelogs"      ON project_time_logs;
DROP POLICY IF EXISTS "org_proj_expenses"      ON project_expenses;

CREATE POLICY "org_projects" ON projects
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_proj_milestones" ON project_milestones
  USING (project_id IN (SELECT id FROM projects WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_proj_tasks" ON project_tasks
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_proj_timelogs" ON project_time_logs
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_proj_expenses" ON project_expenses
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
