-- Document Management System

CREATE TABLE IF NOT EXISTS document_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  color       text        NOT NULL DEFAULT '#6366f1',
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     uuid        REFERENCES document_categories(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  doc_type        text        NOT NULL DEFAULT 'general'
                              CHECK (doc_type IN ('contract','invoice','report','manual','procedure','certificate','legal','financial','hr','other')),
  file_url        text,
  file_name       text,
  file_size_kb    int,
  mime_type       text,
  version         text        NOT NULL DEFAULT '1.0',
  version_number  int         NOT NULL DEFAULT 1,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('draft','active','archived','expired')),
  access_level    text        NOT NULL DEFAULT 'org'
                              CHECK (access_level IN ('public','org','admin')),
  tags            text[],
  expiry_date     date,
  signed_by       text,
  signed_at       timestamptz,
  uploaded_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  notes           text,
  view_count      int         NOT NULL DEFAULT 0,
  download_count  int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version         text        NOT NULL,
  version_number  int         NOT NULL,
  file_url        text,
  file_name       text,
  file_size_kb    int,
  change_summary  text,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_access_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action      text        NOT NULL CHECK (action IN ('view','download','share','edit')),
  user_name   text,
  accessed_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default categories
CREATE OR REPLACE FUNCTION seed_document_categories(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_categories(org_id, name, description, color) VALUES
    (p_org_id, 'Contratos',     'Contratos con clientes y proveedores', '#6366f1'),
    (p_org_id, 'Facturas',      'Facturas y comprobantes',              '#f59e0b'),
    (p_org_id, 'Procedimientos','Manuales y SOPs',                      '#10b981'),
    (p_org_id, 'Legales',       'Documentos legales y normativos',      '#ef4444'),
    (p_org_id, 'RRHH',          'Documentación de personal',            '#8b5cf6'),
    (p_org_id, 'Financiero',    'Reportes y documentos financieros',    '#f97316'),
    (p_org_id, 'Certificados',  'Certificaciones y habilitaciones',     '#06b6d4'),
    (p_org_id, 'General',       'Documentos generales',                 '#94a3b8')
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION update_document_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_document_ts ON documents;
CREATE TRIGGER trg_document_ts BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_document_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_org      ON documents(org_id, status, doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category_id);
CREATE INDEX IF NOT EXISTS idx_doc_versions       ON document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_doc_access_log     ON document_access_log(document_id, accessed_at DESC);

-- RLS
ALTER TABLE document_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_doc_cats"       ON document_categories;
DROP POLICY IF EXISTS "org_documents"      ON documents;
DROP POLICY IF EXISTS "org_doc_versions"   ON document_versions;
DROP POLICY IF EXISTS "org_doc_access_log" ON document_access_log;

CREATE POLICY "org_doc_cats" ON document_categories
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_documents" ON documents
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_doc_versions" ON document_versions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_doc_access_log" ON document_access_log
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
