import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260929001020_creator_commission_authority.sql', 'utf8');
const databaseClient = readFileSync('src/lib/influencersDB.ts', 'utf8');
const canonicalPage = readFileSync('src/pages/InfluencerPaymentsPage.tsx', 'utf8');

describe('autoridad de comisiones y liquidaciones', () => {
  it('retira la pantalla duplicada que simulaba pagos completos', () => {
    expect(existsSync('src/components/influencers/SettlementsTab.tsx')).toBe(false);
    expect(databaseClient).not.toContain('export async function createPayout');
    expect(databaseClient).not.toContain("from('influencer_payouts').insert");
  });

  it('bloquea DML directo sobre comisiones y payouts', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.influencer_sales');
    expect(migration).toContain('REVOKE ALL ON TABLE public.influencer_payouts');
    expect(migration).toContain("has_table_privilege('authenticated', 'public.influencer_sales', 'UPDATE')");
    expect(migration).toContain("has_table_privilege('authenticated', 'public.influencer_payouts', 'INSERT')");
    expect(migration).toContain('can_manage_influencers');
  });

  it('conserva una sola UI canónica con aprobación y referencia externa', () => {
    expect(canonicalPage).toContain('resolveWithdrawalRequest');
    expect(canonicalPage).toContain('settleWithdrawalRequest');
    expect(canonicalPage).toContain('referencia.trim()');
    expect(canonicalPage).toContain('Nerqia no marca el retiro como pagado antes de esta confirmación');
  });
});
