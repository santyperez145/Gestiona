-- Document OCR & Smart Import: scan invoices/receipts, auto-create records

CREATE TABLE IF NOT EXISTS ocr_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  filename        text        NOT NULL,
  file_url        text        NOT NULL,
  file_size       int         NOT NULL DEFAULT 0,
  mime_type       text        NOT NULL DEFAULT 'image/jpeg',
  document_type   text        CHECK (document_type IN ('invoice','receipt','bill','purchase_order','delivery_note','contract','other')),
  ocr_status      text        NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','processing','completed','failed','reviewed')),
  ocr_provider    text        NOT NULL DEFAULT 'google_vision' CHECK (ocr_provider IN ('google_vision','aws_textract','azure_form','tesseract','custom')),
  raw_text        text,
  extracted_data  jsonb       NOT NULL DEFAULT '{}',  -- {supplier, cuit, date, total, items, invoice_number}
  confidence      numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  corrections     jsonb       NOT NULL DEFAULT '{}',  -- user corrections to extracted data
  linked_entity   text        CHECK (linked_entity IN ('purchase','invoice','expense','supplier')),
  linked_id       uuid,
  processing_ms   int,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS ocr_line_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id     uuid        NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
  description     text        NOT NULL,
  quantity        numeric(14,4) NOT NULL DEFAULT 1,
  unit_price      numeric(14,2) NOT NULL DEFAULT 0,
  total_price     numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate        numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,  -- matched product
  match_confidence numeric(4,3),
  is_confirmed    boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ocr_supplier_patterns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        REFERENCES proveedores(id) ON DELETE CASCADE,
  cuit            text,
  name_pattern    text,       -- regex pattern to match supplier name
  matched_count   int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, cuit)
);

-- Stats for OCR usage
CREATE OR REPLACE FUNCTION get_ocr_stats(p_org_id uuid, p_days int DEFAULT 30)
RETURNS TABLE(
  total_docs      bigint,
  completed       bigint,
  failed          bigint,
  pending         bigint,
  avg_confidence  numeric,
  total_extracted_value numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*) AS total_docs,
    COUNT(*) FILTER (WHERE ocr_status = 'completed' OR ocr_status = 'reviewed') AS completed,
    COUNT(*) FILTER (WHERE ocr_status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE ocr_status = 'pending' OR ocr_status = 'processing') AS pending,
    ROUND(AVG(confidence), 3) AS avg_confidence,
    SUM(COALESCE((extracted_data->>'total')::numeric, 0)) AS total_extracted_value
  FROM ocr_documents
  WHERE org_id = p_org_id
    AND created_at >= now() - (p_days || ' days')::interval;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ocr_docs_org     ON ocr_documents(org_id, ocr_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_items_doc    ON ocr_line_items(document_id, is_confirmed);
CREATE INDEX IF NOT EXISTS idx_ocr_patterns_org ON ocr_supplier_patterns(org_id, cuit);

-- RLS
ALTER TABLE ocr_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_line_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_supplier_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ocr_docs"     ON ocr_documents;
DROP POLICY IF EXISTS "org_ocr_items"    ON ocr_line_items;
DROP POLICY IF EXISTS "org_ocr_patterns" ON ocr_supplier_patterns;

CREATE POLICY "org_ocr_docs"     ON ocr_documents         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ocr_items"    ON ocr_line_items        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ocr_patterns" ON ocr_supplier_patterns USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
