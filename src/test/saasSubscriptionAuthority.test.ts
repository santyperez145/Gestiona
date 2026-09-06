import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('autoridad de suscripciones SaaS', () => {
  const subscribe = read('supabase/functions/mp-subscribe/index.ts');
  const cancel = read('supabase/functions/cancel-subscription/index.ts');
  const webhook = read('supabase/functions/mercadopago-webhook/index.ts');
  const portal = read('supabase/functions/create-billing-portal/index.ts');

  it('alta y baja validan identidad y rol del lado servidor', () => {
    expect(subscribe).toContain('getAuthedUser(req)');
    expect(subscribe).toContain('.from("memberships")');
    expect(cancel).toContain('has_org_role');
  });

  it('sólo el webhook firmado activa o registra pagos', () => {
    const branch = webhook.slice(webhook.indexOf('if (type === "subscription_preapproval"'));
    expect(branch).toContain('verifyMpSignature');
    expect(branch).toContain('MP_WEBHOOK_SECRET');
    expect(branch).toContain('suscripcion_registrar_pago');
    expect(subscribe).toContain('status: "past_due"');
    expect(subscribe).not.toContain('status: "active"');
  });

  it('el portal Stripe duplicado está retirado', () => {
    expect(portal).toContain('BILLING_PORTAL_RETIRED');
    expect(portal).not.toContain('STRIPE_SECRET_KEY');
  });
});
