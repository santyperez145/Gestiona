import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { canCachePublicSupabaseMedia, clearLegacyPrivateCaches } from '@/lib/serviceWorkerPrivacy';

describe('service worker privacy', () => {
  it.each([
    '/rest/v1/creator_accounts', '/rest/v1/influencer_deliverable_files',
    '/rest/v1/rpc/creator_earnings', '/auth/v1/user',
    '/storage/v1/object/authenticated/creator-deliverables/private.pdf',
    '/storage/v1/object/sign/creator-deliverables/private.pdf?token=secret',
    '/storage/v1/render/image/authenticated/creator-deliverables/private.png',
  ])('never caches private resource %s', path => {
    expect(canCachePublicSupabaseMedia(new URL(`https://project.supabase.co${path}`), { method: 'GET' })).toBe(false);
  });

  it.each(['/storage/v1/object/public/products/photo.png', '/storage/v1/render/image/public/products/photo.png'])('caches only public media %s', path => {
    expect(canCachePublicSupabaseMedia(new URL(`https://project.supabase.co${path}`), { method: 'GET' })).toBe(true);
  });

  it('rejects writes, lookalike hosts and insecure URLs', () => {
    const path = '/storage/v1/object/public/products/photo.png';
    expect(canCachePublicSupabaseMedia(new URL(`https://project.supabase.co${path}`), { method: 'POST' })).toBe(false);
    expect(canCachePublicSupabaseMedia(new URL(`https://supabase.co.attacker.invalid${path}`), { method: 'GET' })).toBe(false);
    expect(canCachePublicSupabaseMedia(new URL(`http://project.supabase.co${path}`), { method: 'GET' })).toBe(false);
  });

  it('purges both legacy caches and waits for completion', async () => {
    let complete: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { complete = resolve; });
    const remove = vi.fn().mockResolvedValueOnce(true).mockReturnValueOnce(pending);
    const finished = vi.fn();
    const cleanup = clearLegacyPrivateCaches({ delete: remove }).then(finished);
    await Promise.resolve();
    expect(remove.mock.calls).toEqual([['supabase-api'], ['supabase-storage']]);
    expect(finished).not.toHaveBeenCalled();
    complete!(true);
    await cleanup;
    expect(finished).toHaveBeenCalledOnce();
  });

  it('worker purges before taking control and routes only public Supabase media', () => {
    const worker = readFileSync('src/sw.ts', 'utf8');
    expect(worker).toContain('await clearLegacyPrivateCaches(caches);');
    expect(worker.indexOf('await clearLegacyPrivateCaches(caches);')).toBeLessThan(worker.indexOf('await self.clients.claim();'));
    expect(worker).toContain('({ url, request }) => canCachePublicSupabaseMedia(url, request)');
    expect(worker).not.toContain('NetworkFirst');
    expect(worker).not.toContain('url.pathname.startsWith("/rest/")');
  });
});
