import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260925013000_store_newsletter.sql'),
  'utf8',
);
const sync = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260925013100_newsletter_consent_sync.sql'),
  'utf8',
);
const layout = readFileSync(join(process.cwd(), 'src/storefront/StoreLayout.tsx'), 'utf8');
const newsletter = readFileSync(join(process.cwd(), 'src/storefront/StoreNewsletter.tsx'), 'utf8');

describe('newsletter de la tienda (consentimiento en todo el sitio)', () => {
  it('la lista de suscriptores existe con unicidad por tienda+email', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.store_newsletter_subscribers');
    expect(migration).toContain('UNIQUE (store_id, email)');
  });

  it('la tabla está cerrada: RLS sin policies (sólo RPC y service_role)', () => {
    expect(migration).toContain('ALTER TABLE public.store_newsletter_subscribers ENABLE ROW LEVEL SECURITY');
    // Cero policies: el único camino de escritura público es la RPC.
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*store_newsletter_subscribers[\s\S]*FOR (INSERT|UPDATE)/);
  });

  it('la RPC pública valida tienda activa por slug y email válido', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.register_store_newsletter(');
    expect(migration).toContain("v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'");
    expect(migration).toContain('AND is_active = true');
    expect(migration).toContain("'email_invalido'");
    expect(migration).toContain("'tienda_no_encontrada'");
  });

  it('una baja nunca se reactiva con un alta de newsletter (Ley 25.326)', () => {
    expect(migration).toContain("IF v_existing.unsubscribed_at IS NOT NULL THEN");
    expect(migration).toContain("'dado_de_baja'");
    // El CRM con opt-out no se pisa desde el newsletter.
    expect(migration).toContain('AND v_crm.marketing_opt_out_at IS NULL');
  });

  it('grants mínimos: anon/authenticated en la RPC, service_role en la sync', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.register_store_newsletter(text, text) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.register_store_newsletter(text, text) TO anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.sync_newsletter_consent_to_customer(uuid, text) TO service_role');
  });

  it('el consentimiento viaja al CRM al acreditarse una orden', () => {
    expect(sync).toContain('v_newsletter_at');
    expect(sync).toContain('FROM public.store_newsletter_subscribers');
    expect(sync).toContain('AND unsubscribed_at IS NULL');
    expect(sync).toContain('COALESCE(marketing_consent_at, v_order.marketing_consent_at, v_newsletter_at)');
    expect(sync).toContain('COALESCE(v_order.marketing_consent_at, v_newsletter_at)');
  });

  it('el footer de la vitrina muestra el formulario en cada página', () => {
    expect(layout).toContain('StoreNewsletter');
    expect(layout).toContain('store?.slug &&');
    expect(newsletter).toContain('register_store_newsletter');
    expect(newsletter).toContain('Ya estabas suscripto');
  });

  it('el formulario habla de la baja y enlaza la política de privacidad', () => {
    expect(newsletter).toContain('Podés darte de baja cuando quieras');
    expect(newsletter).toContain('politica-de-privacidad');
  });
});
