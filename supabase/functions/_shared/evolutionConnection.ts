/**
 * Resuelve la conexión privada de Evolution API de una organización.
 *
 * La tabla `evolution_connections` no tiene policies para navegador: esta
 * función sólo se importa desde Edge Functions que ya usan service_role. El
 * fallback a `settings` existe exclusivamente durante un deploy donde el
 * código llegó antes que la migración; sólo se toma si la relación nueva no
 * existe. Cualquier otro error se propaga en vez de fingir "sin configurar".
 */

export interface EvolutionCredentials {
  apiUrl: string;
  apiKey: string;
  instance: string;
  source: 'organization' | 'platform';
}

const MISSING_RELATION_CODES = new Set(['42P01', 'PGRST205']);

function isMissingRelation(error: { code?: string } | null) {
  return !!error?.code && MISSING_RELATION_CODES.has(error.code);
}

// deno-lint-ignore no-explicit-any
export async function getEvolutionCredentials(admin: any, orgId: string): Promise<EvolutionCredentials | null> {
  const { data: connection, error: connectionError } = await admin
    .from('evolution_connections')
    .select('api_url,api_key,instance')
    .eq('org_id', orgId)
    .maybeSingle();

  if (connectionError && !isMissingRelation(connectionError)) throw connectionError;

  if (connection?.api_url && connection?.api_key) {
    return {
      apiUrl: connection.api_url.replace(/\/$/, ''),
      apiKey: connection.api_key,
      instance: connection.instance || 'gestiona',
      source: 'organization',
    };
  }

  // Compatibilidad estrictamente temporal: evita una caída si un deploy de
  // funciones llega antes de 20260821000050. La migración vacía estos campos y
  // bloquea nuevas escrituras, por lo que una base actual no pasa por acá.
  if (connectionError && isMissingRelation(connectionError)) {
    const { data: legacy, error: legacyError } = await admin
      .from('settings')
      .select('evolution_api_url,evolution_api_key,evolution_instance')
      .eq('org_id', orgId)
      .maybeSingle();
    if (legacyError) throw legacyError;
    if (legacy?.evolution_api_url && legacy?.evolution_api_key) {
      return {
        apiUrl: legacy.evolution_api_url.replace(/\/$/, ''),
        apiKey: legacy.evolution_api_key,
        instance: legacy.evolution_instance || 'gestiona',
        source: 'organization',
      };
    }
  }

  const apiUrl = Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, '') || '';
  const apiKey = Deno.env.get('EVOLUTION_API_KEY') || '';
  const instance = Deno.env.get('EVOLUTION_INSTANCE') || 'gestiona';
  if (!apiUrl || !apiKey) return null;

  return { apiUrl, apiKey, instance, source: 'platform' };
}
