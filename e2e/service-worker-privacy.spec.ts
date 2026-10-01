import { expect, test } from '@playwright/test';

test('new worker purges private legacy caches before controlling the page', async ({ page, context }) => {
  // A fresh context contains only synthetic cache data; no login or provider mutation.
  await page.goto('/favicon.ico');
  const privateUrl = 'https://hummeopatkniwkyrrhwc.supabase.co/rest/v1/zz_private_cache_probe';
  await page.evaluate(async privateUrl => {
    for (const name of ['supabase-api', 'supabase-storage']) {
      const cache = await caches.open(name);
      await cache.put(privateUrl, new Response('{"synthetic":"private"}', { headers: { 'Content-Type': 'application/json' } }));
    }
    await caches.open('zz-unrelated-cache');
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  }, privateUrl);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names).not.toContain('supabase-api');
  expect(names).not.toContain('supabase-storage');
  expect(names).toContain('zz-unrelated-cache');
  await context.setOffline(true);
  const privateAvailableOffline = await page.evaluate(async privateUrl => {
    try { await fetch(privateUrl); return true; } catch { return false; }
  }, privateUrl);
  expect(privateAvailableOffline).toBe(false);
  await context.setOffline(false);
});
