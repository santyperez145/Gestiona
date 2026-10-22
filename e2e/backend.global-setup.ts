/**
 * ¿Responde la base? Se pregunta una vez antes de la suite.
 *
 * Con el proyecto de Supabase inactivo (factura impaga desde el 19/10), los
 * specs que leen la tienda real esperaban su timeout uno por uno y el job de
 * CI se cortaba a los 20 minutos como «cancelado»: ni rojo ni con causa
 * (2026-10-22). Ahora, si la base no responde, esos specs fallan al instante
 * diciendo por qué (`exigirBackendReal`) y los sintéticos, que interceptan
 * todo, corren igual.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL;
  const clave = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
  if (!url) return;
  let motivo = "";
  try {
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: clave }, signal: AbortSignal.timeout(10_000) });
    if (r.status >= 500) motivo = `respondió HTTP ${r.status}`;
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause?.code;
    motivo = causa ? `no se pudo conectar (${causa})` : e instanceof Error ? e.message : String(e);
  }
  if (!motivo) return;
  process.env.E2E_BACKEND_CAIDO = motivo;
  console.error(`::error title=Supabase no responde::${new URL(url).hostname} ${motivo}. Los specs que leen datos reales fallan sin esperar; los sintéticos corren igual.`);
}
