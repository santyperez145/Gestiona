import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260929000300_creator_payout_destinations.sql');
const creatorPortal = read('src/pages/CreatorPortalPage.tsx');
const brandPayments = read('src/pages/InfluencerPaymentsPage.tsx');
const payoutEdge = read('supabase/functions/mp-payouts/index.ts');
const storePay = read('supabase/functions/store-pay/index.ts');

describe('destinos de cobro y liquidaciones de creadores', () => {
  it('cifra el identificador y no concede lectura directa a roles web', () => {
    expect(migration).toContain('public.secret_encrypt(v_identifier)');
    expect(migration).toContain('REVOKE ALL ON TABLE public.creator_payout_destinations FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('identifier_masked');
  });

  it('cierra la lectura cruzada de retiros y autoriza por organizacion', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS withdrawals_org_read');
    expect(migration).toContain("public.can_manage_influencers(org_id, 'edit')");
    expect(migration).not.toContain('withdrawals_org_read ON public.influencer_withdrawal_requests FOR SELECT TO authenticated\n  USING (true)');
  });

  it('distribuye el retiro global sin mezclar saldos de marcas', () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('creator-withdrawal:'");
    expect(migration).toContain('v_take := LEAST(v_available, v_remaining)');
    expect(migration).toContain('v_inf.org_id, v_inf.id');
  });

  it('liquida solo una solicitud aprobada y conserva referencia idempotente', () => {
    expect(migration).toContain("IF v_row.status <> 'approved'");
    expect(migration).toContain("notes = 'withdrawal:' || v_row.id::text");
    expect(migration).toContain('payment_reference = left(btrim(p_payment_reference), 160)');
  });

  it('el creador puede elegir Mercado Pago, banco u otra billetera', () => {
    expect(creatorPortal).toContain('<SelectItem value="mercadopago">Mercado Pago</SelectItem>');
    expect(creatorPortal).toContain('<SelectItem value="virtual_wallet">Otra billetera</SelectItem>');
    expect(creatorPortal).toContain('p_destination_id: destinoId');
    expect(creatorPortal).not.toContain('Datos de cobro: ${cbuAlias.trim()}');
  });

  it('la marca confirma la transferencia en vez de simular un payout', () => {
    expect(brandPayments).toContain('settleWithdrawalRequest');
    expect(brandPayments).toContain('Referencia o comprobante');
    expect(brandPayments).not.toContain('Pagar con Mercado Pago');
  });

  it('separa el split oficial de tienda del payout opcional contratado', () => {
    expect(storePay).toContain('application_fee');
    expect(storePay).toContain('getMpCredentials(admin, store.org_id)');
    expect(payoutEdge).toContain('MP_PAYOUTS_ENABLED');
    expect(payoutEdge).toContain('provider_capability_unavailable');
  });
});
