import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase', 'migrations', '20260821000052_platform_operations_queue.sql'),
  'utf8',
);
const PAGE = readFileSync(resolve(ROOT, 'src', 'pages', 'PlatformOperationsPage.tsx'), 'utf8');
const ACTION = readFileSync(resolve(ROOT, 'supabase', 'functions', 'platform-admin-action', 'index.ts'), 'utf8');

describe('cola operativa de plataforma', () => {
  it('agrega incidentes reales en una vista staff-only sin errores ni payloads crudos', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE VIEW public.platform_operations_queue');
    expect(MIGRATION).toContain("'outbox'::text AS source");
    expect(MIGRATION).toContain("'meli_webhook'::text AS source");
    expect(MIGRATION).toContain("'payment_attempt'::text AS source");
    expect(MIGRATION).toContain("'cron'::text AS source");
    expect(MIGRATION).toContain('WHERE public.is_platform_admin(auth.uid())');
    expect(MIGRATION).toContain('ALTER VIEW public.platform_operations_queue SET (security_invoker = false)');
    expect(MIGRATION).toContain('REVOKE ALL ON public.platform_operations_queue FROM PUBLIC, anon');
    expect(MIGRATION).not.toContain('o.objetivo AS');
    expect(MIGRATION).not.toContain('o.payload AS');
    expect(MIGRATION).not.toContain('m.resource AS');
    expect(MIGRATION).not.toContain('a.motivo AS');
  });

  it('limita el único reintento manual a outbox descartado, con función privada y auditoría atómica', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.platform_retry_outbox_delivery');
    expect(MIGRATION).toContain("IF v_ticket.estado <> 'descartado' THEN");
    expect(MIGRATION).toContain("'retryOutboxDelivery'");
    expect(MIGRATION).toContain('REVOKE ALL ON FUNCTION public.platform_retry_outbox_delivery(uuid, uuid, text)');
    expect(MIGRATION).toContain('TO service_role');
    expect(ACTION).toContain('if (action === "retryOutboxDelivery")');
    expect(ACTION).toContain('admin.rpc("platform_retry_outbox_delivery"');
    expect(ACTION).not.toMatch(/retryOutboxDelivery:\s*\[/);
  });

  it('el navegador lee sólo la vista y no ofrece reintento de pagos', () => {
    expect(PAGE).toContain("from('platform_operations_queue')");
    expect(PAGE).toContain("action: 'retryOutboxDelivery'");
    expect(PAGE).toContain('nunca reintenta un cobro');
    expect(PAGE).not.toContain("from('outbox_events')");
    expect(PAGE).not.toContain("from('meli_webhook_events')");
    expect(PAGE).not.toContain("from('payment_attempts')");
  });
});
