/**
 * Resuelve la conexión privada de Evolution API de una organización.
 *
 * La tabla `evolution_connections` no tiene policies para navegador: esta
 * función sólo se importa desde Edge Functions que ya usan service_role. Las
 * columnas heredadas de `settings` se retiraron después de migrar y medir cero
 * valores restantes; cualquier error se propaga en vez de fingir "sin
 * configurar".
 */

export interface EvolutionCredentials {
  apiUrl: string;
  apiKey: string;
  instance: string;
  source: 'organization' | 'platform';
}

// deno-lint-ignore no-explicit-any
export async function getEvolutionCredentials(admin: any, orgId: string): Promise<EvolutionCredentials | null> {
  const { data: connection, error: connectionError } = await admin
    .from('evolution_connections')
    .select('api_url,api_key,instance')
    .eq('org_id', orgId)
    .maybeSingle();

  if (connectionError) throw connectionError;

  if (connection?.api_url && connection?.api_key) {
    return {
      apiUrl: connection.api_url.replace(/\/$/, ''),
      apiKey: connection.api_key,
      instance: connection.instance || 'gestiona',
      source: 'organization',
    };
  }

  const apiUrl = Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, '') || '';
  const apiKey = Deno.env.get('EVOLUTION_API_KEY') || '';
  const instance = Deno.env.get('EVOLUTION_INSTANCE') || 'gestiona';
  if (!apiUrl || !apiKey) return null;

  return { apiUrl, apiKey, instance, source: 'platform' };
}
