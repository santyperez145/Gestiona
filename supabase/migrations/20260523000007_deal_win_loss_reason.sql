-- Deal Win/Loss Reason Recording
-- Captures why deals were won or lost for Sales Analytics

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS win_loss_reason text;

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_deals_win_loss ON deals(org_id, stage, win_loss_reason)
  WHERE stage IN ('cerrado', 'perdido');

COMMENT ON COLUMN deals.win_loss_reason IS
  'Free-text or preset reason why a deal was won/closed or lost. Captured via the Win/Loss dialog on stage change.';
