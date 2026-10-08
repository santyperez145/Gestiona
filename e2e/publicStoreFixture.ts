import { expect, type Page } from "@playwright/test";

type StoreRow = Record<string, unknown>;

/** Read once per test; only configuration is patched, never the live catalogue. */
export async function configurePublicStore(page: Page, slug: string, patch: (row: StoreRow) => StoreRow) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("La fixture publica requiere URL y clave publica de Supabase");
  if (!key.startsWith("sb_publishable_")) {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString());
    if (payload.role !== "anon") throw new Error("La fixture publica no admite credenciales privadas");
  }

  const response = await page.request.post(`${url}/rest/v1/rpc/get_store_by_slug`, {
    headers: { apikey: key },
    data: { p_slug: slug },
    timeout: 15_000,
  });
  expect(response.status(), "La configuracion real de la tienda debe estar disponible").toBe(200);
  const body = await response.json() as StoreRow | StoreRow[] | null;
  expect(body && (!Array.isArray(body) || body.length > 0), "La tienda real no puede estar vacia").toBeTruthy();
  await response.dispose();

  // No route.fetch relay per navigation: theme/provider tests reuse the same
  // fresh snapshot. Network failures have their own read-recovery suite.
  await page.route("**/rest/v1/rpc/get_store_by_slug", route => route.fulfill({
    status: 200,
    json: Array.isArray(body) ? body.map(patch) : patch(body),
  }));
}
