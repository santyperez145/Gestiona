-- CRM Follow-up scheduling
-- Adds follow_up_date and outcome columns to customer_communications
-- so sales reps can schedule callbacks, track interaction results, and get reminders.

ALTER TABLE customer_communications
  ADD COLUMN IF NOT EXISTS follow_up_date date,
  ADD COLUMN IF NOT EXISTS outcome text CHECK (
    outcome IS NULL OR outcome IN ('completed', 'no_answer', 'rescheduled', 'pending')
  );

-- Index for dashboard follow-up queries (due today / overdue)
CREATE INDEX IF NOT EXISTS idx_customer_comms_followup
  ON customer_communications (org_id, follow_up_date)
  WHERE follow_up_date IS NOT NULL;

-- View: upcoming follow-ups (next 7 days + overdue)
CREATE OR REPLACE VIEW crm_pending_followups AS
SELECT
  cc.id,
  cc.org_id,
  cc.customer_name,
  cc.type,
  cc.summary,
  cc.follow_up_date,
  cc.outcome,
  cc.created_at,
  CASE
    WHEN cc.follow_up_date < CURRENT_DATE THEN 'overdue'
    WHEN cc.follow_up_date = CURRENT_DATE THEN 'today'
    ELSE 'upcoming'
  END AS urgency
FROM customer_communications cc
WHERE cc.follow_up_date IS NOT NULL
  AND (cc.outcome IS NULL OR cc.outcome = 'pending')
ORDER BY cc.follow_up_date ASC;
